package openvscodeproxy

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestStripHostPort(t *testing.T) {
	if got := stripHostPort("ta.example.modal.host:443"); got != "ta.example.modal.host" {
		t.Fatalf("unexpected host: %q", got)
	}
	if got := stripHostPort("ta.example.modal.host"); got != "ta.example.modal.host" {
		t.Fatalf("unexpected host: %q", got)
	}
	if got := stripHostPort("[::1]:443"); got != "::1" {
		t.Fatalf("unexpected host: %q", got)
	}
}

func TestIsSecureRequestModalHostWithPort(t *testing.T) {
	req := httptest.NewRequest("GET", "http://ta-123.w.modal.host:39393/", nil)
	if !isSecureRequest(req) {
		t.Fatalf("expected request to be treated as secure")
	}
}

func TestIsSecureRequestModalHostViaRequestHost(t *testing.T) {
	req := httptest.NewRequest("GET", "http://ta-123.w.modal.host:39393/", nil)
	req.URL.Host = ""
	req.Host = "ta-123.w.modal.host:443"
	if !isSecureRequest(req) {
		t.Fatalf("expected request host to be treated as secure")
	}
}

func TestIsSecureRequestCrossSiteIframe(t *testing.T) {
	req := httptest.NewRequest("GET", "http://127.0.0.1:39393/", nil)
	req.Header.Set("Sec-Fetch-Site", "cross-site")
	req.Header.Set("Sec-Fetch-Dest", "iframe")
	if !isSecureRequest(req) {
		t.Fatalf("expected cross-site iframe request to be treated as secure")
	}
}

func TestRewriteCookieForIframe(t *testing.T) {
	raw := "vscode-tkn=abc; Max-Age=10; SameSite=Lax"
	if got := rewriteOpenVscodeCookieForIframe(raw, false); got != raw {
		t.Fatalf("expected non-secure cookie to remain unchanged: %q", got)
	}

	rewritten := rewriteOpenVscodeCookieForIframe(raw, true)
	if !strings.Contains(rewritten, "SameSite=None") {
		t.Fatalf("expected SameSite=None: %q", rewritten)
	}
	if !strings.Contains(rewritten, "Secure") {
		t.Fatalf("expected Secure: %q", rewritten)
	}
	if !strings.Contains(rewritten, "Partitioned") {
		t.Fatalf("expected Partitioned: %q", rewritten)
	}
}

func TestNormalizeFrameAncestors(t *testing.T) {
	if got := normalizeFrameAncestors(""); got != "" {
		t.Fatalf("expected empty output: %q", got)
	}
	if got := normalizeFrameAncestors("  "); got != "" {
		t.Fatalf("expected empty output: %q", got)
	}
	if got := normalizeFrameAncestors("http://localhost:5174"); got != "http://localhost:5174" {
		t.Fatalf("unexpected output: %q", got)
	}
	if got := normalizeFrameAncestors("http://a, https://b"); got != "http://a https://b" {
		t.Fatalf("unexpected output: %q", got)
	}
}

func TestMergeCspFrameAncestors(t *testing.T) {
	input := "default-src 'self'; frame-ancestors 'self'; object-src 'none'"
	merged := mergeCspFrameAncestors(input, "http://localhost:5174")
	if !strings.Contains(merged, "default-src 'self'") {
		t.Fatalf("expected default-src to remain: %q", merged)
	}
	if !strings.Contains(merged, "object-src 'none'") {
		t.Fatalf("expected object-src to remain: %q", merged)
	}
	if !strings.Contains(merged, "frame-ancestors http://localhost:5174") {
		t.Fatalf("expected updated frame-ancestors: %q", merged)
	}
	if strings.Contains(merged, "frame-ancestors 'self'") {
		t.Fatalf("expected old frame-ancestors to be removed: %q", merged)
	}
}

func TestNormalizeAllowedOriginsIncludesManagerAndDevDefaults(t *testing.T) {
	origins := normalizeAllowedOrigins("http://localhost:8787/app")
	if len(origins) == 0 {
		t.Fatalf("expected non-empty origins list")
	}
	if !isAllowedOrigin(origins, "http://localhost:8787") {
		t.Fatalf("expected manager origin to be allowed: %#v", origins)
	}
	if !isAllowedOrigin(origins, "http://localhost:5174") {
		t.Fatalf("expected localhost dev origin to be allowed: %#v", origins)
	}
}

func TestNormalizeAllowedOriginsRejectsLocalDevForNonLocalManager(t *testing.T) {
	origins := normalizeAllowedOrigins("https://manager.example.com/app")
	if isAllowedOrigin(origins, "http://localhost:5174") {
		t.Fatalf("expected localhost dev origin to be rejected: %#v", origins)
	}
}

func TestIsAllowedOriginRejectsMissingOrUnknown(t *testing.T) {
	origins := normalizeAllowedOrigins("https://allowed.example.com")
	if isAllowedOrigin(origins, "") {
		t.Fatalf("expected empty origin to be rejected")
	}
	if isAllowedOrigin(origins, "https://denied.example.com") {
		t.Fatalf("expected unknown origin to be rejected")
	}
}

func TestIsAllowedOriginDefaultPortMatches(t *testing.T) {
	origins := normalizeAllowedOrigins("https://allowed.example.com")
	if !isAllowedOrigin(origins, "https://allowed.example.com:443") {
		t.Fatalf("expected default :443 to be treated as same origin: %#v", origins)
	}
}

func TestIsAllowedWebSocketOriginAllowsSameOriginProxy(t *testing.T) {
	req := httptest.NewRequest("GET", "http://ta-01.w.modal.host:443/", nil)
	req.Header.Set("Origin", "https://ta-01.w.modal.host")
	if !isAllowedWebSocketOrigin([]string{}, req) {
		t.Fatalf("expected same-origin websocket request to be allowed")
	}
}
