package session

import (
	"testing"
	"time"
)

func readEvent(t *testing.T, ch <-chan Event) Event {
	t.Helper()
	select {
	case evt, ok := <-ch:
		if !ok {
			t.Fatal("expected event, channel closed")
		}
		return evt
	case <-time.After(500 * time.Millisecond):
		t.Fatal("timed out waiting for event")
		return Event{}
	}
}

func waitClosed(t *testing.T, ch <-chan Event) {
	t.Helper()
	select {
	case _, ok := <-ch:
		if ok {
			t.Fatal("expected closed channel")
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("timed out waiting for closed channel")
	}
}

func TestSessionSubscribersFanOutIndependently(t *testing.T) {
	state := New()
	first := make(chan Event, 2)
	second := make(chan Event, 2)

	state.AddSessionSubscriber("session-1", first)
	state.AddSessionSubscriber("session-1", second)
	state.PushSessionEvent("session-1", "status", map[string]any{"isRunning": true})

	if evt := readEvent(t, first); evt.Event != "status" {
		t.Fatalf("expected status event for first subscriber, got %#v", evt)
	}
	if evt := readEvent(t, second); evt.Event != "status" {
		t.Fatalf("expected status event for second subscriber, got %#v", evt)
	}

	state.RemoveSessionSubscriber("session-1", first)
	state.PushSessionEvent("session-1", "stopped", map[string]any{"reason": "done"})

	if evt := readEvent(t, second); evt.Event != "stopped" {
		t.Fatalf("expected stopped event for remaining subscriber, got %#v", evt)
	}

	select {
	case evt := <-first:
		t.Fatalf("removed subscriber should not receive new events, got %#v", evt)
	default:
	}
}

func TestSessionSlowSubscriberIsDisconnectedWithoutAffectingOthers(t *testing.T) {
	state := New()
	slow := make(chan Event, 1)
	fast := make(chan Event, 2)

	state.AddSessionSubscriber("session-1", slow)
	state.AddSessionSubscriber("session-1", fast)

	state.PushSessionEvent("session-1", "first", nil)
	state.PushSessionEvent("session-1", "second", nil)

	if evt := readEvent(t, fast); evt.Event != "first" {
		t.Fatalf("expected first fast event, got %#v", evt)
	}
	if evt := readEvent(t, fast); evt.Event != "second" {
		t.Fatalf("expected second fast event, got %#v", evt)
	}
	if evt := readEvent(t, slow); evt.Event != "first" {
		t.Fatalf("expected first slow event before disconnect, got %#v", evt)
	}
	waitClosed(t, slow)
}

func TestRunSubscribersShareReplayAndCloseIndependently(t *testing.T) {
	state := New()
	state.CreateRunStream("run-1", "session-1")
	state.PushRunEvent("run-1", "buffered", map[string]any{"n": 1})

	first := make(chan Event, 2)
	second := make(chan Event, 2)

	buffer, done, ok := state.AddRunSubscriber("run-1", "session-1", first)
	if !ok || done {
		t.Fatalf("expected active run stream, ok=%v done=%v", ok, done)
	}
	if len(buffer) != 1 || buffer[0].Event != "buffered" {
		t.Fatalf("expected replay buffer for first subscriber, got %#v", buffer)
	}

	buffer, done, ok = state.AddRunSubscriber("run-1", "session-1", second)
	if !ok || done {
		t.Fatalf("expected second active run stream, ok=%v done=%v", ok, done)
	}
	if len(buffer) != 1 || buffer[0].Event != "buffered" {
		t.Fatalf("expected replay buffer for second subscriber, got %#v", buffer)
	}

	state.PushRunEvent("run-1", "live", map[string]any{"n": 2})

	if evt := readEvent(t, first); evt.Event != "live" {
		t.Fatalf("expected live event for first subscriber, got %#v", evt)
	}
	if evt := readEvent(t, second); evt.Event != "live" {
		t.Fatalf("expected live event for second subscriber, got %#v", evt)
	}

	state.EndRunStream("run-1")
	waitClosed(t, first)
	waitClosed(t, second)

	buffer, done, ok = state.AddRunSubscriber("run-1", "session-1", make(chan Event, 1))
	if !ok || !done {
		t.Fatalf("expected completed run stream replay, ok=%v done=%v", ok, done)
	}
	if len(buffer) != 2 || buffer[0].Event != "buffered" || buffer[1].Event != "live" {
		t.Fatalf("expected full replay buffer after completion, got %#v", buffer)
	}
}
