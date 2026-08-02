package clients

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"

	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/auth"
	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/config"
	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/domain"
)

// SubmissionClient calls the submission-service internal API to transition
// a submission's state. The worker marks RUNNING at the start of execution
// and the terminal verdict after it completes — both via this client.
//
// Note: the submission's final state is also communicated via the
// executions.completed.v1 Kafka event that submission-service consumes.
// The direct HTTP call here provides faster optimistic feedback to the client.
type SubmissionClient struct {
	baseURL string
	http    *http.Client
	tokens  *auth.TokenSource
}

// NewSubmissionClient creates a client with conservative timeouts.
// Total timeout (5s) is shorter than the caller's own deadline so the
// worker still has time to handle the error gracefully. tokens supplies the
// bearer token attached to every request - see ProblemClient.authorize for why.
func NewSubmissionClient(cfg *config.Config, tokens *auth.TokenSource) *SubmissionClient {
	return &SubmissionClient{
		baseURL: cfg.SubmissionServiceBaseURL,
		tokens:  tokens,
		http: &http.Client{
			Timeout: 5 * time.Second,
			Transport: &http.Transport{
				MaxIdleConns:        20,
				MaxIdleConnsPerHost: 10,
				IdleConnTimeout:     90 * time.Second,
			},
		},
	}
}

// authorize attaches a service access token to the outgoing request.
func (c *SubmissionClient) authorize(ctx context.Context, req *http.Request) error {
	token, err := c.tokens.Token(ctx)
	if err != nil {
		return fmt.Errorf("fetch service token: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	return nil
}

// MarkRunning transitions the submission to the RUNNING state.
// A failure here is non-fatal: we log and continue. The Kafka event will
// eventually reconcile the state, but the user sees the live update sooner
// when this call succeeds.
func (c *SubmissionClient) MarkRunning(ctx context.Context, submissionID string) error {
	return c.updateState(ctx, submissionID, "RUNNING", "")
}

// MarkTerminal transitions the submission to a terminal verdict state.
func (c *SubmissionClient) MarkTerminal(ctx context.Context, submissionID string, verdict domain.Verdict) error {
	return c.updateState(ctx, submissionID, string(verdict), "")
}

// --------------------------------------------------------------------------
// internal
// --------------------------------------------------------------------------

type stateUpdateRequest struct {
	State  string `json:"state"`
	Reason string `json:"reason,omitempty"`
}

func (c *SubmissionClient) updateState(ctx context.Context, submissionID, state, reason string) error {
	ctx, span := otel.Tracer("worker-service/clients.SubmissionClient").Start(ctx, "submission.updateState")
	defer span.End()
	span.SetAttributes(
		attribute.String("submission_id", submissionID),
		attribute.String("target_state", state),
	)

	body, _ := json.Marshal(stateUpdateRequest{State: state, Reason: reason})
	url := fmt.Sprintf("%s/internal/submissions/%s/state", c.baseURL, submissionID)

	req, err := http.NewRequestWithContext(ctx, http.MethodPatch, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if err := c.authorize(ctx, req); err != nil {
		return err
	}

	// Inject OTel context so the submission-service span is a child of this one.
	otel.GetTextMapPropagator().Inject(ctx, propagation.HeaderCarrier(req.Header))

	resp, err := c.http.Do(req)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return fmt.Errorf("PATCH %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		err := fmt.Errorf("submission-service returned %d for state transition %s→%s", resp.StatusCode, submissionID, state)
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return err
	}
	return nil
}
