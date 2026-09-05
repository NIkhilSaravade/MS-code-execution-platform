// Package executor orchestrates the full lifecycle of one submission:
//   1. Compile (if needed) and run each test case inside the sandbox
//   2. Aggregate the final verdict + an empirical complexity estimate
//   3. Upload stdout/stderr artifacts to S3
//   4. Publish the result to execution-result-topic (or a system-error
//      failure to executions.failed.v1)
//
// The executor no longer calls problem-service or submission-service itself:
// submission-service embeds everything the job needs (test cases, limits)
// into the SubmissionCreatedEvent, and execution-result-service is the only
// service this worker reports results to - see the "worker overhead at
// scale" redesign this implements.
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

	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/complexity"
	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/config"
	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/domain"
	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/kafka"
	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/sandbox"
	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/storage"
)

// Executor is the kafka.Handler implementation. One instance is shared across
// all goroutines — all dependencies must be safe for concurrent use.
type Executor struct {
	cfg     *config.Config
	sandbox *sandbox.Sandbox
	s3      *storage.S3Client
	producer *kafka.Producer
}

// New wires up an Executor with all its dependencies.
func New(
	cfg *config.Config,
	sb *sandbox.Sandbox,
	s3 *storage.S3Client,
	producer *kafka.Producer,
) *Executor {
	return &Executor{
		cfg:      cfg,
		sandbox:  sb,
		s3:       s3,
		producer: producer,
	}
}

