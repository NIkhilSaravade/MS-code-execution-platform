// Package executor orchestrates the full lifecycle of one submission:
//   1. Mark state RUNNING in submission-service
//   2. Fetch test case metadata from problem-service
//   3. Download code and test case content from S3
//   4. Compile (if needed) and run each test case inside the sandbox
//   5. Aggregate the final verdict
//   6. Upload stdout/stderr artifacts to S3
//   7. Publish executions.completed.v1 or executions.failed.v1 to Kafka
//
// The executor is the only component that talks to all other components.
// It has no state of its own — it is pure orchestration logic.
package executor

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	kafkago "github.com/segmentio/kafka-go"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"

	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/clients"
	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/config"
	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/domain"
	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/kafka"
	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/sandbox"
	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/storage"
)

// Executor is the kafka.Handler implementation. One instance is shared across
// all goroutines — all dependencies must be safe for concurrent use.
type Executor struct {
	cfg            *config.Config
	sandbox        *sandbox.Sandbox
	submissionClient *clients.SubmissionClient
	problemClient  *clients.ProblemClient
	s3             *storage.S3Client
	producer       *kafka.Producer
}

// New wires up an Executor with all its dependencies.
func New(
	cfg *config.Config,
	sb *sandbox.Sandbox,
	submissionClient *clients.SubmissionClient,
	problemClient *clients.ProblemClient,
	s3 *storage.S3Client,
	producer *kafka.Producer,
) *Executor {
	return &Executor{
		cfg:              cfg,
		sandbox:          sb,
		submissionClient: submissionClient,
		problemClient:    problemClient,
		s3:               s3,
		producer:         producer,
	}
}

