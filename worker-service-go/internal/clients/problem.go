package clients

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/propagation"

	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/auth"
	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/config"
	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/domain"
	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/eureka"
)

// ProblemClient fetches test case metadata from problem-service.
// The actual test case content (input, expected output) lives in S3;
// this client only retrieves the S3 keys and ordering metadata.
type ProblemClient struct {
	eureka      *eureka.Client
	fallbackURL string // used only if Eureka has no UP instance registered
	http        *http.Client
	tokens      *auth.TokenSource
}

// NewProblemClient creates the client with a generous timeout because
// problem-service is read-heavy and cache-backed — most calls return fast,
// but cold misses can be slower. tokens supplies the bearer token attached
// to every request: problem-service's /internal/** routes require a service
// access token (client-credentials grant), not a user's token, since the
// worker has no inbound HTTP request to forward one from.
func NewProblemClient(cfg *config.Config, tokens *auth.TokenSource, ec *eureka.Client) *ProblemClient {
	return &ProblemClient{
		eureka:      ec,
		fallbackURL: cfg.ProblemServiceBaseURL,
		tokens:      tokens,
		http: &http.Client{
			Timeout: 8 * time.Second,
			Transport: &http.Transport{
				MaxIdleConns:        20,
				MaxIdleConnsPerHost: 10,
				IdleConnTimeout:     90 * time.Second,
			},
		},
	}
}

// resolveBaseURL asks Eureka for a live PROBLEM-SERVICE instance instead of
// using a fixed, env-configured URL - see internal/eureka's package doc.
// Falls back to the env-configured URL only if Eureka has nothing (e.g.
// briefly during startup, before its registration has propagated).
func (c *ProblemClient) resolveBaseURL(ctx context.Context) string {
	url, err := c.eureka.ResolveBaseURL(ctx, "PROBLEM-SERVICE")
	if err != nil {
		return c.fallbackURL
	}
	return url
}

// authorize attaches a service access token to the outgoing request.
func (c *ProblemClient) authorize(ctx context.Context, req *http.Request) error {
	token, err := c.tokens.Token(ctx)
	if err != nil {
		return fmt.Errorf("fetch service token: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	return nil
}

// GetTestCases returns all test cases for a specific problem version.
// The worker binds to problem_version_id at execution time so that
// historical verdicts remain reproducible even when test cases are updated.
func (c *ProblemClient) GetTestCases(ctx context.Context, problemVersionID string) ([]*domain.TestCase, error) {
	ctx, span := otel.Tracer("worker-service/clients.ProblemClient").Start(ctx, "problem.getTestCases")
	defer span.End()
	span.SetAttributes(attribute.String("problem_version_id", problemVersionID))

	url := fmt.Sprintf("%s/internal/problem-versions/%s/test-cases", c.resolveBaseURL(ctx), problemVersionID)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	if err := c.authorize(ctx, req); err != nil {
		return nil, err
	}
	otel.GetTextMapPropagator().Inject(ctx, propagation.HeaderCarrier(req.Header))

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("GET %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("problem-service returned %d for version %s", resp.StatusCode, problemVersionID)
	}

	var body testCasesResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("decode test cases response: %w", err)
	}

	tcs := make([]*domain.TestCase, 0, len(body.TestCases))
	for _, tc := range body.TestCases {
		tcs = append(tcs, &domain.TestCase{
			ID:            tc.ID,
			Ordinal:       tc.Ordinal,
			IsSample:      tc.IsSample,
			InputS3Key:    tc.InputS3Key,
			ExpectedS3Key: tc.ExpectedS3Key,
			Weight:        tc.Weight,
		})
	}
	return tcs, nil
}

// GetProblemLimits fetches the time and memory limits for a specific problem.
// These override the global sandbox defaults when the problem's statement
// demands tighter or looser constraints.
func (c *ProblemClient) GetProblemLimits(ctx context.Context, problemID string) (timeLimitMS int, memoryLimitMB int, err error) {
	ctx, span := otel.Tracer("worker-service/clients.ProblemClient").Start(ctx, "problem.getLimits")
	defer span.End()
	span.SetAttributes(attribute.String("problem_id", problemID))

	url := fmt.Sprintf("%s/internal/problems/%s/limits", c.resolveBaseURL(ctx), problemID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, 0, fmt.Errorf("build request: %w", err)
	}
	if err := c.authorize(ctx, req); err != nil {
		return 0, 0, err
	}
	otel.GetTextMapPropagator().Inject(ctx, propagation.HeaderCarrier(req.Header))

	resp, err := c.http.Do(req)
	if err != nil {
		return 0, 0, fmt.Errorf("GET %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return 0, 0, fmt.Errorf("problem-service returned %d for problem %s limits", resp.StatusCode, problemID)
	}

	var body limitsResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return 0, 0, fmt.Errorf("decode limits response: %w", err)
	}
	return body.TimeLimitMS, body.MemoryLimitMB, nil
}

// --------------------------------------------------------------------------
// wire types — internal API contract with problem-service
// --------------------------------------------------------------------------

type testCasesResponse struct {
	TestCases []testCaseDTO `json:"test_cases"`
}

type testCaseDTO struct {
	ID            string `json:"id"`
	Ordinal       int    `json:"ordinal"`
	IsSample      bool   `json:"is_sample"`
	InputS3Key    string `json:"input_s3_key"`
	ExpectedS3Key string `json:"expected_s3_key"`
	Weight        int    `json:"weight"`
}

type limitsResponse struct {
	TimeLimitMS   int `json:"time_limit_ms"`
	MemoryLimitMB int `json:"memory_limit_mb"`
}
