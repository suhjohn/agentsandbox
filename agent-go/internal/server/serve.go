package server

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"

	openapipkg "agent-go/internal/openapi"
	sessionstate "agent-go/internal/session"
	workspacepkg "agent-go/internal/workspace"
)

var (
	sessionIDRegex = regexp.MustCompile(`^[0-9a-fA-F]{32}$`)
	runIDRegex     = regexp.MustCompile(`^[0-9a-fA-F]{32}$`)
)

const (
	defaultPort           = 3131
	defaultDatabasePath   = "./agent.db"
	defaultCodexModel     = "gpt-5.2"
	maxJSONBodyBytes      = 20 * 1024 * 1024
	sseKeepaliveMS        = 5 * time.Second
	sseKeepalivePadding   = "................"
	workspacePingPadding  = "................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................"
	maxWorkspacePatchChar = 2_000_000
	defaultReadTimeout    = 30 * time.Second
	defaultWriteTimeout   = 120 * time.Second
	defaultIdleTimeout    = 120 * time.Second
)

type serveConfig struct {
	Port                  int
	AgentID               string
	DatabasePath          string
	SecretSeed            string
	AgentInternalAuthSecret string
	DefaultCodexModel     string
	OpenAIAPIKey          string
	PIDir                 string
	WorkspacesDir         string
	RuntimeDir            string
	DefaultWorkingDir     string
	CORSAllowedOrigins    []string
	AgentManagerBaseURL   string
	AgentManagerAPIKey    string
	AgentManagerAuthToken string
}

type apiError struct {
	Status  int
	Message string
}

func (e *apiError) Error() string { return e.Message }

func fail(status int, message string) error {
	return &apiError{Status: status, Message: message}
}

