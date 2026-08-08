package domain

import "time"

// --------------------------------------------------------------------------
// Inbound: submissions.created.v1
// Produced by submission-service; consumed by worker-service.
// --------------------------------------------------------------------------

type SubmissionCreatedEvent struct {
	EventID          string    `json:"event_id"`
	EventVersion     int       `json:"event_version"`
	OccurredAt       time.Time `json:"occurred_at"`
	SubmissionID     string    `json:"submission_id"`
	UserID           string    `json:"user_id"`
	ProblemID        string    `json:"problem_id"`
	ProblemVersionID string    `json:"problem_version_id"`
	Language         string    `json:"language"`
	CodeS3Key        string    `json:"code_s3_key"`
	CodeHash         string    `json:"code_hash"`
	IncludeHidden    bool      `json:"include_hidden"`
}

// --------------------------------------------------------------------------
// Outbound: executions.completed.v1
// Produced by worker-service; consumed by results-service and ai-analysis-service.
// --------------------------------------------------------------------------

type ExecutionCompletedEvent struct {
	EventID          string    `json:"event_id"`
	EventVersion     int       `json:"event_version"`
	OccurredAt       time.Time `json:"occurred_at"`
	SubmissionID     string    `json:"submission_id"`
	UserID           string    `json:"user_id"`
	ProblemID        string    `json:"problem_id"`
	ProblemVersionID string    `json:"problem_version_id"`
	Verdict          string    `json:"verdict"`
	TestCasesPassed  int       `json:"test_cases_passed"`
	TestCasesTotal   int       `json:"test_cases_total"`
	WallTimeMS       int64     `json:"wall_time_ms"`
	CPUTimeMS        int64     `json:"cpu_time_ms"`
	MaxMemoryKB      int64     `json:"max_memory_kb"`
	StdoutS3Key      string    `json:"stdout_s3_key,omitempty"`
	StderrS3Key      string    `json:"stderr_s3_key,omitempty"`
	WorkerID         string    `json:"worker_id"`
	SandboxRuntime   string    `json:"sandbox_runtime"`
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