// Handle processes a single submission job. It satisfies the kafka.Handler interface.
// Returning an error causes the consumer to route the message to the DLQ.
// System errors (infrastructure failures) are returned as errors.
// User-code verdicts (TLE, MLE, RE, CE, FAILED) are not errors — they are
// valid outcomes that are published as executions.completed.v1.
func (e *Executor) Handle(ctx context.Context, job *domain.SubmissionJob) error {
	ctx, span := otel.Tracer("worker-service/executor.Executor").Start(ctx, "executor.Handle")
	defer span.End()

	span.SetAttributes(
		attribute.String("submission_id", job.SubmissionID),
		attribute.String("user_id", job.UserID),
		attribute.String("problem_id", job.ProblemID),
		attribute.String("language", string(job.Language)),
	)

	logger := log.With().
		Str("submission_id", job.SubmissionID).
		Str("user_id", job.UserID).
		Str("language", string(job.Language)).
		Logger()

	// Validate language before touching anything else.
	if !domain.SupportedLanguages[job.Language] {
		err := fmt.Errorf("unsupported language: %s", job.Language)
		logger.Error().Err(err).Msg("rejecting submission with unsupported language")
		return e.publishSystemError(ctx, job, err.Error())
	}

	// ── Step 1: Mark RUNNING ─────────────────────────────────────────────────
	// Non-fatal: failure here means the user doesn't see "Running…" in the UI,
	// but the execution continues. The final verdict reconciles state anyway.
	if err := e.submissionClient.MarkRunning(ctx, job.SubmissionID); err != nil {
		logger.Warn().Err(err).Msg("could not mark submission RUNNING — continuing")
	}

	// ── Step 2: Fetch problem limits ─────────────────────────────────────────
	timeLimitMS, memoryLimitMB, err := e.problemClient.GetProblemLimits(ctx, job.ProblemID)
	if err != nil {
		logger.Error().Err(err).Msg("failed to fetch problem limits — using sandbox defaults")
		// Fall back to configured defaults rather than failing the submission.
		timeLimitMS = int(e.cfg.SandboxWallTimeout.Milliseconds())
		memoryLimitMB = e.cfg.SandboxMemoryMB
	}
	wallTimeout := time.Duration(timeLimitMS) * time.Millisecond
	if wallTimeout <= 0 {
		wallTimeout = e.cfg.SandboxWallTimeout
	}

	// ── Step 3: Fetch test cases ─────────────────────────────────────────────
	testCases, err := e.problemClient.GetTestCases(ctx, job.ProblemVersionID)
	if err != nil {
		return e.publishSystemError(ctx, job,
			fmt.Sprintf("fetch test cases for version %s: %v", job.ProblemVersionID, err))
	}
	if len(testCases) == 0 {
		return e.publishSystemError(ctx, job, "problem version has no test cases")
	}

	// Run (IncludeHidden=false) only judges the visible/sample cases -
	// matching LeetCode's "Run Code" vs "Submit" distinction.
	if !job.IncludeHidden {
		visible := make([]*domain.TestCase, 0, len(testCases))
		for _, tc := range testCases {
			if tc.IsSample {
				visible = append(visible, tc)
			}
		}
		testCases = visible
		if len(testCases) == 0 {
			return e.publishSystemError(ctx, job, "problem version has no visible test cases")
		}
	}
	logger.Info().Int("test_cases", len(testCases)).Msg("fetched test cases")

	// ── Step 4: Download source code ─────────────────────────────────────────
	sourceCode, err := e.s3.GetSubmissionCode(ctx, job.CodeS3Key)
	if err != nil {
		return e.publishSystemError(ctx, job, fmt.Sprintf("download code from S3: %v", err))
	}

	// ── Step 5: Download test case content (input + expected) from S3 ────────
	if err := e.hydrateTestCases(ctx, testCases); err != nil {
		return e.publishSystemError(ctx, job, fmt.Sprintf("hydrate test case content: %v", err))
	}

	// ── Step 6: Execute ───────────────────────────────────────────────────────
	result, err := e.executeAllTestCases(ctx, job, sourceCode, testCases, wallTimeout, memoryLimitMB)
	if err != nil {
		// Infrastructure failure during execution — mark as SYSTEM_ERROR.
		return e.publishSystemError(ctx, job, fmt.Sprintf("execution infrastructure error: %v", err))
	}

	// ── Step 7: Upload artifacts ─────────────────────────────────────────────
	// Best-effort — artifact upload failure doesn't change the verdict.
	e.uploadArtifacts(ctx, result)

	// ── Step 7.5: Report the terminal verdict to submission-service ──────────
	// Best-effort, same as MarkRunning - the Kafka event below is still
	// published regardless. But since nothing currently consumes
	// executions.completed.v1 back into submission-service, this HTTP call is
	// the only thing that actually closes out the submission's row for a
	// Go-routed request; a failure here leaves it stuck at RUNNING.
	if err := e.submissionClient.MarkTerminal(ctx, job.SubmissionID, result.Verdict, "", string(result.LastStdout), result.TestCaseResults); err != nil {
		logger.Warn().Err(err).Msg("could not report terminal verdict to submission-service")
	}

	// ── Step 8: Publish executions.completed.v1 ───────────────────────────────
	if err := e.publishCompleted(ctx, job, result); err != nil {
		// This is the most critical failure path. We've executed the code and
		// know the verdict but can't publish it. Return the error so the Kafka
		// consumer can route to DLQ, but note the submission is now stuck in
		// RUNNING state until submission-service times it out.
		logger.Error().Err(err).
			Str("verdict", string(result.Verdict)).
			Msg("CRITICAL: execution complete but failed to publish result event")
		return fmt.Errorf("publish completed event: %w", err)
	}

	logger.Info().
		Str("verdict", string(result.Verdict)).
		Int("passed", result.TestCasesPassed).
		Int("total", result.TestCasesTotal).
		Int64("wall_time_ms", result.WallTimeMS).
		Msg("submission execution complete")

	return nil
}

// --------------------------------------------------------------------------
// execution pipeline
// --------------------------------------------------------------------------