func runServe(args []string) error {
	cfg, err := parseServeConfig(args)
	if err != nil {
		return err
	}

	store, err := newStore(cfg.DatabasePath, cfg.AgentID)
	if err != nil {
		return err
	}
	defer store.Close()

	httpClient := &http.Client{Timeout: 90 * time.Second}
	app := &server{
		cfg:    cfg,
		store:  store,
		state:  sessionstate.New(),
		http:   httpClient,
		codex:  NewCodexCLI(),
		pi:     NewPiCLI(),
		runCtx: context.Background(),
	}
	runCtx, runCancel := context.WithCancel(context.Background())
	app.runCtx = runCtx
	app.codex.Dir = cfg.DefaultWorkingDir
	app.pi.Dir = cfg.DefaultWorkingDir
	if strings.TrimSpace(cfg.OpenAIAPIKey) != "" {
		app.codex.Env = append(app.codex.Env, "OPENAI_API_KEY="+strings.TrimSpace(cfg.OpenAIAPIKey))
	}
	if strings.TrimSpace(cfg.PIDir) != "" {
		app.pi.Env = append(app.pi.Env, "PI_DIR="+strings.TrimSpace(cfg.PIDir))
	}
	app.outbox = newEventOutbox(store, httpClient, cfg)
	app.outbox.start()
	defer app.outbox.stop()

	router := newServerRouter(app)

	httpServer := &http.Server{
		Addr:              fmt.Sprintf("0.0.0.0:%d", cfg.Port),
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       defaultReadTimeout,
		WriteTimeout:      defaultWriteTimeout,
		IdleTimeout:       defaultIdleTimeout,
		MaxHeaderBytes:    1 << 20,
	}

	go func() {
		stopSignals := make(chan os.Signal, 1)
		signal.Notify(stopSignals, os.Interrupt, syscall.SIGTERM)
		<-stopSignals
		runCancel()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(ctx)
		app.outbox.stop()
		_ = store.Close()
	}()
	defer runCancel()
	fmt.Printf("agent-go: listening on http://%s\n", httpServer.Addr)
	err = httpServer.ListenAndServe()
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

func newServerRouter(app *server) http.Handler {
	router := chi.NewRouter()
	router.Use(app.cors)
	router.Use(app.recoverer)

	router.Get("/health", app.wrap(app.handleHealth))
	router.Get("/openapi.json", app.wrap(app.handleOpenAPI))

	router.Post("/session", app.wrap(app.handleCreateSession))
	router.Get("/session", app.wrap(app.handleListSessions))
	router.Get("/session/{id}", app.wrap(app.handleGetSession))
	router.Post("/session/{id}/message", app.wrap(app.handleStartRun))
	router.Get("/session/{id}/stream", app.wrap(app.handleSessionStream))
	router.Get("/session/{id}/message/{runId}/stream", app.wrap(app.handleRunStream))
	router.Post("/session/{id}/stop", app.wrap(app.handleStopRun))
	router.Delete("/session/{id}", app.wrap(app.handleDeleteSession))

	router.Get("/workspaces", app.wrap(app.handleListWorkspaces))
	router.Get("/workspaces/{name}/diff", app.wrap(app.handleWorkspaceDiff))
	router.Get("/workspaces/{name}/diff/stream", app.wrap(app.handleWorkspaceDiffStream))
	router.Get("/workspaces/{name}/diff/file-contents", app.wrap(app.handleWorkspaceDiffFileContents))
	router.Get("/terminal", app.wrap(app.handleTerminalWS))
	return router
}

func parseServeConfig(args []string) (serveConfig, error) {
	fs := flag.NewFlagSet("serve", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)

	portDefault := envInt("PORT", defaultPort)
	dbPathDefault := envString("DATABASE_PATH", defaultDatabasePath)
	secretDefault := strings.TrimSpace(os.Getenv("SECRET_SEED"))
	modelDefault := envString("DEFAULT_CODEX_MODEL", defaultCodexModel)
	agentID := strings.TrimSpace(os.Getenv("AGENT_ID"))
	openaiKey := strings.TrimSpace(os.Getenv("OPENAI_API_KEY"))
	if openaiKey == "" {
		openaiKey = strings.TrimSpace(os.Getenv("CODEX_API_KEY"))
	}
	home := strings.TrimSpace(os.Getenv("AGENT_HOME"))
	if home == "" {
		home = "/home/agent"
	}
	workspacesDefault := strings.TrimSpace(os.Getenv("WORKSPACES_DIR"))
	if workspacesDefault == "" {
		workspacesDefault = filepath.Join(home, "workspaces")
	}
	runtimeDefault := strings.TrimSpace(os.Getenv("ROOT_DIR"))
	if runtimeDefault == "" {
		runtimeDefault = filepath.Join(home, ".agent", "runtime")
	}
	workingDirDefault := strings.TrimSpace(os.Getenv("DEFAULT_WORKING_DIR"))
	if workingDirDefault == "" {
		workingDirDefault = workspacesDefault
	}
	managerBaseURL := strings.TrimSpace(os.Getenv("AGENT_MANAGER_BASE_URL"))
	managerAPIKey := strings.TrimSpace(os.Getenv("AGENT_MANAGER_API_KEY"))
	managerAuthToken := strings.TrimSpace(os.Getenv("AGENT_MANAGER_AUTH_TOKEN"))
	internalAuthSecret := strings.TrimSpace(os.Getenv("AGENT_INTERNAL_AUTH_SECRET"))
	allowedOriginsRaw := strings.TrimSpace(os.Getenv("AGENT_ALLOWED_ORIGINS"))
	piDir := strings.TrimSpace(os.Getenv("PI_DIR"))

	cfg := serveConfig{}
	fs.IntVar(&cfg.Port, "port", portDefault, "Server port")
	fs.StringVar(&cfg.AgentID, "agent-id", agentID, "Agent ID expected in sandbox auth token claims")
	fs.StringVar(&cfg.DatabasePath, "db-path", dbPathDefault, "SQLite DB path")
	fs.StringVar(&cfg.SecretSeed, "secret-seed", secretDefault, "SECRET_SEED used for X-Agent-Auth verification")
	fs.StringVar(&cfg.DefaultCodexModel, "default-model", modelDefault, "Default model for /session/:id/message")
	fs.StringVar(&cfg.WorkspacesDir, "workspaces-dir", workspacesDefault, "Workspaces directory")
	fs.StringVar(&cfg.RuntimeDir, "runtime-dir", runtimeDefault, "Runtime directory (used for image normalization)")
	fs.StringVar(&cfg.DefaultWorkingDir, "working-dir", workingDirDefault, "Default working directory for agent and terminal")
	fs.StringVar(&cfg.PIDir, "pi-dir", piDir, "PI runtime/config directory")
	fs.StringVar(&cfg.AgentManagerBaseURL, "agent-manager-base-url", managerBaseURL, "Manager base URL for session sync")
	fs.StringVar(&cfg.AgentManagerAPIKey, "agent-manager-api-key", managerAPIKey, "Manager API key")
	fs.StringVar(&cfg.AgentManagerAuthToken, "agent-manager-auth-token", managerAuthToken, "Manager bearer auth token")
	fs.StringVar(&cfg.AgentInternalAuthSecret, "agent-internal-auth-secret", internalAuthSecret, "Shared manager/runtime secret for internal auth")
	fs.StringVar(&allowedOriginsRaw, "allowed-origins", allowedOriginsRaw, "Comma-separated browser origins allowed for CORS and /terminal (overrides AGENT_MANAGER_BASE_URL-derived defaults when set)")

	if err := fs.Parse(args); err != nil {
		return serveConfig{}, err
	}
	if fs.NArg() != 0 {
		return serveConfig{}, fmt.Errorf("unexpected args: %v", fs.Args())
	}
	cfg.SecretSeed = strings.TrimSpace(cfg.SecretSeed)
	if len(cfg.SecretSeed) < 32 {
		return serveConfig{}, errors.New("SECRET_SEED must be at least 32 chars")
	}
	cfg.AgentID = strings.TrimSpace(cfg.AgentID)
	if cfg.AgentID == "" {
		return serveConfig{}, errors.New("AGENT_ID must be set")
	}
	cfg.AgentInternalAuthSecret = strings.TrimSpace(cfg.AgentInternalAuthSecret)
	if cfg.AgentInternalAuthSecret != "" && len(cfg.AgentInternalAuthSecret) < 32 {
		return serveConfig{}, errors.New("AGENT_INTERNAL_AUTH_SECRET must be at least 32 chars when set")
	}
	if cfg.Port <= 0 {
		return serveConfig{}, errors.New("port must be positive")
	}
	origins, err := parseAllowedOrigins(allowedOriginsRaw, cfg.AgentManagerBaseURL)
	if err != nil {
		return serveConfig{}, err
	}
	cfg.CORSAllowedOrigins = origins
	cfg.OpenAIAPIKey = openaiKey
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
	return strings.ToLower(parsed.Scheme + "://" + parsed.Host)
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

type server struct {
	cfg    serveConfig
	store  *store
	state  *sessionstate.State
	http   *http.Client
	codex  *CodexCLI
	pi     *PiCLI
	outbox *eventOutbox
	runCtx context.Context
}

type appHandler func(http.ResponseWriter, *http.Request) error

func (s *server) wrap(fn appHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := fn(w, r); err != nil {
			s.writeError(w, err)
		}
	}
}

func (s *server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := normalizeOrigin(r.Header.Get("Origin"))
		allowedOrigin := origin != "" && s.isAllowedOrigin(origin)
		if origin != "" && !allowedOrigin {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		if origin != "" && allowedOrigin {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Agent-Auth, X-Agent-Internal-Auth, X-Actor-User-Id")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *server) isAllowedOrigin(origin string) bool {
	normalized := normalizeOrigin(origin)
	if normalized == "" {
		return false
	}
	for _, candidate := range s.cfg.CORSAllowedOrigins {
		if normalized == candidate {
			return true
		}
	}
	return false
}

func (s *server) recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				s.writeError(w, fail(http.StatusInternalServerError, "Internal Server Error"))
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func (s *server) writeError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	message := "Internal Server Error"
	var appErr *apiError
	if errors.As(err, &appErr) {
		status = appErr.Status
		message = appErr.Message
	} else if err != nil {
		message = err.Error()
	}
	writeJSON(w, status, map[string]any{
		"error":  message,
		"status": status,
	})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func (s *server) handleHealth(w http.ResponseWriter, _ *http.Request) error {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":    "ok",
		"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
	})
	return nil
}

func (s *server) handleOpenAPI(w http.ResponseWriter, _ *http.Request) error {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(openapipkg.Spec)
	return nil
}

func (s *server) handleCreateSession(w http.ResponseWriter, r *http.Request) error {
	auth, err := s.requireAuth(r)
	if err != nil {
		return err
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBodyBytes)
	var input createSessionInput
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&input); err != nil {
		return fail(http.StatusBadRequest, "Invalid JSON body")
	}
	if input.ID != "" && !sessionIDRegex.MatchString(input.ID) {
		return fail(http.StatusBadRequest, "Invalid session ID format")
	}
	if input.Harness == "" {
		input.Harness = "codex"
	}
	if input.Harness != "codex" && input.Harness != "pi" {
		return fail(http.StatusBadRequest, "Invalid harness")
	}

	var rawEffort *string
	if strings.TrimSpace(input.ModelReasoningEffort) != "" {
		rawEffort = &input.ModelReasoningEffort
	}
	selection, err := normalizeSessionModelSelection(input.Harness, input.Model, rawEffort)
	if err != nil {
		return err
	}
	input.Model = selection.Model
	input.ModelReasoningEffort = ""
	if selection.Effort != nil {
		input.ModelReasoningEffort = *selection.Effort
	}

	if input.ID != "" {
		existing, err := s.store.getSessionByID(strings.ToLower(input.ID))
		if err != nil {
			return err
		}
		if existing != nil && existing.Harness != input.Harness {
			return fail(http.StatusConflict, "harness cannot be modified for an existing session")
		}
	}

	session, err := s.store.createSession(input, auth.UserID)
	if err != nil {
		return err
	}
	s.queueManagerSessionSync(session.ID)
	writeJSON(w, http.StatusCreated, session)
	return nil
}

