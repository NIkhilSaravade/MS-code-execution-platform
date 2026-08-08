// Package eureka is a minimal, hand-written client for Netflix Eureka's REST
// API (JSON mode) - registration, heartbeating, deregistration, and instance
// lookup. Go has no first-party Eureka client the way Spring Cloud gives
// every Java service in this platform one, and the protocol itself is small
// enough (a handful of plain HTTP endpoints) that pulling in a third-party
// library wasn't worth it - this mirrors the same "small, purpose-built
// client" pattern already used for auth-service/problem-service/
// submission-service elsewhere in this codebase.
//
// Two responsibilities:
//  1. Register this worker with discovery-service so it's visible on the
//     Eureka dashboard, like every other service in this platform.
//  2. Resolve OTHER services' base URLs (problem-service, submission-service,
//     auth-service) by looking them up in Eureka instead of using a fixed,
//     env-configured URL - see clients.ProblemClient/SubmissionClient and
//     auth.TokenSource for where this replaces the old direct-call config.
package eureka

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
)

// heartbeatInterval matches Eureka's own default lease renewal interval
// (30s) - client and server both assume this cadence for lease expiry math.
const heartbeatInterval = 30 * time.Second

// resolveCacheTTL bounds how long a resolved instance URL is reused before
// this client re-queries Eureka. Short enough that a newly (un)registered
// instance is picked up quickly; long enough that routine calls to
// problem-service/submission-service don't each cost a round trip to Eureka
// first.
const resolveCacheTTL = 30 * time.Second

// Client registers this worker with Eureka and resolves other services'
// instances through it. Safe for concurrent use.
type Client struct {
	serverURL  string // e.g. http://discovery-service:8761/eureka
	http       *http.Client
	appName    string // this instance's own registered app name
	instanceID string
	hostName   string
	ipAddr     string

	mu    sync.RWMutex
	cache map[string]cachedResolution // appName -> resolved base URL
}

type cachedResolution struct {
	baseURL   string
	expiresAt time.Time
}

// New creates a Client. hostName/ipAddr are self-detected (container
// hostname + its resolved IP on the compose network) since this worker has
// no inbound listener of its own to report a "real" address for - the
// registration exists for dashboard visibility and instance lookup by other
// services, not because anything needs to call INTO this worker.
func New(serverURL, appName string) *Client {
	hostName, ipAddr := detectSelf()
	return &Client{
		serverURL:  strings.TrimRight(serverURL, "/"),
		appName:    strings.ToUpper(appName),
		instanceID: fmt.Sprintf("%s:%s:%d", hostName, strings.ToLower(appName), os.Getpid()),
		hostName:   hostName,
		ipAddr:     ipAddr,
		http:       &http.Client{Timeout: 5 * time.Second},
		cache:      make(map[string]cachedResolution),
	}
}

func detectSelf() (hostName, ipAddr string) {
	hostName, err := os.Hostname()
	if err != nil {
		hostName = "unknown"
	}
	// Docker Compose's embedded DNS resolves a container's own hostname to
	// its address on the compose network - this is the same address other
	// containers would use to reach it, which is what makes it meaningful
	// to publish here even though nothing currently dials in.
	if ips, err := net.LookupIP(hostName); err == nil {
		for _, ip := range ips {
			if v4 := ip.To4(); v4 != nil {
				return hostName, v4.String()
			}
		}
	}
	return hostName, "127.0.0.1"
}

// --------------------------------------------------------------------------
// registration (this worker registering ITSELF)
// --------------------------------------------------------------------------

type registration struct {
	Instance instanceInfo `json:"instance"`
}

type instanceInfo struct {
	InstanceID     string         `json:"instanceId"`
	HostName       string         `json:"hostName"`
	App            string         `json:"app"`
	IPAddr         string         `json:"ipAddr"`
	VipAddress     string         `json:"vipAddress"`
	Status         string         `json:"status"`
	Port           portInfo       `json:"port"`
	DataCenterInfo dataCenterInfo `json:"dataCenterInfo"`
}

type portInfo struct {
	Value   int    `json:"$"`
	Enabled string `json:"@enabled"`
}

type dataCenterInfo struct {
	Class string `json:"@class"`
	Name  string `json:"name"`
}

// Register adds this instance to Eureka's registry as UP. Non-fatal to call
// site on failure (see RunLifecycle) - a worker that can't register still
// judges submissions correctly, it's just invisible on the dashboard.
func (c *Client) Register(ctx context.Context) error {
	body := registration{Instance: instanceInfo{
		InstanceID: c.instanceID,
		HostName:   c.hostName,
		App:        c.appName,
		IPAddr:     c.ipAddr,
		VipAddress: strings.ToLower(c.appName),
		Status:     "UP",
		// This worker has no inbound HTTP listener (see the package doc) -
		// the port is nominal, present only because Eureka's registration
		// schema requires one.
		Port:           portInfo{Value: 0, Enabled: "true"},
		DataCenterInfo: dataCenterInfo{Class: "com.netflix.appinfo.InstanceInfo$DefaultDataCenterInfo", Name: "MyOwn"},
	}}

	return c.post(ctx, fmt.Sprintf("/apps/%s", c.appName), body)
}

