package openvscodeproxy

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
)

type openVSCodeProxyConfig struct {
	ProxyHost          string
	ProxyPort          int
	UpstreamHost       string
	UpstreamPort       int
	FrameAncestors     string
	CORSAllowedOrigins []string
}

func runOpenVSCodeProxy(args []string) error {
	cfg, err := parseOpenVSCodeProxyConfig(args)
	if err != nil {
		return err
	}

	upstreamOrigin := fmt.Sprintf("http://%s:%d", cfg.UpstreamHost, cfg.UpstreamPort)
	upstreamURL, err := url.Parse(upstreamOrigin)
	if err != nil {
		return fmt.Errorf("parse upstream origin: %w", err)
	}

	proxy := newOpenVSCodeReverseProxy(cfg, upstreamURL)
	server := &http.Server{
		Addr:    net.JoinHostPort(cfg.ProxyHost, fmt.Sprintf("%d", cfg.ProxyPort)),
		Handler: proxy,
	}

	go func() {
		stopSignals := make(chan os.Signal, 1)
		signal.Notify(stopSignals, os.Interrupt, syscall.SIGTERM)
		<-stopSignals
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	}()

	fmt.Printf("[openvscode-proxy] listening on http://%s:%d -> %s\n", cfg.ProxyHost, cfg.ProxyPort, upstreamOrigin)
	err = server.ListenAndServe()
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

func Run(args []string) error {
	return runOpenVSCodeProxy(args)
}

func parseOpenVSCodeProxyConfig(args []string) (openVSCodeProxyConfig, error) {
	fs := flag.NewFlagSet("openvscode-proxy", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)

	cfg := openVSCodeProxyConfig{}
	frameAncestorsRaw := strings.TrimSpace(os.Getenv("OPENVSCODE_FRAME_ANCESTORS"))
	managerBaseURL := strings.TrimSpace(os.Getenv("AGENT_MANAGER_BASE_URL"))
	allowedOriginsRaw := strings.TrimSpace(os.Getenv("AGENT_ALLOWED_ORIGINS"))
	cfg.ProxyHost = envString("OPENVSCODE_PROXY_HOST", "0.0.0.0")
	cfg.ProxyPort = envInt("OPENVSCODE_PROXY_PORT", 39393)
	cfg.UpstreamHost = envString("OPENVSCODE_UPSTREAM_HOST", "127.0.0.1")
	cfg.UpstreamPort = envInt("OPENVSCODE_UPSTREAM_PORT", 39395)
	cfg.FrameAncestors = normalizeFrameAncestors(frameAncestorsRaw)
	cfg.CORSAllowedOrigins = normalizeAllowedOrigins(managerBaseURL)

	fs.StringVar(&cfg.ProxyHost, "proxy-host", cfg.ProxyHost, "Proxy listen host")
	fs.IntVar(&cfg.ProxyPort, "proxy-port", cfg.ProxyPort, "Proxy listen port")
	fs.StringVar(&cfg.UpstreamHost, "upstream-host", cfg.UpstreamHost, "OpenVSCode upstream host")
	fs.IntVar(&cfg.UpstreamPort, "upstream-port", cfg.UpstreamPort, "OpenVSCode upstream port")
	fs.StringVar(&cfg.FrameAncestors, "frame-ancestors", cfg.FrameAncestors, "CSP frame-ancestors value")
	fs.StringVar(&allowedOriginsRaw, "allowed-origins", allowedOriginsRaw, "Comma-separated browser origins allowed for websocket checks (overrides AGENT_MANAGER_BASE_URL-derived defaults when set)")

	if err := fs.Parse(args); err != nil {
		return openVSCodeProxyConfig{}, err
	}
	if fs.NArg() != 0 {
		return openVSCodeProxyConfig{}, fmt.Errorf("unexpected args: %v", fs.Args())
	}
	if strings.TrimSpace(cfg.ProxyHost) == "" {
		return openVSCodeProxyConfig{}, errors.New("proxy-host cannot be empty")
	}
	if cfg.ProxyPort <= 0 {
		return openVSCodeProxyConfig{}, errors.New("proxy-port must be a positive number")
	}
	if strings.TrimSpace(cfg.UpstreamHost) == "" {
		return openVSCodeProxyConfig{}, errors.New("upstream-host cannot be empty")
	}
	if cfg.UpstreamPort <= 0 {
		return openVSCodeProxyConfig{}, errors.New("upstream-port must be a positive number")
	}
	origins, err := parseAllowedOrigins(allowedOriginsRaw, managerBaseURL)
	if err != nil {
		return openVSCodeProxyConfig{}, err
	}
	cfg.CORSAllowedOrigins = origins
	return cfg, nil
}

func envInt(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	n, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return n
}

func envString(key string, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func parseAllowedOrigins(raw string, managerBaseURL string) ([]string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return normalizeAllowedOrigins(managerBaseURL), nil
	}

	normalizedSet := make(map[string]struct{})
	parts := strings.FieldsFunc(raw, func(r rune) bool {
		switch r {
		case ',', ' ', '\n', '\r', '\t':
			return true
		default:
			return false
		}
	})
	for _, part := range parts {
		origin := normalizeOrigin(part)
		if origin == "" {
			continue
		}
		normalizedSet[origin] = struct{}{}
	}
	if len(normalizedSet) == 0 {
		return nil, errors.New("AGENT_ALLOWED_ORIGINS must contain at least one valid origin (e.g. https://app.example.com)")
	}

	for origin := range normalizedSet {
		if isLocalhostOrigin(origin) {
			normalizedSet[normalizeOrigin("http://localhost:5173")] = struct{}{}
			normalizedSet[normalizeOrigin("http://localhost:5174")] = struct{}{}
			break
		}
	}

	origins := make([]string, 0, len(normalizedSet))
	for origin := range normalizedSet {
		if strings.TrimSpace(origin) == "" {
			continue
		}
		origins = append(origins, origin)
	}
	sort.Strings(origins)
	return origins, nil
}

func normalizeAllowedOrigins(managerBaseURL string) []string {
	normalizedSet := make(map[string]struct{})
	managerOrigin := normalizeOrigin(managerBaseURL)
	if managerOrigin != "" {
		normalizedSet[managerOrigin] = struct{}{}
	}
	if isLocalhostOrigin(managerOrigin) {
		normalizedSet[normalizeOrigin("http://localhost:5173")] = struct{}{}
		normalizedSet[normalizeOrigin("http://localhost:5174")] = struct{}{}
	}

	origins := make([]string, 0, len(normalizedSet))
	for origin := range normalizedSet {
		if strings.TrimSpace(origin) == "" {
			continue
		}
		origins = append(origins, origin)
	}
	sort.Strings(origins)
	return origins
}

func normalizeOrigin(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed == nil || parsed.Scheme == "" || parsed.Host == "" {
		return ""
	}
	scheme := strings.ToLower(parsed.Scheme)
	host := strings.ToLower(strings.TrimSpace(parsed.Hostname()))
	if host == "" {
		return ""
	}
	port := strings.TrimSpace(parsed.Port())
	switch {
	case port == "":
		// keep empty
	case scheme == "https" && port == "443":
		port = ""
	case scheme == "http" && port == "80":
		port = ""
	}

	hostPort := host
	if port != "" {
		hostPort = net.JoinHostPort(host, port)
	} else if strings.Contains(host, ":") && !strings.HasPrefix(host, "[") {
		hostPort = "[" + host + "]"
	}
	return scheme + "://" + hostPort
}

func isLocalhostOrigin(origin string) bool {
	parsed, err := url.Parse(strings.TrimSpace(origin))
	if err != nil || parsed == nil {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(parsed.Hostname())) {
	case "localhost", "127.0.0.1", "::1":
		return true
	default:
		return false
	}
}

func isAllowedOrigin(allowedOrigins []string, origin string) bool {
	normalized := normalizeOrigin(origin)
	if normalized == "" {
		return false
	}
	for _, candidate := range allowedOrigins {
		if normalized == candidate {
			return true
		}
	}
	return false
}

func isAllowedWebSocketOrigin(allowedOrigins []string, r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if isAllowedOrigin(allowedOrigins, origin) {
		return true
	}
	proxyOrigin := buildProxyOrigin(r)
	if proxyOrigin == "" {
		return false
	}
	normalizedOrigin := normalizeOrigin(origin)
	if normalizedOrigin == "" {
		return false
	}
	return normalizedOrigin == normalizeOrigin(proxyOrigin)
}

func newOpenVSCodeReverseProxy(cfg openVSCodeProxyConfig, upstreamURL *url.URL) http.Handler {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	rp := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(upstreamURL)
			pr.Out.URL.Path, pr.Out.URL.RawPath = joinURLPath(upstreamURL, pr.In.URL)
			pr.Out.URL.RawQuery = pr.In.URL.RawQuery
			pr.Out.Host = upstreamURL.Host
			pr.Out.Header.Del("Content-Length")
			pr.Out = pr.Out.WithContext(context.WithValue(pr.Out.Context(), proxyRequestMetaKey{}, proxyRequestMeta{
				IsSecure:    isSecureRequest(pr.In),
				ProxyOrigin: buildProxyOrigin(pr.In),
			}))
		},
		ModifyResponse: func(res *http.Response) error {
			meta, _ := res.Request.Context().Value(proxyRequestMetaKey{}).(proxyRequestMeta)
			if cfg.FrameAncestors != "" {
				existing := res.Header.Get("Content-Security-Policy")
				res.Header.Set("Content-Security-Policy", mergeCspFrameAncestors(existing, cfg.FrameAncestors))
			}
			if location := strings.TrimSpace(res.Header.Get("Location")); location != "" && meta.ProxyOrigin != "" {
				res.Header.Set("Location", rewriteLocationToProxy(location, meta.ProxyOrigin))
			}
			if setCookies := res.Header.Values("Set-Cookie"); len(setCookies) > 0 {
				res.Header.Del("Set-Cookie")
				for _, cookie := range setCookies {
					res.Header.Add("Set-Cookie", rewriteOpenVscodeCookieForIframe(cookie, meta.IsSecure))
				}
			}
			return nil
		},
		Transport: transport,
		ErrorHandler: func(w http.ResponseWriter, _ *http.Request, err error) {
			http.Error(w, fmt.Sprintf("Upstream fetch failed: %v", err), http.StatusBadGateway)
		},
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if websocket.IsWebSocketUpgrade(r) {
			proxyWebSocket(w, r, cfg)
			return
		}
		rp.ServeHTTP(w, r)
	})
}

