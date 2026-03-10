package session

import (
	"context"
	"sync"
	"time"
)

type Event struct {
	Event string
	Data  any
}

type activeRun struct {
	RunID  string
	Cancel context.CancelFunc
}

type subscribers map[chan Event]struct{}

type runStream struct {
	SessionID string
	Buffer    []Event
	Done      bool
	Subs      subscribers
	Timer     *time.Timer
}

type State struct {
	mu          sync.Mutex
	running     map[string]*activeRun
	sessionSubs map[string]subscribers
	runStreams  map[string]*runStream
}

func New() *State {
	return &State{
		running:     map[string]*activeRun{},
		sessionSubs: map[string]subscribers{},
		runStreams:  map[string]*runStream{},
	}
}

func (rs *State) StartRun(sessionID, runID string) bool {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	if _, ok := rs.running[sessionID]; ok {
		return false
	}
	rs.running[sessionID] = &activeRun{RunID: runID}
	return true
}

func (rs *State) BindRunCancel(sessionID string, cancel context.CancelFunc) {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	if run, ok := rs.running[sessionID]; ok {
		run.Cancel = cancel
	}
}

func (rs *State) FinishRun(sessionID string) {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	delete(rs.running, sessionID)
}

func (rs *State) IsSessionRunning(sessionID string) bool {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	_, ok := rs.running[sessionID]
	return ok
}

func (rs *State) StopRun(sessionID string) bool {
	rs.mu.Lock()
	run, ok := rs.running[sessionID]
	rs.mu.Unlock()
	if !ok {
		return false
	}
	if run.Cancel != nil {
		run.Cancel()
	}
	return true
}

func (rs *State) AddSessionSubscriber(sessionID string, ch chan Event) {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	subs := rs.sessionSubs[sessionID]
	if subs == nil {
		subs = subscribers{}
		rs.sessionSubs[sessionID] = subs
	}
	subs[ch] = struct{}{}
}

func (rs *State) RemoveSessionSubscriber(sessionID string, ch chan Event) {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	subs, ok := rs.sessionSubs[sessionID]
	if !ok {
		return
	}
	delete(subs, ch)
	if len(subs) == 0 {
		delete(rs.sessionSubs, sessionID)
	}
}

func (rs *State) CloseSessionStream(sessionID string) {
	rs.mu.Lock()
	subs := rs.sessionSubs[sessionID]
	delete(rs.sessionSubs, sessionID)
	rs.mu.Unlock()

	for ch := range subs {
		close(ch)
	}
}

func (rs *State) PushSessionEvent(sessionID, event string, data any) {
	rs.mu.Lock()
	subs, ok := rs.sessionSubs[sessionID]
	if !ok {
		rs.mu.Unlock()
		return
	}
	evt := Event{Event: event, Data: data}
	var stale []chan Event
	for ch := range subs {
		select {
		case ch <- evt:
		default:
			stale = append(stale, ch)
		}
	}
	for _, ch := range stale {
		delete(subs, ch)
		close(ch)
	}
	if len(subs) == 0 {
		delete(rs.sessionSubs, sessionID)
	}
	rs.mu.Unlock()
}

func (rs *State) CreateRunStream(runID, sessionID string) {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	rs.runStreams[runID] = &runStream{
		SessionID: sessionID,
		Buffer:    []Event{},
		Subs:      subscribers{},
	}
}

func (rs *State) AddRunSubscriber(runID, sessionID string, ch chan Event) ([]Event, bool, bool) {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	run, ok := rs.runStreams[runID]
	if !ok || run.SessionID != sessionID {
		return nil, false, false
	}
	buffer := append([]Event(nil), run.Buffer...)
	if run.Done {
		return buffer, true, true
	}
	if run.Timer != nil {
		run.Timer.Stop()
		run.Timer = nil
	}
	run.Subs[ch] = struct{}{}
	return buffer, false, true
}

func (rs *State) RemoveRunSubscriber(runID string, ch chan Event) {
	if ch == nil {
		return
	}
	rs.mu.Lock()
	defer rs.mu.Unlock()
	run, ok := rs.runStreams[runID]
	if !ok {
		return
	}
	delete(run.Subs, ch)
	if run.Done && len(run.Subs) == 0 && run.Timer == nil {
		run.Timer = time.AfterFunc(60*time.Second, func() {
			rs.mu.Lock()
			defer rs.mu.Unlock()
			delete(rs.runStreams, runID)
		})
	}
}

func (rs *State) PushRunEvent(runID, event string, data any) {
	rs.mu.Lock()
	run, ok := rs.runStreams[runID]
	if !ok {
		rs.mu.Unlock()
		return
	}
	evt := Event{Event: event, Data: data}
	run.Buffer = append(run.Buffer, evt)
	var stale []chan Event
	for ch := range run.Subs {
		select {
		case ch <- evt:
		default:
			stale = append(stale, ch)
		}
	}
	for _, ch := range stale {
		delete(run.Subs, ch)
		close(ch)
	}
	rs.mu.Unlock()
}

func (rs *State) EndRunStream(runID string) {
	rs.mu.Lock()
	run, ok := rs.runStreams[runID]
	if !ok {
		rs.mu.Unlock()
		return
	}
	run.Done = true
	subs := run.Subs
	run.Subs = subscribers{}
	if len(subs) > 0 {
		if run.Timer != nil {
			run.Timer.Stop()
		}
		run.Timer = time.AfterFunc(60*time.Second, func() {
			rs.mu.Lock()
			defer rs.mu.Unlock()
			delete(rs.runStreams, runID)
		})
		rs.mu.Unlock()
		for ch := range subs {
			close(ch)
		}
		return
	}
	run.Timer = time.AfterFunc(60*time.Second, func() {
		rs.mu.Lock()
		defer rs.mu.Unlock()
		delete(rs.runStreams, runID)
	})
	rs.mu.Unlock()
}

func (rs *State) CloseAllStreams() {
	rs.mu.Lock()
	sessionSubs := rs.sessionSubs
	runStreams := rs.runStreams
	rs.sessionSubs = map[string]subscribers{}
	rs.runStreams = map[string]*runStream{}
	rs.mu.Unlock()

	for _, subs := range sessionSubs {
		for ch := range subs {
			close(ch)
		}
	}
	for _, run := range runStreams {
		if run.Timer != nil {
			run.Timer.Stop()
		}
		for ch := range run.Subs {
			close(ch)
		}
	}
}