func (s *server) handleListSessions(w http.ResponseWriter, r *http.Request) error {
	if _, err := s.requireAuth(r); err != nil {
		return err
	}
	q := r.URL.Query()
	limit := 20
	if raw := strings.TrimSpace(q.Get("limit")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 50 {
			return fail(http.StatusBadRequest, "Invalid limit")
		}
		limit = n
	}

	var cursor *sessionCursor
	if raw := strings.TrimSpace(q.Get("cursor")); raw != "" {
		parsed, err := decodeCursor(raw)
		if err != nil {
			return fail(http.StatusBadRequest, "Invalid cursor")
		}
		cursor = &parsed
	}

	search := strings.TrimSpace(q.Get("q"))

	sessions, err := s.store.listSessionsPage(limit, cursor, search)
	if err != nil {
		return err
	}

	var nextCursor *string
	if len(sessions) == limit {
		last := sessions[len(sessions)-1]
		encoded := encodeCursor(sessionCursor{UpdatedAt: last.UpdatedAt, ID: last.ID})
		nextCursor = &encoded
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"sessions":   sessions,
		"nextCursor": nextCursor,
	})
	return nil
}

func (s *server) handleGetSession(w http.ResponseWriter, r *http.Request) error {
	sessionID, err := requireSessionID(chi.URLParam(r, "id"))
	if err != nil {
		return err
	}
	if _, err := s.requireAuth(r); err != nil {
		return err
	}

	session, err := s.store.getSessionByID(sessionID)
	if err != nil {
		return err
	}
	if session == nil {
		return fail(http.StatusNotFound, "Session not found")
	}
	messages, err := s.store.getMessagesBySessionID(sessionID)
	if err != nil {
		return err
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"id":                   session.ID,
		"agentId":              session.AgentID,
		"createdBy":            session.CreatedBy,
		"status":               session.Status,
		"harness":              session.Harness,
		"externalSessionId":    session.ExternalSessionID,
		"title":                session.Title,
		"firstUserMessageBody": session.FirstUserMessageBody,
		"lastMessageBody":      session.LastMessageBody,
		"model":                session.Model,
		"modelReasoningEffort": session.ModelReasoningEffort,
		"createdAt":            session.CreatedAt,
		"updatedAt":            session.UpdatedAt,
		"messages":             messages,
		"isRunning":            s.state.IsSessionRunning(sessionID),
	})
	return nil
}

func (s *server) handleStartRun(w http.ResponseWriter, r *http.Request) error {
	sessionID, err := requireSessionID(chi.URLParam(r, "id"))
	if err != nil {
		return err
	}
	auth, err := s.requireAuth(r)
	if err != nil {
		return err
	}

	session, err := s.store.getSessionByID(sessionID)
	if err != nil {
		return err
	}
	if session == nil {
		return fail(http.StatusNotFound, "Session not found")
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBodyBytes)
	var req runRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return fail(http.StatusBadRequest, "Invalid JSON body")
	}
	if len(req.Input) == 0 {
		return fail(http.StatusBadRequest, "input is required")
	}

	normalized, err := s.normalizeInputs(sessionID, req.Input)
	if err != nil {
		return fail(http.StatusBadRequest, err.Error())
	}

	selection, err := normalizeSessionModelSelection(session.Harness, req.Model, req.ModelReasoningEffort)
	if err != nil {
		return err
	}

	if selection.HasModel || selection.HasEffort {
		nextModel := session.Model
		if selection.HasModel {
			nextModel = selection.Model
		}
		nextEffort := session.ModelReasoningEffort
		if selection.HasEffort {
			nextEffort = selection.Effort
		}
		if err := s.store.updateSessionDefaults(sessionID, nextModel, nextEffort); err != nil {
			return err
		}
		s.queueManagerSessionSync(sessionID)
		session, err = s.store.getSessionByID(sessionID)
		if err != nil {
			return err
		}
	}

	runID := randomHex(16)
	if !s.state.StartRun(sessionID, runID) {
		return fail(http.StatusConflict, "A run is already in progress for this session")
	}
	s.state.CreateRunStream(runID, sessionID)

	userBody := map[string]any{
		"type":  "user_input",
		"input": normalized,
	}
	userMsg, err := s.store.createMessage(sessionID, createMessageInput{
		CreatedBy: &auth.UserID,
		Body:      userBody,
	})
	if err != nil {
		s.state.FinishRun(sessionID)
		s.state.EndRunStream(runID)
		return err
	}

	s.maybeGenerateSessionTitleAsync(sessionID, normalized)

	_ = s.store.setSessionStatus(sessionID, "processing")
	s.queueManagerSessionSync(sessionID)
	s.state.PushSessionEvent(sessionID, eventNameForMessage(userMsg), userMsg)
	s.state.PushSessionEvent(sessionID, "status", map[string]any{"isRunning": true})
	s.state.PushRunEvent(runID, eventNameForMessage(userMsg), userMsg)
	s.state.PushRunEvent(runID, "status", map[string]any{"isRunning": true})

	runContext := s.runCtx
	if runContext == nil {
		runContext = context.Background()
	}
	go s.executeRunAsync(runContext, sessionID, runID, session, normalized)

	resp := map[string]any{
		"success":   true,
		"sessionId": sessionID,
		"runId":     runID,
	}
	if session.Harness == "pi" {
		sessionFile := ""
		if session.ExternalSessionID != nil && strings.TrimSpace(*session.ExternalSessionID) != "" {
			sessionFile = strings.TrimSpace(*session.ExternalSessionID)
		} else {
			sessionFile = s.defaultPISessionFile(sessionID)
			_ = s.store.updateSessionExternalID(sessionID, sessionFile)
			s.queueManagerSessionSync(sessionID)
		}
		if sessionFile != "" {
			resp["sessionFile"] = sessionFile
		}
	} else {
		if session.ExternalSessionID != nil {
			resp["threadId"] = *session.ExternalSessionID
		}
	}
	writeJSON(w, http.StatusOK, resp)
	return nil
}

func (s *server) executeRunAsync(parent context.Context, sessionID, runID string, session *sessionRecord, input []normalizedInput) {
	ctx, cancel := context.WithCancel(parent)
	s.state.BindRunCancel(sessionID, cancel)
	defer cancel()
	defer s.state.FinishRun(sessionID)
	streamedEventCount := 0

	pushError := func(message string) {
		errMsg := strings.TrimSpace(message)
		if errMsg == "" {
			errMsg = "Unknown error"
		}
		msg, err := s.store.createMessage(sessionID, createMessageInput{
			Body: map[string]any{
				"type":    "error",
				"message": errMsg,
			},
		})
		if err == nil {
			s.state.PushSessionEvent(sessionID, eventNameForMessage(msg), msg)
			s.state.PushRunEvent(runID, eventNameForMessage(msg), msg)
		}
	}

	pushProviderEvent := func(body map[string]any) {
		if len(body) == 0 {
			return
		}
		streamedEventCount++
		msg, err := s.store.createMessage(sessionID, createMessageInput{
			Body: body,
		})
		if err != nil {
			return
		}
		s.state.PushSessionEvent(sessionID, eventNameForMessage(msg), msg)
		s.state.PushRunEvent(runID, eventNameForMessage(msg), msg)
	}

	result, err := s.executeModelRun(ctx, session, input, pushProviderEvent)
	if err != nil {
		pushError(err.Error())
	} else {
		if result.ExternalSessionID != "" {
			_ = s.store.updateSessionExternalID(sessionID, result.ExternalSessionID)
			s.queueManagerSessionSync(sessionID)
		}
		// Fallback: if a provider run produced text but no structured events,
		// emit one synthetic assistant message so callers still receive output.
		if streamedEventCount == 0 && strings.TrimSpace(result.Text) != "" {
			body := map[string]any{
				"type": "item.completed",
				"item": map[string]any{
					"type": "agent_message",
					"text": strings.TrimSpace(result.Text),
				},
			}
			msg, mErr := s.store.createMessage(sessionID, createMessageInput{
				Body: body,
			})
			if mErr == nil {
				s.state.PushSessionEvent(sessionID, eventNameForMessage(msg), msg)
				s.state.PushRunEvent(runID, eventNameForMessage(msg), msg)
			}
		}
	}

	_ = s.store.setSessionStatus(sessionID, "initial")
	s.queueManagerSessionSync(sessionID)
	s.queueManagerSnapshot(sessionID)
	s.state.PushSessionEvent(sessionID, "status", map[string]any{"isRunning": false})
	s.state.PushRunEvent(runID, "status", map[string]any{"isRunning": false})
	s.state.EndRunStream(runID)
}