type proxyRequestMetaKey struct{}

type proxyRequestMeta struct {
	IsSecure    bool
	ProxyOrigin string
}

func proxyWebSocket(w http.ResponseWriter, r *http.Request, cfg openVSCodeProxyConfig) {
	if !isAllowedWebSocketOrigin(cfg.CORSAllowedOrigins, r) {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	upgrader := websocket.Upgrader{
		CheckOrigin: func(req *http.Request) bool {
			return isAllowedWebSocketOrigin(cfg.CORSAllowedOrigins, req)
		},
		Subprotocols: parseWebSocketProtocols(
			r.Header.Get("Sec-WebSocket-Protocol"),
		),
	}
	clientConn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer clientConn.Close()

	upstreamURL := &url.URL{
		Scheme:   "ws",
		Host:     net.JoinHostPort(cfg.UpstreamHost, fmt.Sprintf("%d", cfg.UpstreamPort)),
		Path:     r.URL.Path,
		RawQuery: r.URL.RawQuery,
	}
	dialer := websocket.Dialer{
		Proxy:            http.ProxyFromEnvironment,
		Subprotocols:     parseWebSocketProtocols(r.Header.Get("Sec-WebSocket-Protocol")),
		HandshakeTimeout: 30 * time.Second,
	}
	headers := http.Header{}
	if cookie := strings.TrimSpace(r.Header.Get("Cookie")); cookie != "" {
		headers.Set("Cookie", cookie)
	}

	upstreamConn, _, err := dialer.DialContext(r.Context(), upstreamURL.String(), headers)
	if err != nil {
		_ = clientConn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseInternalServerErr, "Upstream error"), time.Now().Add(2*time.Second))
		return
	}
	defer upstreamConn.Close()

	errCh := make(chan error, 2)
	go pumpWebSocket(clientConn, upstreamConn, errCh)
	go pumpWebSocket(upstreamConn, clientConn, errCh)
	<-errCh
}

