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

type runStream struct {
	SessionID string
	Buffer    []Event
	Done      bool
	Sub       chan Event
	Timer     *time.Timer
}

type State struct {
	mu          sync.Mutex
	running     map[string]*activeRun
	sessionSubs map[string]chan Event
	runStreams  map[string]*runStream
}

func New() *State {
	return &State{
		running:     map[string]*activeRun{},
		sessionSubs: map[string]chan Event{},
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

func (rs *State) ReplaceSessionSubscriber(sessionID string, ch chan Event) {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	if prev, ok := rs.sessionSubs[sessionID]; ok {
		close(prev)
	}
	rs.sessionSubs[sessionID] = ch
}

func (rs *State) RemoveSessionSubscriber(sessionID string, ch chan Event) {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	if existing, ok := rs.sessionSubs[sessionID]; ok && existing == ch {
		delete(rs.sessionSubs, sessionID)
	}
}

func (rs *State) CloseSessionStream(sessionID string) {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	if ch, ok := rs.sessionSubs[sessionID]; ok {
		close(ch)
		delete(rs.sessionSubs, sessionID)
	}
}

func (rs *State) PushSessionEvent(sessionID, event string, data any) {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	ch, ok := rs.sessionSubs[sessionID]
	if !ok {
		return
	}
	select {
	case ch <- Event{Event: event, Data: data}:
	default:
	}
}

func (rs *State) CreateRunStream(runID, sessionID string) {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	rs.runStreams[runID] = &runStream{SessionID: sessionID, Buffer: []Event{}}
}

func (rs *State) OpenRunStream(runID, sessionID string) ([]Event, chan Event, bool, bool) {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	run, ok := rs.runStreams[runID]
	if !ok || run.SessionID != sessionID {
		return nil, nil, false, false
	}
	if run.Timer != nil {
		run.Timer.Stop()
		run.Timer = nil
	}
	buffer := append([]Event(nil), run.Buffer...)
	run.Buffer = nil
	if run.Done {
		delete(rs.runStreams, runID)
		return buffer, nil, true, true
	}
	if run.Sub != nil {
		close(run.Sub)
	}
	ch := make(chan Event, 256)
	run.Sub = ch
	return buffer, ch, false, true
}

func (rs *State) DetachRunSubscriber(runID string, ch chan Event) {
	if ch == nil {
		return
	}
	rs.mu.Lock()
	defer rs.mu.Unlock()
	run, ok := rs.runStreams[runID]
	if !ok {
		return
	}
	if run.Sub == ch {
		run.Sub = nil
	}
}

func (rs *State) PushRunEvent(runID, event string, data any) {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	run, ok := rs.runStreams[runID]
	if !ok {
		return
	}
	if run.Sub != nil {
		select {
		case run.Sub <- Event{Event: event, Data: data}:
		default:
		}
		return
	}
	run.Buffer = append(run.Buffer, Event{Event: event, Data: data})
}

func (rs *State) EndRunStream(runID string) {
	rs.mu.Lock()
	run, ok := rs.runStreams[runID]
	if !ok {
		rs.mu.Unlock()
		return
	}
	run.Done = true
	if run.Sub != nil {
		ch := run.Sub
		run.Sub = nil
		delete(rs.runStreams, runID)
		rs.mu.Unlock()
		close(ch)
		return
	}
	run.Timer = time.AfterFunc(60*time.Second, func() {
		rs.mu.Lock()
		defer rs.mu.Unlock()
		delete(rs.runStreams, runID)
	})
	rs.mu.Unlock()
}