type modelRunResult struct {
	ExternalSessionID string
	Text              string
}

func (s *server) executeModelRun(ctx context.Context, session *sessionRecord, input []normalizedInput, onEvent func(map[string]any)) (modelRunResult, error) {
	if strings.EqualFold(strings.TrimSpace(session.Harness), "pi") {
		return s.executePiCLIRun(ctx, session, input, onEvent)
	}
	return s.executeCodexCLIRun(ctx, session, input, onEvent)
}

func (s *server) executeCodexCLIRun(ctx context.Context, session *sessionRecord, input []normalizedInput, onEvent func(map[string]any)) (modelRunResult, error) {
	prompt := promptFromInputs(input)
	resolvedModel, resolvedEffort, err := resolveSessionDefaultsForExecution("codex", session.Model, session.ModelReasoningEffort)
	if err != nil {
		return modelRunResult{}, err
	}
	model := strings.TrimSpace(s.cfg.DefaultCodexModel)
	if resolvedModel != nil && strings.TrimSpace(*resolvedModel) != "" {
		model = strings.TrimSpace(*resolvedModel)
	}

	config := []string{}
	if resolvedEffort != nil && strings.TrimSpace(*resolvedEffort) != "" {
		config = append(config, fmt.Sprintf("model_reasoning_effort=%q", strings.TrimSpace(*resolvedEffort)))
	}

	resumeSessionID := ""
	if session.ExternalSessionID != nil {
		resumeSessionID = strings.TrimSpace(*session.ExternalSessionID)
	}
	seenExternalSessionID := ""
	persistedExternalSessionID := resumeSessionID
	persistExternalSessionID := func(value string) {
		next := strings.TrimSpace(value)
		if next == "" {
			return
		}
		seenExternalSessionID = next
		if next == persistedExternalSessionID {
			return
		}
		if err := s.store.updateSessionExternalID(session.ID, next); err != nil {
			return
		}
		persistedExternalSessionID = next
		s.queueManagerSessionSync(session.ID)
	}

	resultText := strings.Builder{}
	args := s.codex.ExecArgs(CodexExecOptions{
		CodexRootOptions: CodexRootOptions{
			CodexGlobalOptions: CodexGlobalOptions{Config: config},
			Prompt:             prompt,
			Model:              model,
			Sandbox:            "danger-full-access",
			DangerouslyBypass:  true,
			CD:                 s.cfg.DefaultWorkingDir,
		},
		SkipGitRepoCheck: true,
		JSON:             true,
	})
	if resumeSessionID != "" {
		args = s.codex.ExecResumeArgs(CodexResumeOptions{
			CodexGlobalOptions: CodexGlobalOptions{Config: config},
		})
		if model != "" {
			args = append(args, "--model", model)
		}
		args = append(
			args,
			"--dangerously-bypass-approvals-and-sandbox",
			"--skip-git-repo-check",
			"--json",
			resumeSessionID,
		)
		if promptText := strings.TrimSpace(prompt); promptText != "" {
			args = append(args, promptText)
		}
	}

	_, err = s.codex.RunJSONL(ctx, args, nil, func(evt CodexJSONLEvent) {
		if id := codexExternalSessionIDFromEvent(evt.Value); id != "" {
			persistExternalSessionID(id)
		}
		if onEvent != nil {
			onEvent(evt.Value)
		}

		typeValue, _ := evt.Value["type"].(string)
		if typeValue == "item.completed" {
			item, _ := evt.Value["item"].(map[string]any)
			itemType, _ := item["type"].(string)
			if itemType == "agent_message" {
				if text := firstNonEmptyString(item["text"], item["output_text"]); text != "" {
					if resultText.Len() > 0 {
						resultText.WriteByte('\n')
					}
					resultText.WriteString(text)
				}
			}
		}
		if typeValue == "message_end" {
			if message, ok := evt.Value["message"].(map[string]any); ok {
				if role, _ := message["role"].(string); role == "assistant" {
					if text := firstNonEmptyString(message["content"], message["text"]); text != "" {
						if resultText.Len() > 0 {
							resultText.WriteByte('\n')
						}
						resultText.WriteString(text)
					}
				}
			}
		}
	})
	if err != nil {
		return modelRunResult{}, err
	}
	return modelRunResult{
		ExternalSessionID: seenExternalSessionID,
		Text:              strings.TrimSpace(resultText.String()),
	}, nil
}

func (s *server) executePiCLIRun(ctx context.Context, session *sessionRecord, input []normalizedInput, onEvent func(map[string]any)) (modelRunResult, error) {
	prompt := promptFromInputs(input)
	resolvedModel, resolvedEffort, err := resolveSessionDefaultsForExecution("pi", session.Model, session.ModelReasoningEffort)
	if err != nil {
		return modelRunResult{}, err
	}
	sessionFile := ""
	if session.ExternalSessionID != nil {
		sessionFile = strings.TrimSpace(*session.ExternalSessionID)
	}
	if sessionFile == "" {
		sessionFile = s.defaultPISessionFile(session.ID)
	}

	if err := os.MkdirAll(filepath.Dir(sessionFile), 0o755); err != nil {
		return modelRunResult{}, err
	}

	opts := PiOptions{
		Print:      true,
		Mode:       "json",
		Session:    sessionFile,
		SessionDir: filepath.Dir(sessionFile),
		Messages:   []string{prompt},
	}
	if resolvedModel != nil {
		opts.Model = strings.TrimSpace(*resolvedModel)
	}
	if resolvedEffort != nil {
		opts.Thinking = strings.TrimSpace(*resolvedEffort)
	}

	var textBuilder strings.Builder
	_, err = s.pi.RunJSONL(ctx, s.pi.Args(opts), nil, func(evt PiJSONLEvent) {
		if onEvent != nil {
			if compact, ok := compactPIEventForStream(evt.Value); ok {
				onEvent(compact)
			}
		}

		typeValue, _ := evt.Value["type"].(string)
		if typeValue != "message_update" {
			if typeValue == "message_end" && textBuilder.Len() == 0 {
				message, _ := evt.Value["message"].(map[string]any)
				if text := piAssistantTextFromMessage(message); text != "" {
					textBuilder.WriteString(text)
				}
			}
			return
		}
		assistant, _ := evt.Value["assistantMessageEvent"].(map[string]any)
		if assistant == nil {
			return
		}
		eventType, _ := assistant["type"].(string)
		if eventType != "text_delta" && eventType != "text" {
			return
		}
		if delta, ok := assistant["delta"].(string); ok {
			textBuilder.WriteString(delta)
			return
		}
		if text, ok := assistant["text"].(string); ok {
			textBuilder.WriteString(text)
		}
	})
	if err != nil {
		return modelRunResult{}, err
	}
	return modelRunResult{
		ExternalSessionID: sessionFile,
		Text:              strings.TrimSpace(textBuilder.String()),
	}, nil
}