func pumpWebSocket(src, dst *websocket.Conn, errCh chan<- error) {
	for {
		messageType, payload, err := src.ReadMessage()
		if err != nil {
			errCh <- err
			return
		}
		if err := dst.WriteMessage(messageType, payload); err != nil {
			errCh <- err
			return
		}
	}
}

func parseWebSocketProtocols(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

func normalizeFrameAncestors(raw string) string {
	tokens := []string{}
	for _, piece := range strings.Split(raw, ",") {
		trimmed := strings.TrimSpace(piece)
		if trimmed != "" {
			tokens = append(tokens, trimmed)
		}
	}
	return strings.Join(tokens, " ")
}

func mergeCspFrameAncestors(input, frameAncestors string) string {
	directive := fmt.Sprintf("frame-ancestors %s", frameAncestors)
	if strings.TrimSpace(input) == "" {
		return directive
	}
	parts := []string{}
	for _, piece := range strings.Split(input, ";") {
		piece = strings.TrimSpace(piece)
		if piece == "" {
			continue
		}
		if strings.HasPrefix(strings.ToLower(piece), "frame-ancestors ") {
			continue
		}
		parts = append(parts, piece)
	}
	parts = append(parts, directive)
	return strings.Join(parts, "; ")
}

func parseForwardedProto(headers http.Header) string {
	direct := strings.TrimSpace(headers.Get("X-Forwarded-Proto"))
	if direct != "" {
		return strings.TrimSpace(strings.Split(direct, ",")[0])
	}
	forwarded := strings.TrimSpace(headers.Get("Forwarded"))
	if forwarded == "" {
		return ""
	}
	first := strings.TrimSpace(strings.Split(forwarded, ",")[0])
	re := regexp.MustCompile(`(?:^|;)\s*proto=([^;]+)`)
	match := re.FindStringSubmatch(strings.ToLower(first))
	if len(match) < 2 {
		return ""
	}
	return strings.Trim(strings.TrimSpace(match[1]), `"`)
}

func stripHostPort(input string) string {
	value := strings.TrimSpace(input)
	if value == "" {
		return ""
	}
	if strings.HasPrefix(value, "[") {
		if close := strings.Index(value, "]"); close > 1 {
			return value[1:close]
		}
		return value
	}
	if strings.Count(value, ":") == 1 {
		host, _, err := net.SplitHostPort(value)
		if err == nil {
			return host
		}
		if idx := strings.LastIndex(value, ":"); idx > 0 {
			return value[:idx]
		}
	}
	return value
}

func isCrossSiteIframeRequest(headers http.Header) bool {
	site := strings.ToLower(strings.TrimSpace(headers.Get("Sec-Fetch-Site")))
	if site != "cross-site" {
		return false
	}
	dest := strings.ToLower(strings.TrimSpace(headers.Get("Sec-Fetch-Dest")))
	return dest == "" || dest == "iframe"
}

func hasModalSuffix(host string) bool {
	return strings.HasSuffix(host, ".modal.host") ||
		strings.HasSuffix(host, ".modal.run") ||
		strings.HasSuffix(host, ".modal.com")
}

func isSecureRequest(r *http.Request) bool {
	headers := r.Header
	if forwardedProto := parseForwardedProto(headers); forwardedProto != "" {
		return strings.EqualFold(forwardedProto, "https")
	}
	if strings.EqualFold(strings.TrimSpace(headers.Get("X-Forwarded-SSL")), "on") {
		return true
	}
	if strings.EqualFold(strings.TrimSpace(headers.Get("X-Forwarded-Secure")), "true") {
		return true
	}
	if isCrossSiteIframeRequest(headers) {
		return true
	}

	if r.URL != nil {
		if strings.EqualFold(r.URL.Scheme, "https") {
			return true
		}
		if hasModalSuffix(stripHostPort(r.URL.Host)) {
			return true
		}
	}

	// net/http exposes the Host header via r.Host (it is not guaranteed to be present in r.Header).
	host := stripHostPort(strings.TrimSpace(r.Host))
	if host == "" {
		host = stripHostPort(headers.Get("Host"))
	}
	forwardedHost := stripHostPort(headers.Get("X-Forwarded-Host"))
	return hasModalSuffix(host) || hasModalSuffix(forwardedHost)
}

func hasCookieAttr(cookie, attr string) bool {
	pattern := fmt.Sprintf(`(?:^|;)\s*%s(?:\s*=|\s*;|\s*$)`, regexp.QuoteMeta(attr))
	return regexp.MustCompile(`(?i)` + pattern).MatchString(cookie)
}

func rewriteOpenVscodeCookieForIframe(cookie string, isSecure bool) string {
	if !isSecure {
		return cookie
	}
	next := regexp.MustCompile(`(?i);\s*samesite\s*=\s*lax\b`).ReplaceAllString(cookie, "; SameSite=None")
	next = regexp.MustCompile(`(?i);\s*samesite\s*=\s*strict\b`).ReplaceAllString(next, "; SameSite=None")
	if !regexp.MustCompile(`(?i);\s*samesite\s*=\s*none\b`).MatchString(next) {
		next += "; SameSite=None"
	}
	if !hasCookieAttr(next, "Secure") {
		next += "; Secure"
	}
	if !hasCookieAttr(next, "Partitioned") {
		next += "; Partitioned"
	}
	return next
}

func rewriteLocationToProxy(location, proxyOrigin string) string {
	parsed, err := url.Parse(location)
	if err != nil || !parsed.IsAbs() {
		return location
	}
	base, err := url.Parse(proxyOrigin)
	if err != nil {
		return location
	}
	base.Path = parsed.Path
	base.RawQuery = parsed.RawQuery
	base.Fragment = parsed.Fragment
	return base.String()
}

func buildProxyOrigin(r *http.Request) string {
	host := strings.TrimSpace(r.Header.Get("X-Forwarded-Host"))
	if host == "" {
		host = strings.TrimSpace(r.Host)
	}
	if host == "" && r.URL != nil {
		host = strings.TrimSpace(r.URL.Host)
	}
	if host == "" {
		return ""
	}
	scheme := "http"
	if r.TLS != nil || isSecureRequest(r) {
		scheme = "https"
	}
	return fmt.Sprintf("%s://%s", scheme, host)
}

func joinURLPath(base *url.URL, reqURL *url.URL) (path string, rawPath string) {
	if reqURL == nil {
		return base.Path, base.RawPath
	}
	targetPath := reqURL.EscapedPath()
	if targetPath == "" {
		targetPath = "/"
	}
	basePath := strings.TrimSuffix(base.EscapedPath(), "/")
	if basePath == "" {
		return targetPath, reqURL.RawPath
	}
	return basePath + targetPath, ""
}

func copyResponse(w http.ResponseWriter, res *http.Response) error {
	for key, values := range res.Header {
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}
	w.WriteHeader(res.StatusCode)
	_, err := io.Copy(w, res.Body)
	return err
}
