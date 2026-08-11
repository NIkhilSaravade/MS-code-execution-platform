package domain

import "time"

// --------------------------------------------------------------------------
// Inbound: submissions.created.v1
// Produced by submission-service; consumed by worker-service.
// --------------------------------------------------------------------------

type SubmissionCreatedEvent struct {
	EventID          string        `json:"event_id"`
	EventVersion     int           `json:"event_version"`
	OccurredAt       time.Time     `json:"occurred_at"`
	SubmissionID     string        `json:"submission_id"`
	UserID           string        `json:"user_id"`
	ProblemID        string        `json:"problem_id"`
	ProblemVersionID string        `json:"problem_version_id"`
	Language         string        `json:"language"`
	CodeS3Key        string        `json:"code_s3_key"`
	CodeHash         string        `json:"code_hash"`
	IncludeHidden    bool          `json:"include_hidden"`

	// Embedded by submission-service (see InternalProblemClient) so this
	// worker never has to call problem-service itself per submission.
	TestCases     []TestCaseDTO `json:"test_cases"`
	TimeLimitMS   int           `json:"time_limit_ms"`
	MemoryLimitMB int           `json:"memory_limit_mb"`

	// The user's ORIGINAL submitted code, distinct from the harness-glued
	// code referenced by CodeS3Key - see internal/complexity's static
	// analysis, which needs just the user's own algorithm.
	RawCode string `json:"raw_code"`
}

// TestCaseDTO mirrors problem-service's InternalTestCaseDTO /
// submission-service's copy of the same shape - field names/JSON keys must
// match exactly, this is a cross-language contract.
type TestCaseDTO struct {
	ID            string `json:"id"`
	Ordinal       int    `json:"ordinal"`
	IsSample      bool   `json:"is_sample"`
	InputS3Key    string `json:"input_s3_key"`
	ExpectedS3Key string `json:"expected_s3_key"`
	Weight        int    `json:"weight"`
}

// --------------------------------------------------------------------------
// Outbound: execution-result-topic
// Produced by both workers; consumed by execution-result-service, which is
// now the single ingestion point for judged results (see
// execution-result-service.ExecutionResultService). Field names must match
// its (extended) ExecutionResultEvent DTO exactly - submissionId/userId/
// problemId are JSON strings on both sides.
// --------------------------------------------------------------------------

type ExecutionResultEvent struct {
	SubmissionID string                `json:"submissionId"`
	UserID       string                `json:"userId"`
	ProblemID    string                `json:"problemId"`
	Status       string                `json:"status"`
	Output       string                `json:"output"`
	Reason       string                `json:"reason,omitempty"`
	TestCaseResults []TestCaseResult   `json:"testCaseResults"`
	WallTimeMS   int64                 `json:"wallTimeMs"`
	MaxMemoryKB  int64                 `json:"maxMemoryKb"`
	EstimatedTimeComplexity  string    `json:"estimatedTimeComplexity"`
	EstimatedSpaceComplexity string    `json:"estimatedSpaceComplexity"`
	WorkerID     string                `json:"workerId"`
	CompletedAt  string                `json:"completedAt"`
}

// --------------------------------------------------------------------------
// Outbound: executions.failed.v1
// Published when the platform itself fails (not the user's code).
// Consumed by results-service and the alert pipeline.
// --------------------------------------------------------------------------

type ExecutionFailedEvent struct {
	EventID      string    `json:"event_id"`
	EventVersion int       `json:"event_version"`
	OccurredAt   time.Time `json:"occurred_at"`
	SubmissionID string    `json:"submission_id"`
	UserID       string    `json:"user_id"`
	WorkerID     string    `json:"worker_id"`
	Reason       string    `json:"reason"`
	AttemptCount int       `json:"attempt_count"`
}

// --------------------------------------------------------------------------
// Kafka header keys — used to propagate trace context and metadata.
// OTel W3C trace context headers.
// --------------------------------------------------------------------------

const (
	HeaderTraceParent    = "traceparent"
	HeaderTraceState     = "tracestate"
	HeaderEventID        = "event_id"
	HeaderSubmissionID   = "submission_id"
	HeaderAttemptCount   = "attempt_count"
)