func compactPIEventForStream(value map[string]any) (map[string]any, bool) {
	if len(value) == 0 {
		return nil, false
	}
	typeValue := strings.TrimSpace(firstNonEmptyString(value["type"]))
	switch typeValue {
	case "turn_start", "turn_end", "agent_start", "agent_end":
		return map[string]any{"type": typeValue}, true
	case "error":
		message := strings.TrimSpace(firstNonEmptyString(value["message"], value["error"]))
		if message == "" {
			message = "Unknown error"
		}
		return map[string]any{
			"type":    "error",
			"message": message,
		}, true
	case "tool_execution_end":
		out := map[string]any{"type": "tool_execution_end"}
		if toolName := strings.TrimSpace(firstNonEmptyString(value["toolName"])); toolName != "" {
			out["toolName"] = toolName
		}
		if result, ok := value["result"]; ok {
			out["result"] = result
		}
		return out, true
	case "message_end":
		message, _ := value["message"].(map[string]any)
		compact := compactPIMessage(message)
		if compact == nil {
			return nil, false
		}
		return map[string]any{
			"type":    "message_end",
			"message": compact,
		}, true
	default:
		return nil, false
	}
}

func compactPIMessage(message map[string]any) map[string]any {
	if len(message) == 0 {
		return nil
	}
	role := strings.TrimSpace(firstNonEmptyString(message["role"]))
	if role == "" {
		return nil
	}
	out := map[string]any{"role": role}
	if id := strings.TrimSpace(firstNonEmptyString(message["id"])); id != "" {
		out["id"] = id
	}

	switch role {
	case "bashExecution":
		if command := firstNonEmptyString(message["command"]); command != "" {
			out["command"] = command
		}
		if output := firstNonEmptyString(message["output"]); output != "" {
			out["output"] = output
		}
		if exitCode, ok := message["exitCode"]; ok {
			out["exitCode"] = exitCode
		}
		return out
	case "toolResult":
		if toolName := strings.TrimSpace(firstNonEmptyString(message["toolName"])); toolName != "" {
			out["toolName"] = toolName
		}
		if details, ok := message["details"]; ok {
			out["details"] = details
		}
	case "custom":
		if customType := strings.TrimSpace(firstNonEmptyString(message["customType"])); customType != "" {
			out["customType"] = customType
		}
	}

	if content := compactPIMessageContent(message["content"]); len(content) > 0 {
		out["content"] = content
		return out
	}
	if text := strings.TrimSpace(firstNonEmptyString(message["text"])); text != "" {
		out["content"] = []map[string]any{{"type": "text", "text": text}}
		return out
	}
	return out
}

func compactPIMessageContent(content any) []map[string]any {
	switch typed := content.(type) {
	case string:
		text := strings.TrimSpace(typed)
		if text == "" {
			return nil
		}
		return []map[string]any{{"type": "text", "text": text}}
	case []any:
		out := make([]map[string]any, 0, len(typed))
		for _, rawItem := range typed {
			item, _ := rawItem.(map[string]any)
			if len(item) == 0 {
				continue
			}
			itemType, _ := item["type"].(string)
			switch itemType {
			case "text":
				text, _ := item["text"].(string)
				text = strings.TrimSpace(text)
				if text == "" {
					continue
				}
				out = append(out, map[string]any{
					"type": "text",
					"text": text,
				})
			case "toolCall":
				next := map[string]any{"type": "toolCall"}
				if name := strings.TrimSpace(firstNonEmptyString(item["name"])); name != "" {
					next["name"] = name
				}
				if args, ok := item["arguments"]; ok {
					next["arguments"] = args
				}
				out = append(out, next)
			case "image":
				next := map[string]any{"type": "image"}
				if mimeType := strings.TrimSpace(firstNonEmptyString(item["mimeType"])); mimeType != "" {
					next["mimeType"] = mimeType
				}
				out = append(out, next)
			}
		}
		if len(out) == 0 {
			return nil
		}
		return out
	default:
		return nil
	}
}

func piAssistantTextFromMessage(message map[string]any) string {
	if len(message) == 0 {
		return ""
	}
	role := strings.TrimSpace(firstNonEmptyString(message["role"]))
	if role != "assistant" {
		return ""
	}
	if text := strings.TrimSpace(firstNonEmptyString(message["text"])); text != "" {
		return text
	}
	contentString, _ := message["content"].(string)
	if trimmed := strings.TrimSpace(contentString); trimmed != "" {
		return trimmed
	}
	content, _ := message["content"].([]any)
	var textBuilder strings.Builder
	for _, rawItem := range content {
		item, _ := rawItem.(map[string]any)
		if len(item) == 0 {
			continue
		}
		itemType, _ := item["type"].(string)
		if itemType != "text" {
			continue
		}
		text, _ := item["text"].(string)
		text = strings.TrimSpace(text)
		if text == "" {
			continue
		}
		if textBuilder.Len() > 0 {
			textBuilder.WriteByte('\n')
		}
		textBuilder.WriteString(text)
	}
	return strings.TrimSpace(textBuilder.String())
}

func promptFromInputs(input []normalizedInput) string {
	parts := []string{}
	for _, item := range input {
		switch item.Type {
		case "text":
			if v := strings.TrimSpace(item.Text); v != "" {
				parts = append(parts, v)
			}
		case "local_image":
			if v := strings.TrimSpace(item.Path); v != "" {
				parts = append(parts, fmt.Sprintf("[Image: %s]", v))
			}
		}
	}
	if len(parts) == 0 {
		return "User provided non-text input. Describe what you can do next."
	}
	return strings.Join(parts, "\n")
}

func firstNonEmptyString(values ...any) string {
	for _, v := range values {
		switch t := v.(type) {
		case string:
			if trimmed := strings.TrimSpace(t); trimmed != "" {
				return trimmed
			}
		case []any:
			buf := strings.Builder{}
			for _, item := range t {
				if s := firstNonEmptyString(item); s != "" {
					if buf.Len() > 0 {
						buf.WriteByte('\n')
					}
					buf.WriteString(s)
				}
			}
			if buf.Len() > 0 {
				return buf.String()
			}
		case map[string]any:
			if s := firstNonEmptyString(t["text"], t["content"], t["output_text"]); s != "" {
				return s
			}
		}
	}
	return ""
}

func codexExternalSessionIDFromEvent(value map[string]any) string {
	return firstNonEmptyString(
		value["thread_id"],
		value["threadId"],
		value["session_id"],
		value["sessionId"],
		value["conversation_id"],
		value["conversationId"],
	)
}

func (s *server) defaultPISessionFile(sessionID string) string {
	base := filepath.Join(s.cfg.RuntimeDir, "runtime", "pi-sessions")
	return filepath.Join(base, sessionID+".jsonl")
}