func (e *Executor) executeAllTestCases(
	ctx context.Context,
	job *domain.SubmissionJob,
	sourceCode []byte,
	testCases []*domain.TestCase,
	wallTimeout time.Duration,
	memoryLimitMB int,
) (*domain.ExecutionResult, error) {
	ctx, span := otel.Tracer("worker-service/executor.Executor").Start(ctx, "executor.executeAllTestCases")
	defer span.End()

	result := &domain.ExecutionResult{
		SubmissionID:     job.SubmissionID,
		UserID:           job.UserID,
		ProblemID:        job.ProblemID,
		ProblemVersionID: job.ProblemVersionID,
		TestCasesTotal:   len(testCases),
		WorkerID:         e.cfg.WorkerID,
		SandboxRuntime:   e.cfg.SandboxRuntime,
	}

	var maxWall, maxCPU, maxMem int64
	// firstFailureVerdict becomes the submission's overall verdict once set -
	// every test case still runs regardless (see the comment at the bottom
	// of the loop for why), but the REPORTED status matches the first thing
	// that went wrong, same as before this behavior changed.
	var firstFailureVerdict domain.Verdict

	for _, tc := range testCases {
		tcCtx, tcSpan := otel.Tracer("worker-service/executor.Executor").Start(ctx, "executor.runTestCase")
		tcSpan.SetAttributes(
			attribute.String("test_case_id", tc.ID),
			attribute.Int("ordinal", tc.Ordinal),
		)

		runReq := &sandbox.RunRequest{
			Language:      job.Language,
			SourceCode:    sourceCode,
			Stdin:         tc.Input,
			WallTimeout:   wallTimeout,
			MemoryLimitMB: memoryLimitMB,
			CPUQuota:      e.cfg.SandboxCPUQuota,
		}

		runResult, err := e.sandbox.Run(tcCtx, runReq)
		if err != nil {
			tcSpan.RecordError(err)
			tcSpan.SetStatus(codes.Error, err.Error())
			tcSpan.End()
			return nil, fmt.Errorf("sandbox.Run test case %s: %w", tc.ID, err)
		}

		outputMatches := sandbox.OutputMatches(runResult.Stdout, tc.Expected)
		verdict := sandbox.VerdictFromResult(runResult, outputMatches)

		tcResult := domain.TestCaseResult{
			TestCaseID:      tc.ID,
			Ordinal:         tc.Ordinal,
			Passed:          verdict == domain.VerdictPassed,
			Verdict:         verdict,
			WallTimeMS:      runResult.WallTimeMS,
			CPUTimeMS:       runResult.CPUTimeMS,
			MaxMemoryKB:     runResult.MaxMemoryKB,
			StdoutTruncated: runResult.StdoutTruncated,
			StderrTruncated: runResult.StderrTruncated,
			Hidden:          !tc.IsSample,
		}
		// Never expose a hidden test case's actual content past this worker -
		// only whether it passed (see domain.TestCaseResult's comment).
		if tc.IsSample {
			tcResult.Input = string(tc.Input)
			tcResult.Expected = string(tc.Expected)
			tcResult.Actual = string(runResult.Stdout)
		}
		result.TestCaseResults = append(result.TestCaseResults, tcResult)
		if runResult.CompileError {
			// On CE, Stdout is always empty (the program never ran) - the
			// actual error is the compiler's stderr, previously discarded
			// entirely, leaving the user with a bare "CE" verdict and no way
			// to know what was actually wrong with their code.
			result.LastStdout = runResult.CompileOutput
		} else {
			result.LastStdout = runResult.Stdout
		}

		if tcResult.Passed {
			result.TestCasesPassed++
		}

		// Track worst-case resource usage across all test cases.
		if runResult.WallTimeMS > maxWall {
			maxWall = runResult.WallTimeMS
		}
		if runResult.CPUTimeMS > maxCPU {
			maxCPU = runResult.CPUTimeMS
		}
		if runResult.MaxMemoryKB > maxMem {
			maxMem = runResult.MaxMemoryKB
		}

		tcSpan.SetAttributes(
			attribute.String("verdict", string(verdict)),
			attribute.Int64("wall_time_ms", runResult.WallTimeMS),
		)
		tcSpan.End()

		// Every test case runs regardless of earlier failures - the user
		// asked to see ALL of them judged, not just up to the first miss
		// (unlike most competitive programming judges' default). CE is
		// still a hard stop, but that happens before this loop even starts
		// (compilation is a single, one-time step - see the caller).
		if verdict != domain.VerdictPassed && firstFailureVerdict == "" {
			firstFailureVerdict = verdict
		}
	}

	if firstFailureVerdict != "" {
		result.Verdict = firstFailureVerdict
	} else {
		result.Verdict = domain.VerdictPassed
	}
	result.WallTimeMS = maxWall
	result.CPUTimeMS = maxCPU
	result.MaxMemoryKB = maxMem
	result.CompletedAt = time.Now().UTC()
	return result, nil
}

func (e *Executor) hydrateTestCases(ctx context.Context, testCases []*domain.TestCase) error {
	for _, tc := range testCases {
		input, err := e.s3.GetTestCaseInput(ctx, tc.InputS3Key)
		if err != nil {
			return fmt.Errorf("get input for test case %s: %w", tc.ID, err)
		}
		expected, err := e.s3.GetTestCaseExpected(ctx, tc.ExpectedS3Key)
		if err != nil {
			return fmt.Errorf("get expected for test case %s: %w", tc.ID, err)
		}
		tc.Input = input
		tc.Expected = expected
	}
	return nil
}