// Handle processes a single submission job. It satisfies the kafka.Handler interface.
// Returning an error causes the consumer to route the message to the DLQ.
// System errors (infrastructure failures) are returned as errors.
// User-code verdicts (TLE, MLE, RE, CE, FAILED) are not errors — they are
// valid outcomes that are published to execution-result-topic.
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

	// ── Step 1: Resolve limits + test cases from the embedded job payload ────
	// No problem-service call - submission-service already fetched and
	// embedded these (see SubmissionCreatedEvent.TestCases/TimeLimitMS).
	timeLimitMS := job.TimeLimitMS
	memoryLimitMB := job.MemoryLimitMB
	if timeLimitMS <= 0 {
		timeLimitMS = int(e.cfg.SandboxWallTimeout.Milliseconds())
	}
	if memoryLimitMB <= 0 {
		memoryLimitMB = e.cfg.SandboxMemoryMB
	}
	wallTimeout := time.Duration(timeLimitMS) * time.Millisecond

	testCases := make([]*domain.TestCase, 0, len(job.TestCases))
	for _, tc := range job.TestCases {
		testCases = append(testCases, &domain.TestCase{
			ID:            tc.ID,
			Ordinal:       tc.Ordinal,
			IsSample:      tc.IsSample,
			InputS3Key:    tc.InputS3Key,
			ExpectedS3Key: tc.ExpectedS3Key,
			Weight:        tc.Weight,
		})
	}
	if len(testCases) == 0 {
		return e.publishSystemError(ctx, job, "submission event carried no test cases")
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
	logger.Info().Int("test_cases", len(testCases)).Msg("resolved test cases from embedded job payload")

	// ── Step 2: Download source code ─────────────────────────────────────────
	sourceCode, err := e.s3.GetSubmissionCode(ctx, job.CodeS3Key)
	if err != nil {
		return e.publishSystemError(ctx, job, fmt.Sprintf("download code from S3: %v", err))
	}

	// ── Step 3: Download test case content (input + expected) from S3 ────────
	if err := e.hydrateTestCases(ctx, testCases); err != nil {
		return e.publishSystemError(ctx, job, fmt.Sprintf("hydrate test case content: %v", err))
	}

	// ── Step 4: Execute ───────────────────────────────────────────────────────
	result, err := e.executeAllTestCases(ctx, job, sourceCode, testCases, wallTimeout, memoryLimitMB)
	if err != nil {
		// Infrastructure failure during execution — mark as SYSTEM_ERROR.
		return e.publishSystemError(ctx, job, fmt.Sprintf("execution infrastructure error: %v", err))
	}

	// ── Step 5: Static complexity estimate ─────────────────────────────────────
	// Deterministic structural analysis of the user's own code (loop nesting,
	// recursion, sort calls) - no LLM, no external dependency, and (unlike an
	// empirical/timing-based estimate) doesn't need test-case size variation
	// to produce an answer. See internal/complexity.
	result.EstimatedTimeComplexity, result.EstimatedSpaceComplexity =
		complexity.EstimateStatic(job.RawCode, string(job.Language))

	// ── Step 6: Upload artifacts ─────────────────────────────────────────────
	// Best-effort — artifact upload failure doesn't change the verdict.
	e.uploadArtifacts(ctx, result)

	// ── Step 7: Publish the result ─────────────────────────────────────────────
	if err := e.publishResult(ctx, result, ""); err != nil {
		// This is the most critical failure path. We've executed the code and
		// know the verdict but can't publish it. Return the error so the Kafka
		// consumer can route to DLQ, but note the submission is now stuck in
		// PENDING state until submission-service times it out.
		logger.Error().Err(err).
			Str("verdict", string(result.Verdict)).
			Msg("CRITICAL: execution complete but failed to publish result event")
		return fmt.Errorf("publish result event: %w", err)
	}

	logger.Info().
		Str("verdict", string(result.Verdict)).
		Int("passed", result.TestCasesPassed).
		Int("total", result.TestCasesTotal).
		Int64("wall_time_ms", result.WallTimeMS).
		Str("estimated_time_complexity", result.EstimatedTimeComplexity).
		Str("estimated_space_complexity", result.EstimatedSpaceComplexity).
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

	// One Pod checked out for the whole submission - compiled languages
	// compile ONCE here, then every test case execs into the same running
	// pod, instead of the old per-test-case container (see the k3s-migration
	// design note on why isolation is scoped per-submission, not per-test-case,
	// and why compiling once per test case was no longer viable once a
	// Kubernetes Pod launch replaced a near-instant `docker run`).
	session, err := e.sandbox.NewSession(ctx, &sandbox.SessionRequest{
		Language:      job.Language,
		SourceCode:    sourceCode,
		WallTimeout:   wallTimeout,
		MemoryLimitMB: memoryLimitMB,
		CPUQuota:      e.cfg.SandboxCPUQuota,
	})
	if err != nil {
		return nil, fmt.Errorf("create sandbox session: %w", err)
	}
	defer session.Close()

	if session.CompileError {
		// Compilation is a single, one-time step now (not per test case) -
		// every test case gets the same CE verdict without ever running.
		for _, tc := range testCases {
			tcResult := domain.TestCaseResult{
				TestCaseID:     tc.ID,
				Ordinal:        tc.Ordinal,
				Passed:         false,
				Verdict:        domain.VerdictCE,
				Hidden:         !tc.IsSample,
				InputSizeBytes: len(tc.Input),
			}
			if tc.IsSample {
				tcResult.Input = string(tc.Input)
				tcResult.Expected = string(tc.Expected)
			}
			result.TestCaseResults = append(result.TestCaseResults, tcResult)
		}
		result.Verdict = domain.VerdictCE
		result.LastStdout = session.CompileOutput
		result.CompletedAt = time.Now().UTC()
		return result, nil
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

		runResult, err := session.RunTestCase(tcCtx, tc.Input, wallTimeout)
		if err != nil {
			tcSpan.RecordError(err)
			tcSpan.SetStatus(codes.Error, err.Error())
			tcSpan.End()
			return nil, fmt.Errorf("sandbox.RunTestCase test case %s: %w", tc.ID, err)
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
			InputSizeBytes:  len(tc.Input),
		}
		// Never expose a hidden test case's actual content past this worker -
		// only whether it passed (see domain.TestCaseResult's comment).
		if tc.IsSample {
			tcResult.Input = string(tc.Input)
			tcResult.Expected = string(tc.Expected)
			tcResult.Actual = string(runResult.Stdout)
		}
		result.TestCaseResults = append(result.TestCaseResults, tcResult)
		result.LastStdout = runResult.Stdout

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

// publishResult publishes the judged (or system-error) result to
// execution-result-topic - the single ingestion point execution-result-service
// consumes, regardless of which worker produced it.
func (e *Executor) publishResult(ctx context.Context, result *domain.ExecutionResult, reason string) error {
	event := domain.ExecutionResultEvent{
		SubmissionID:              result.SubmissionID,
		UserID:                    result.UserID,
		ProblemID:                 result.ProblemID,
		Status:                    string(result.Verdict),
		Output:                    string(result.LastStdout),
		Reason:                    reason,
		TestCaseResults:           result.TestCaseResults,
		WallTimeMS:                result.WallTimeMS,
		MaxMemoryKB:               result.MaxMemoryKB,
		EstimatedTimeComplexity:   result.EstimatedTimeComplexity,
		EstimatedSpaceComplexity:  result.EstimatedSpaceComplexity,
		WorkerID:                  result.WorkerID,
		CompletedAt:               result.CompletedAt.Format(time.RFC3339),
	}

	payload, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("marshal result event: %w", err)
	}

	headers := []kafkago.Header{
		{Key: domain.HeaderEventID, Value: []byte(uuid.New().String())},
		{Key: domain.HeaderSubmissionID, Value: []byte(result.SubmissionID)},
	}

	return e.producer.Publish(ctx,
		e.cfg.KafkaExecutionResultTopic,
		[]byte(result.SubmissionID), // partition key → all events for same submission land on same partition
		payload,
		headers,
	)
}

func (e *Executor) publishSystemError(ctx context.Context, job *domain.SubmissionJob, reason string) error {
	// Publish the SAME unified result event (status=SYSTEM_ERROR) that a
	// normal completion would, so execution-result-service (and, via its
	// submission-update-topic event, submission-service) always hears about
	// this submission's terminal state - a system failure is a valid, if
	// sad, terminal outcome, not something to leave stuck at PENDING.
	resultErr := e.publishResult(ctx, &domain.ExecutionResult{
		SubmissionID: job.SubmissionID,
		UserID:       job.UserID,
		ProblemID:    job.ProblemID,
		Verdict:      domain.VerdictSystemError,
		WorkerID:     e.cfg.WorkerID,
		CompletedAt:  time.Now().UTC(),
	}, reason)
	if resultErr != nil {
		log.Warn().Err(resultErr).Str("submission_id", job.SubmissionID).
			Msg("could not publish system-error result event")
	}

	// Also published to executions.failed.v1 for the separate infra-alerting
	// pipeline (distinct concern from the user-facing result above).
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