func (s *server) handleSessionStream(w http.ResponseWriter, r *http.Request) error {
	sessionID, err := requireSessionID(chi.URLParam(r, "id"))
	if err != nil {
		return err
	}
	if _, err := s.requireAuth(r); err != nil {
		return err
	}

	session, err := s.store.getSessionByID(sessionID)
	if err != nil {
		return err
	}
	if session == nil {
		return fail(http.StatusNotFound, "Session not found")
	}
	messages, err := s.store.getMessagesBySessionID(sessionID)
	if err != nil {
		return err
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		return fail(http.StatusInternalServerError, "Streaming unsupported")
	}
	setSSEHeaders(w)

	ch := make(chan sessionstate.Event, 256)
	s.state.ReplaceSessionSubscriber(sessionID, ch)
	defer s.state.RemoveSessionSubscriber(sessionID, ch)

	if err := writeSSE(w, "connected", map[string]any{"sessionId": sessionID}); err != nil {
		return nil
	}
	for _, msg := range messages {
		if err := writeSSE(w, eventNameForMessage(msg), msg); err != nil {
			return nil
		}
	}
	if err := writeSSE(w, "status", map[string]any{"isRunning": s.state.IsSessionRunning(sessionID)}); err != nil {
		return nil
	}
	flusher.Flush()

	ticker := time.NewTicker(sseKeepaliveMS)
	defer ticker.Stop()

	for {
		select {
		case evt, ok := <-ch:
			if !ok {
				return nil
			}
			if err := writeSSE(w, evt.Event, evt.Data); err != nil {
				return nil
			}
			flusher.Flush()
		case <-ticker.C:
			if err := writeSSE(w, "ping", map[string]any{"ts": time.Now().UnixMilli(), "pad": sseKeepalivePadding}); err != nil {
				return nil
			}
			flusher.Flush()
		case <-r.Context().Done():
			return nil
		}
	}
}

func (s *server) handleRunStream(w http.ResponseWriter, r *http.Request) error {
	sessionID, err := requireSessionID(chi.URLParam(r, "id"))
	if err != nil {
		return err
	}
	runID, err := requireRunID(chi.URLParam(r, "runId"))
	if err != nil {
		return err
	}
	if _, err := s.requireAuth(r); err != nil {
		return err
	}
	session, err := s.store.getSessionByID(sessionID)
	if err != nil {
		return err
	}
	if session == nil {
		return fail(http.StatusNotFound, "Session not found")
	}

	buffer, ch, done, ok := s.state.OpenRunStream(runID, sessionID)
	if !ok {
		return fail(http.StatusNotFound, "Run not found")
	}
	defer s.state.DetachRunSubscriber(runID, ch)

	flusher, ok := w.(http.Flusher)
	if !ok {
		return fail(http.StatusInternalServerError, "Streaming unsupported")
	}
	setSSEHeaders(w)

	for _, evt := range buffer {
		if err := writeSSE(w, evt.Event, evt.Data); err != nil {
			return nil
		}
	}
	flusher.Flush()

	if done {
		return nil
	}

	ticker := time.NewTicker(sseKeepaliveMS)
	defer ticker.Stop()
	for {
		select {
		case evt, ok := <-ch:
			if !ok {
				return nil
			}
			if err := writeSSE(w, evt.Event, evt.Data); err != nil {
				return nil
			}
			flusher.Flush()
		case <-ticker.C:
			if err := writeSSE(w, "ping", map[string]any{"ts": time.Now().UnixMilli(), "pad": sseKeepalivePadding}); err != nil {
				return nil
			}
			flusher.Flush()
		case <-r.Context().Done():
			return nil
		}
	}
}

func (s *server) handleStopRun(w http.ResponseWriter, r *http.Request) error {
	sessionID, err := requireSessionID(chi.URLParam(r, "id"))
	if err != nil {
		return err
	}
	if _, err := s.requireAuth(r); err != nil {
		return err
	}
	session, err := s.store.getSessionByID(sessionID)
	if err != nil {
		return err
	}
	if session == nil {
		return fail(http.StatusNotFound, "Session not found")
	}

	if !s.state.StopRun(sessionID) {
		writeJSON(w, http.StatusOK, map[string]any{
			"success":   false,
			"sessionId": sessionID,
			"message":   "No active run to stop",
		})
		return nil
	}

	_ = s.store.setSessionStatus(sessionID, "initial")
	s.queueManagerSessionSync(sessionID)
	s.state.PushSessionEvent(sessionID, "stopped", map[string]any{
		"sessionId": sessionID,
		"reason":    "manual_stop",
	})

	writeJSON(w, http.StatusOK, map[string]any{
		"success":   true,
		"sessionId": sessionID,
		"message":   "Run stopped successfully",
	})
	return nil
}

func (s *server) handleDeleteSession(w http.ResponseWriter, r *http.Request) error {
	sessionID, err := requireSessionID(chi.URLParam(r, "id"))
	if err != nil {
		return err
	}
	if _, err := s.requireAuth(r); err != nil {
		return err
	}
	session, err := s.store.getSessionByID(sessionID)
	if err != nil {
		return err
	}
	if session == nil {
		return fail(http.StatusNotFound, "Session not found")
	}

	s.state.StopRun(sessionID)
	s.state.CloseSessionStream(sessionID)

	deleted, err := s.store.deleteSession(sessionID)
	if err != nil {
		return err
	}
	if !deleted {
		return fail(http.StatusInternalServerError, "Failed to delete session")
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"success":   true,
		"sessionId": sessionID,
		"message":   "Session deleted successfully",
	})
	return nil
}

func (s *server) handleListWorkspaces(w http.ResponseWriter, r *http.Request) error {
	if _, err := s.requireAuth(r); err != nil {
		return err
	}
	includeStatus := false
	if raw := strings.TrimSpace(r.URL.Query().Get("includeStatus")); raw != "" {
		parsed, err := strconv.ParseBool(raw)
		if err == nil {
			includeStatus = parsed
		}
	}

	entries, err := os.ReadDir(s.cfg.WorkspacesDir)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"workspaces": []any{}})
		return nil
	}

	type workspaceItem struct {
		Name      string         `json:"name"`
		Path      string         `json:"path"`
		IsGitRepo bool           `json:"isGitRepo"`
		Status    map[string]any `json:"status,omitempty"`
	}
	items := make([]workspaceItem, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		name := entry.Name()
		root, err := resolveWorkspaceRoot(s.cfg.WorkspacesDir, name)
		if err != nil {
			continue
		}
		isGit := workspacepkg.IsGitRepoRoot(root)
		item := workspaceItem{Name: name, Path: root, IsGitRepo: isGit}
		if includeStatus && isGit {
			st := workspacepkg.RepoStatus(root)
			item.Status = map[string]any{
				"hasChanges": st.HasChanges,
				"staged":     st.Staged,
				"unstaged":   st.Unstaged,
				"untracked":  st.Untracked,
			}
		}
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Name < items[j].Name })
	writeJSON(w, http.StatusOK, map[string]any{"workspaces": items})
	return nil
}

