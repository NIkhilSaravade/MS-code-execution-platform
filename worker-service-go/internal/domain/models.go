package domain

import "time"

// --------------------------------------------------------------------------
// Verdict constants — match the submission state machine in the dev plan.
// Terminal states only; CREATED / QUEUED / RUNNING live in submission-service.
// --------------------------------------------------------------------------

type Verdict string

const (
	VerdictPassed      Verdict = "PASSED"
	VerdictFailed      Verdict = "FAILED"
	VerdictTLE         Verdict = "TLE"  // time limit exceeded
	VerdictMLE         Verdict = "MLE"  // memory limit exceeded
	VerdictRE          Verdict = "RE"   // runtime error
	VerdictCE          Verdict = "CE"   // compilation error
	VerdictSystemError Verdict = "SYSTEM_ERROR"
)

// --------------------------------------------------------------------------
// Language constants
// --------------------------------------------------------------------------

type Language string

const (
	LangPython Language = "python"
	LangJava   Language = "java"
	LangCPP    Language = "cpp"
)

// SupportedLanguages is the allow-list checked before spawning any container.
var SupportedLanguages = map[Language]bool{
	LangPython: true,
	LangJava:   true,
	LangCPP:    true,
}

// --------------------------------------------------------------------------
// TestCase — a single judge input/output pair for a problem version.
// Content comes from S3; metadata comes from problem-service.
// --------------------------------------------------------------------------

type TestCase struct {
	ID              string
	Ordinal         int
	IsSample        bool
	InputS3Key      string
	ExpectedS3Key   string
	Weight          int

	// Populated after S3 fetch
	Input    []byte
	Expected []byte
}

// --------------------------------------------------------------------------
// SubmissionJob — what the worker extracts from a submissions.created.v1 event.
// --------------------------------------------------------------------------

type SubmissionJob struct {
	EventID         string
	SubmissionID    string
	UserID          string
	ProblemID       string
	ProblemVersionID string
	Language        Language
	CodeS3Key       string
	CodeHash        string
	OccurredAt      time.Time

	// Trace context forwarded from the Kafka header so spans chain correctly.
	TraceParent string
	TraceState  string
}

// --------------------------------------------------------------------------
// TestCaseResult — outcome for a single test case run inside the sandbox.
// --------------------------------------------------------------------------

type TestCaseResult struct {
	TestCaseID      string  `json:"test_case_id"`
	Ordinal         int     `json:"ordinal"`
	Passed          bool    `json:"passed"`
	Verdict         Verdict `json:"verdict"`
	WallTimeMS      int64   `json:"wall_time_ms"`
	CPUTimeMS       int64   `json:"cpu_time_ms"`
	MaxMemoryKB     int64   `json:"max_memory_kb"`
	StdoutTruncated bool    `json:"stdout_truncated"`
	StderrTruncated bool    `json:"stderr_truncated"`

	// Hidden mirrors the test case's !IsSample - true for hidden cases.
	// Input/Expected/Actual are only ever populated for non-hidden cases
	// (see executor.go's executeAllTestCases): a hidden test case's content
	// is never sent anywhere past this worker, only whether it passed.
	Hidden   bool   `json:"hidden"`
	Input    string `json:"input,omitempty"`
	Expected string `json:"expected,omitempty"`
	Actual   string `json:"actual,omitempty"`
}

// --------------------------------------------------------------------------
// ExecutionResult — the aggregate outcome of all test cases for one submission.
// This is what gets published as executions.completed.v1.
// --------------------------------------------------------------------------

type ExecutionResult struct {
	SubmissionID    string
	UserID          string
	ProblemID       string
	ProblemVersionID string
	Verdict         Verdict
	TestCaseResults []TestCaseResult
	TestCasesPassed int
	TestCasesTotal  int
	WallTimeMS      int64   // best-case (fastest passing case or case that triggered terminal verdict)
	CPUTimeMS       int64
	MaxMemoryKB     int64
	StdoutS3Key     string
	StderrS3Key     string
	WorkerID        string
	SandboxRuntime  string
	CompletedAt     time.Time

	// Populated on system-level failure (not user-code failure).
	SystemError string

	// LastStdout is the most recent test case's raw output. Not part of the
	// executions.completed.v1 event (kept lightweight, see uploadArtifacts) -
	// used only for the optimistic-feedback HTTP call to submission-service
	// (SubmissionClient.MarkTerminal) so the frontend has something to show
	// immediately instead of waiting on artifact upload/S3 fetch.
	LastStdout []byte
}
