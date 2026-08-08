// Package auth provides OAuth2 client-credentials authentication for
// worker-service's calls to other internal services (problem-service,
// submission-service). The worker authenticates as itself, not on behalf
// of a user - see auth-service's ServiceTokenController and its
// /auth/token endpoint (RFC 6749 section 4.4).
package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/nikhilsaravade95/code-execution-platform/worker-service/internal/eureka"
)

// refreshSkew is how far ahead of the real expiry we refresh, so a token
// already in flight on a request doesn't go stale mid-request.
const refreshSkew = 30 * time.Second

// TokenSource fetches and caches a client-credentials access token from
// auth-service. Safe for concurrent use; refreshes the token shortly before
// it expires rather than re-authenticating on every call.
type TokenSource struct {
	eureka       *eureka.Client
	fallbackURL  string // used only if Eureka has no UP instance registered
	clientID     string
	clientSecret string
	http         *http.Client

	mu        sync.Mutex
	cached    string
	expiresAt time.Time
}

// NewTokenSource creates a TokenSource that resolves auth-service through
// Eureka (see internal/eureka's package doc) rather than a fixed URL,
// falling back to authServiceURL only if Eureka has no UP instance
// registered yet.
func NewTokenSource(authServiceURL, clientID, clientSecret string, ec *eureka.Client) *TokenSource {
	return &TokenSource{
		eureka:       ec,
		fallbackURL:  strings.TrimRight(authServiceURL, "/"),
		clientID:     clientID,
		clientSecret: clientSecret,
		http: &http.Client{
			Timeout: 5 * time.Second,
		},
	}
}

// resolveBaseURL asks Eureka for a live AUTH-SERVICE instance.
func (t *TokenSource) resolveBaseURL(ctx context.Context) string {
	baseURL, err := t.eureka.ResolveBaseURL(ctx, "AUTH-SERVICE")
	if err != nil {
		return t.fallbackURL
	}
	return baseURL
}

// Token returns a valid access token, fetching a new one if the cached
// token is missing or close to expiry.
func (t *TokenSource) Token(ctx context.Context) (string, error) {
	t.mu.Lock()
	defer t.mu.Unlock()

	if t.cached != "" && time.Now().Before(t.expiresAt.Add(-refreshSkew)) {
		return t.cached, nil
	}

	token, expiresIn, err := t.fetch(ctx)
	if err != nil {
		return "", err
	}

	t.cached = token
	t.expiresAt = time.Now().Add(time.Duration(expiresIn) * time.Second)
	return t.cached, nil
}

type tokenResponse struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
	ExpiresIn   int64  `json:"expires_in"`
}

func (t *TokenSource) fetch(ctx context.Context) (string, int64, error) {
	form := url.Values{}
	form.Set("grant_type", "client_credentials")
	form.Set("client_id", t.clientID)
	form.Set("client_secret", t.clientSecret)

	tokenURL := fmt.Sprintf("%s/auth/token", t.resolveBaseURL(ctx))

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", 0, fmt.Errorf("build token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := t.http.Do(req)
	if err != nil {
		return "", 0, fmt.Errorf("POST %s: %w", tokenURL, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", 0, fmt.Errorf("auth-service returned %d fetching service token", resp.StatusCode)
	}

	var body tokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return "", 0, fmt.Errorf("decode token response: %w", err)
	}
	if body.AccessToken == "" {
		return "", 0, fmt.Errorf("auth-service returned an empty access_token")
	}

	return body.AccessToken, body.ExpiresIn, nil
}