func (s *server) handleWorkspaceDiff(w http.ResponseWriter, r *http.Request) error {
	if _, err := s.requireAuth(r); err != nil {
		return err
	}
	name, root, err := s.resolveWorkspaceRequest(r)
	if err != nil {
		return err
	}
	isGit := workspacepkg.IsGitRepoRoot(root)

	basis := strings.TrimSpace(r.URL.Query().Get("basis"))
	if basis == "" {
		basis = "repo_head"
	}
	if basis != "repo_head" && basis != "baseline" {
		return fail(http.StatusBadRequest, "Invalid basis")
	}

	maxChars := 200_000
	if raw := strings.TrimSpace(r.URL.Query().Get("maxChars")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > maxWorkspacePatchChar {
			return fail(http.StatusBadRequest, "Invalid maxChars")
		}
		maxChars = n
	}

	includePatch := true
	if raw := strings.TrimSpace(r.URL.Query().Get("includePatch")); raw != "" {
		parsed, err := strconv.ParseBool(raw)
		if err == nil {
			includePatch = parsed
		}
	}

	status := workspacepkg.RepoStatus(root)
	if !isGit {
		writeJSON(w, http.StatusOK, map[string]any{
			"name":      name,
			"root":      root,
			"isGitRepo": false,
			"status":    status,
			"patch":     "",
			"truncated": false,
			"diffBasis": basis,
		})
		return nil
	}

	if !includePatch {
		resp := map[string]any{
			"name":      name,
			"root":      root,
			"isGitRepo": true,
			"status":    status,
			"patch":     "",
			"truncated": false,
			"diffBasis": basis,
		}
		if basis == "baseline" {
			resp["baselineStatus"] = "ready"
		}
		writeJSON(w, http.StatusOK, resp)
		return nil
	}

	patch, truncated := workspacepkg.RepoPatch(root, maxChars)
	resp := map[string]any{
		"name":      name,
		"root":      root,
		"isGitRepo": true,
		"status":    status,
		"patch":     patch,
		"truncated": truncated,
		"diffBasis": basis,
	}
	if basis == "baseline" {
		resp["baselineStatus"] = "ready"
	}
	writeJSON(w, http.StatusOK, resp)
	return nil
}

func (s *server) handleWorkspaceDiffStream(w http.ResponseWriter, r *http.Request) error {
	if _, err := s.requireAuth(r); err != nil {
		return err
	}
	name, root, err := s.resolveWorkspaceRequest(r)
	if err != nil {
		return err
	}
	isGit := workspacepkg.IsGitRepoRoot(root)

	basis := strings.TrimSpace(r.URL.Query().Get("basis"))
	if basis == "" {
		basis = "repo_head"
	}
	if basis != "repo_head" && basis != "baseline" {
		return fail(http.StatusBadRequest, "Invalid basis")
	}
	maxChars := 200_000
	if raw := strings.TrimSpace(r.URL.Query().Get("maxChars")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > maxWorkspacePatchChar {
			return fail(http.StatusBadRequest, "Invalid maxChars")
		}
		maxChars = n
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		return fail(http.StatusInternalServerError, "Streaming unsupported")
	}
	setSSEHeaders(w)

	if err := writeSSE(w, "meta", map[string]any{
		"name":      name,
		"isGitRepo": isGit,
		"diffBasis": basis,
	}); err != nil {
		return nil
	}
	flusher.Flush()

	if !isGit {
		_ = writeSSE(w, "done", map[string]any{"truncated": false})
		flusher.Flush()
		return nil
	}

	status := workspacepkg.RepoStatus(root)
	_ = writeSSE(w, "status", status)
	if basis == "baseline" {
		_ = writeSSE(w, "baseline", map[string]any{"status": "ready"})
	}
	flusher.Flush()

	filePatches, truncated := workspacepkg.RepoPatchByFile(root, maxChars)
	for _, fp := range filePatches {
		kind := fp.Kind
		if basis == "baseline" {
			if kind == "untracked" {
				kind = "baseline-untracked"
			} else {
				kind = "baseline-tracked"
			}
		}
		if err := writeSSE(w, "file", map[string]any{
			"kind":  kind,
			"path":  fp.Path,
			"patch": fp.Patch,
		}); err != nil {
			return nil
		}
		flusher.Flush()
	}
	_ = writeSSE(w, "done", map[string]any{"truncated": truncated})
	flusher.Flush()

	ticker := time.NewTicker(sseKeepaliveMS)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			if err := writeSSE(w, "ping", map[string]any{"ts": time.Now().UnixMilli(), "pad": workspacePingPadding}); err != nil {
				return nil
			}
			flusher.Flush()
		case <-r.Context().Done():
			return nil
		}
	}
}

func (s *server) handleWorkspaceDiffFileContents(w http.ResponseWriter, r *http.Request) error {
	if _, err := s.requireAuth(r); err != nil {
		return err
	}
	_, root, err := s.resolveWorkspaceRequest(r)
	if err != nil {
		return err
	}
	if !workspacepkg.IsGitRepoRoot(root) {
		return fail(http.StatusBadRequest, "Workspace is not a git repo")
	}

	q := r.URL.Query()
	basis := strings.TrimSpace(q.Get("basis"))
	if basis == "" {
		basis = "repo_head"
	}
	if basis != "repo_head" && basis != "baseline" {
		return fail(http.StatusBadRequest, "Invalid basis")
	}
	kind := strings.TrimSpace(q.Get("kind"))
	if kind == "" {
		return fail(http.StatusBadRequest, "Invalid kind")
	}
	filePath, err := ensureValidWorkspaceFilePath(q.Get("path"))
	if err != nil {
		return err
	}

	empty := map[string]any{"name": filePath, "contents": ""}

	if basis == "baseline" {
		switch kind {
		case "baseline-untracked":
			newContents := workspacepkg.ReadWorkTreeFile(root, filePath)
			writeJSON(w, http.StatusOK, map[string]any{
				"oldFile": empty,
				"newFile": map[string]any{"name": filePath, "contents": newContents},
			})
			return nil
		case "baseline-tracked":
			oldContents := workspacepkg.GitShowFile(root, "HEAD:"+filePath)
			newContents := workspacepkg.ReadWorkTreeFile(root, filePath)
			writeJSON(w, http.StatusOK, map[string]any{
				"oldFile": map[string]any{"name": filePath, "contents": oldContents},
				"newFile": map[string]any{"name": filePath, "contents": newContents},
			})
			return nil
		default:
			return fail(http.StatusBadRequest, "Invalid kind for baseline diff")
		}
	}

	if kind == "baseline-tracked" || kind == "baseline-untracked" {
		return fail(http.StatusBadRequest, "Invalid kind for repo_head diff")
	}

	switch kind {
	case "untracked":
		newContents := workspacepkg.ReadWorkTreeFile(root, filePath)
		writeJSON(w, http.StatusOK, map[string]any{
			"oldFile": empty,
			"newFile": map[string]any{"name": filePath, "contents": newContents},
		})
		return nil
	case "staged":
		oldContents := workspacepkg.GitShowFile(root, "HEAD:"+filePath)
		newContents := workspacepkg.GitShowFile(root, ":"+filePath)
		writeJSON(w, http.StatusOK, map[string]any{
			"oldFile": map[string]any{"name": filePath, "contents": oldContents},
			"newFile": map[string]any{"name": filePath, "contents": newContents},
		})
		return nil
	case "unstaged":
		oldContents := workspacepkg.GitShowFile(root, ":"+filePath)
		newContents := workspacepkg.ReadWorkTreeFile(root, filePath)
		writeJSON(w, http.StatusOK, map[string]any{
			"oldFile": map[string]any{"name": filePath, "contents": oldContents},
			"newFile": map[string]any{"name": filePath, "contents": newContents},
		})
		return nil
	default:
		return fail(http.StatusBadRequest, "Invalid kind")
	}
}