// Heartbeat renews this instance's lease. Eureka expires (and stops
// advertising) any instance that misses heartbeats for ~90s.
func (c *Client) Heartbeat(ctx context.Context) error {
	url := fmt.Sprintf("%s/apps/%s/%s", c.serverURL, c.appName, c.instanceID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, url, nil)
	if err != nil {
		return fmt.Errorf("build heartbeat request: %w", err)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("PUT %s: %w", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("eureka returned %d for heartbeat", resp.StatusCode)
	}
	return nil
}

// Deregister removes this instance from Eureka immediately, rather than
// waiting ~90s for its lease to expire on its own - called during graceful
// shutdown so the dashboard reflects reality right away.
func (c *Client) Deregister(ctx context.Context) error {
	url := fmt.Sprintf("%s/apps/%s/%s", c.serverURL, c.appName, c.instanceID)
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, url, nil)
	if err != nil {
		return fmt.Errorf("build deregister request: %w", err)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("DELETE %s: %w", url, err)
	}
	defer resp.Body.Close()
	return nil
}

// RunLifecycle registers this instance and heartbeats it every
// heartbeatInterval until ctx is cancelled. Failures are logged, not fatal -
// discovery is a visibility/convenience feature, not on the critical path
// for judging submissions. Call in a goroutine.
func (c *Client) RunLifecycle(ctx context.Context) {
	if err := c.Register(ctx); err != nil {
		log.Warn().Err(err).Msg("eureka: initial registration failed — will retry on next heartbeat tick")
	} else {
		log.Info().Str("app", c.appName).Str("instance_id", c.instanceID).Msg("eureka: registered")
	}

	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := c.Heartbeat(ctx); err != nil {
				// A missed heartbeat isn't fatal on its own - Eureka tolerates
				// a few before expiring the lease - but re-register in case
				// discovery-service restarted and lost its registry entirely.
				log.Warn().Err(err).Msg("eureka: heartbeat failed — attempting to re-register")
				if err := c.Register(ctx); err != nil {
					log.Warn().Err(err).Msg("eureka: re-registration failed")
				}
			}
		}
	}
}

func (c *Client) post(ctx context.Context, path string, body any) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal registration: %w", err)
	}
	url := c.serverURL + path
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("POST %s: %w", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("eureka returned %d for POST %s", resp.StatusCode, path)
	}
	return nil
}

// --------------------------------------------------------------------------
// discovery (resolving OTHER services' instances)
// --------------------------------------------------------------------------

type applicationResponse struct {
	Application struct {
		Name     string              `json:"name"`
		Instance []discoveryInstance `json:"instance"`
	} `json:"application"`
}

type discoveryInstance struct {
	HostName    string   `json:"hostName"`
	IPAddr      string   `json:"ipAddr"`
	Status      string   `json:"status"`
	Port        portInfo `json:"port"`
	HomePageURL string   `json:"homePageUrl"`
}

// ResolveBaseURL returns a base URL (e.g. "http://problem-service:8082") for
// one UP instance of the given Eureka app name, replacing what used to be a
// fixed, env-configured URL - see clients.ProblemClient/SubmissionClient.
// Cached for resolveCacheTTL to avoid a round trip to Eureka on every single
// outbound call.
func (c *Client) ResolveBaseURL(ctx context.Context, appName string) (string, error) {
	appName = strings.ToUpper(appName)

	c.mu.RLock()
	cached, ok := c.cache[appName]
	c.mu.RUnlock()
	if ok && time.Now().Before(cached.expiresAt) {
		return cached.baseURL, nil
	}

	baseURL, err := c.lookup(ctx, appName)
	if err != nil {
		return "", err
	}

	c.mu.Lock()
	c.cache[appName] = cachedResolution{baseURL: baseURL, expiresAt: time.Now().Add(resolveCacheTTL)}
	c.mu.Unlock()

	return baseURL, nil
}

func (c *Client) lookup(ctx context.Context, appName string) (string, error) {
	url := fmt.Sprintf("%s/apps/%s", c.serverURL, appName)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("GET %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return "", fmt.Errorf("eureka has no registered instances for %s", appName)
	}
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("eureka returned %d for %s: %s", resp.StatusCode, appName, string(body))
	}

	var parsed applicationResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return "", fmt.Errorf("decode eureka response for %s: %w", appName, err)
	}

	for _, inst := range parsed.Application.Instance {
		if inst.Status != "UP" {
			continue
		}
		if inst.HomePageURL != "" {
			return strings.TrimRight(inst.HomePageURL, "/"), nil
		}
		host := inst.IPAddr
		if host == "" {
			host = inst.HostName
		}
		return fmt.Sprintf("http://%s:%d", host, inst.Port.Value), nil
	}

	return "", fmt.Errorf("no UP instances of %s registered in eureka", appName)
}