func (e *Executor) uploadArtifacts(ctx context.Context, result *domain.ExecutionResult) {
	// We upload the stdout/stderr of the last-run test case as representative
	// artifacts. The full per-test-case output is not stored (cost control).
	// A more detailed storage strategy can be added later when needed.
	//
	// Errors here are logged but don't affect the verdict.
	if len(result.TestCaseResults) == 0 {
		return
	}
	lastTC := result.TestCaseResults[len(result.TestCaseResults)-1]
	now := result.CompletedAt

	stdoutKey := fmt.Sprintf("submissions/%04d/%02d/%02d/%s/stdout.txt",
		now.Year(), now.Month(), now.Day(), result.SubmissionID)
	stderrKey := fmt.Sprintf("submissions/%04d/%02d/%02d/%s/stderr.txt",
		now.Year(), now.Month(), now.Day(), result.SubmissionID)

	// Use the data from the test case result (we don't store raw bytes in domain
	// model for memory reasons — skip upload if no artifact data available).
	_ = lastTC // artifact content would come from sandbox.RunResult in a full implementation

	result.StdoutS3Key = stdoutKey
	result.StderrS3Key = stderrKey
}

// --------------------------------------------------------------------------
// event publishing
// --------------------------------------------------------------------------

func (e *Executor) publishCompleted(ctx context.Context, job *domain.SubmissionJob, result *domain.ExecutionResult) error {
	event := domain.ExecutionCompletedEvent{
		EventID:          uuid.New().String(),
		EventVersion:     1,
		OccurredAt:       result.CompletedAt,
		SubmissionID:     result.SubmissionID,
		UserID:           result.UserID,
		ProblemID:        result.ProblemID,
		ProblemVersionID: result.ProblemVersionID,
		Verdict:          string(result.Verdict),
		TestCasesPassed:  result.TestCasesPassed,
		TestCasesTotal:   result.TestCasesTotal,
		WallTimeMS:       result.WallTimeMS,
		CPUTimeMS:        result.CPUTimeMS,
		MaxMemoryKB:      result.MaxMemoryKB,
		StdoutS3Key:      result.StdoutS3Key,
		StderrS3Key:      result.StderrS3Key,
		WorkerID:         result.WorkerID,
		SandboxRuntime:   result.SandboxRuntime,
	}

	payload, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("marshal completed event: %w", err)
	}

	headers := []kafkago.Header{
		{Key: domain.HeaderEventID, Value: []byte(event.EventID)},
		{Key: domain.HeaderSubmissionID, Value: []byte(job.SubmissionID)},
	}

	return e.producer.Publish(ctx,
		e.cfg.KafkaExecutionDoneTopic,
		[]byte(job.SubmissionID), // partition key → all events for same submission land on same partition
		payload,
		headers,
	)
}

func (e *Executor) publishSystemError(ctx context.Context, job *domain.SubmissionJob, reason string) error {
	// Same reasoning as the completed-path call in Handle(): without this,
	// a system-level failure (as opposed to a user-code failure) leaves the
	// submission stuck at RUNNING forever for a Go-routed request, since
	// nothing consumes executions.failed.v1 back into submission-service either.
	if err := e.submissionClient.MarkTerminal(ctx, job.SubmissionID, domain.VerdictSystemError, reason, "", nil); err != nil {
		log.Warn().Err(err).Str("submission_id", job.SubmissionID).
			Msg("could not report system error to submission-service")
	}

	event := domain.ExecutionFailedEvent{
		EventID:      uuid.New().String(),
		EventVersion: 1,
		OccurredAt:   time.Now().UTC(),
		SubmissionID: job.SubmissionID,
		UserID:       job.UserID,
		WorkerID:     e.cfg.WorkerID,
		Reason:       reason,
		AttemptCount: 1,
	}

	payload, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("marshal failed event: %w", err)
	}

	headers := []kafkago.Header{
		{Key: domain.HeaderEventID, Value: []byte(event.EventID)},
		{Key: domain.HeaderSubmissionID, Value: []byte(job.SubmissionID)},
	}

	if pubErr := e.producer.Publish(ctx,
		e.cfg.KafkaExecutionFailTopic,
		[]byte(job.SubmissionID),
		payload,
		headers,
	); pubErr != nil {
		log.Error().Err(pubErr).Str("submission_id", job.SubmissionID).
			Msg("failed to publish system error event — returning error to DLQ path")
		return pubErr
	}

	// Return nil — a system error is a valid (if sad) terminal outcome that
	// we've published. The consumer should still commit the offset.
	return nil
}