func (s *server) resolveWorkspaceRequest(r *http.Request) (string, string, error) {
	name, err := ensureValidWorkspaceName(chi.URLParam(r, "name"))
	if err != nil {
		return "", "", err
	}
	root, err := resolveWorkspaceRoot(s.cfg.WorkspacesDir, name)
	if err != nil {
		return "", "", err
	}
	return name, root, nil
}

func setSSEHeaders(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("X-Accel-Buffering", "no")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
}

func writeSSE(w http.ResponseWriter, event string, data any) error {
	payload, err := json.Marshal(data)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, payload)
	return err
}

func requireSessionID(id string) (string, error) {
	value := strings.ToLower(strings.TrimSpace(id))
	if !sessionIDRegex.MatchString(value) {
		return "", fail(http.StatusBadRequest, "Invalid session ID format")
	}
	return value, nil
}

func requireRunID(id string) (string, error) {
	value := strings.ToLower(strings.TrimSpace(id))
	if !runIDRegex.MatchString(value) {
		return "", fail(http.StatusBadRequest, "Invalid run ID format")
	}
	return value, nil
}

func isValidReasoningEffort(value string) bool {
	switch value {
	case "minimal", "low", "medium", "high", "xhigh":
		return true
	default:
		return false
	}
}

type authContext struct {
	SID     string
	AgentID string
	UserID  string
}

func (s *server) requireAuth(r *http.Request) (authContext, error) {
	if internalSecret := strings.TrimSpace(r.Header.Get("X-Agent-Internal-Auth")); internalSecret != "" {
		if s.cfg.AgentInternalAuthSecret == "" {
			return authContext{}, fail(http.StatusUnauthorized, "Unauthorized")
		}
		if subtle.ConstantTimeCompare(
			[]byte(internalSecret),
			[]byte(s.cfg.AgentInternalAuthSecret),
		) != 1 {
			return authContext{}, fail(http.StatusUnauthorized, "Unauthorized")
		}
		actorUserID := strings.TrimSpace(r.Header.Get("X-Actor-User-Id"))
		if actorUserID == "" {
			return authContext{}, fail(http.StatusUnauthorized, "Unauthorized")
		}
		return authContext{AgentID: s.cfg.AgentID, UserID: actorUserID}, nil
	}

	token := readAuthToken(r)
	if token == "" {
		return authContext{}, fail(http.StatusUnauthorized, "Unauthorized")
	}
	sid, err := extractSIDUnverified(token)
	if err != nil || sid == "" {
		return authContext{}, fail(http.StatusUnauthorized, "Unauthorized")
	}
	secret := deriveSandboxSecret(s.cfg.SecretSeed, sid)
	claims := jwt.MapClaims{}
	_, err = jwt.ParseWithClaims(token, claims, func(t *jwt.Token) (any, error) {
		if t.Method.Alg() != jwt.SigningMethodHS256.Alg() {
			return nil, errors.New("invalid signing method")
		}
		return []byte(secret), nil
	})
	if err != nil {
		return authContext{}, fail(http.StatusUnauthorized, "Unauthorized")
	}

	payloadSID, _ := claims["sid"].(string)
	if strings.TrimSpace(payloadSID) != sid {
		return authContext{}, fail(http.StatusUnauthorized, "Unauthorized")
	}
	typ, _ := claims["typ"].(string)
	if strings.TrimSpace(typ) != "sandbox-agent" {
		return authContext{}, fail(http.StatusUnauthorized, "Unauthorized")
	}
	agentID, _ := claims["agentId"].(string)
	agentID = strings.TrimSpace(agentID)
	if agentID == "" || agentID != s.cfg.AgentID {
		return authContext{}, fail(http.StatusUnauthorized, "Unauthorized")
	}

	sub, _ := claims["sub"].(string)
	sub = strings.TrimSpace(sub)
	if sub == "" {
		return authContext{}, fail(http.StatusUnauthorized, "Unauthorized")
	}
	return authContext{SID: sid, AgentID: agentID, UserID: sub}, nil
}

func readAuthToken(r *http.Request) string {
	if token := readBearerToken(r.Header.Get("X-Agent-Auth")); token != "" {
		return token
	}
	if token := readBearerToken(r.Header.Get("Authorization")); token != "" {
		return token
	}
	if token := readWebSocketProtocolAuthToken(r.Header.Get("Sec-WebSocket-Protocol")); token != "" {
		return token
	}
	return ""
}

func readWebSocketProtocolAuthToken(raw string) string {
	for _, protocol := range parseWebSocketProtocols(raw) {
		if token := parseWebSocketProtocolToken(protocol); token != "" {
			return token
		}
	}
	return ""
}

func parseWebSocketProtocolToken(protocol string) string {
	candidate := strings.TrimSpace(protocol)
	if candidate == "" {
		return ""
	}
	if isLikelyJWT(candidate) {
		return candidate
	}
	for _, prefix := range []string{"agent-auth.", "bearer.", "auth.bearer."} {
		if strings.HasPrefix(strings.ToLower(candidate), prefix) {
			if token := strings.TrimSpace(candidate[len(prefix):]); isLikelyJWT(token) {
				return token
			}
		}
	}
	return ""
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

func isLikelyJWT(value string) bool {
	parts := strings.Split(strings.TrimSpace(value), ".")
	if len(parts) != 3 {
		return false
	}
	for _, part := range parts {
		if part == "" || !isBase64URLSegment(part) {
			return false
		}
	}
	return true
}

func isBase64URLSegment(value string) bool {
	for i := 0; i < len(value); i++ {
		c := value[i]
		switch {
		case c >= 'a' && c <= 'z':
		case c >= 'A' && c <= 'Z':
		case c >= '0' && c <= '9':
		case c == '-', c == '_':
		default:
			return false
		}
	}
	return true
}

func readBearerToken(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	lower := strings.ToLower(trimmed)
	if strings.HasPrefix(lower, "bearer ") {
		return strings.TrimSpace(trimmed[len("bearer "):])
	}
	return trimmed
}

func extractSIDUnverified(token string) (string, error) {
	claims := jwt.MapClaims{}
	parser := jwt.NewParser(jwt.WithoutClaimsValidation())
	_, _, err := parser.ParseUnverified(token, claims)
	if err != nil {
		return "", err
	}
	sid, _ := claims["sid"].(string)
	sid = strings.TrimSpace(sid)
	if sid == "" {
		return "", errors.New("missing sid")
	}
	return sid, nil
}

func deriveSandboxSecret(seed, sid string) string {
	h := hmac.New(sha256.New, []byte(seed))
	_, _ = h.Write([]byte("sandbox-agent:" + sid))
	return hex.EncodeToString(h.Sum(nil))
}
