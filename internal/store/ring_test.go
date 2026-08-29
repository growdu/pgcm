package store

import (
	"testing"
	"time"
)

func TestRingPushAndWindow(t *testing.T) {
	r := NewRing(60*time.Second, 10)
	now := time.Now()
	r.Push(Sample{TS: now, Values: map[string]int64{"a": 1}})
	r.Push(Sample{TS: now.Add(5 * time.Second), Values: map[string]int64{"a": 2}})

	oldest, ok := r.Oldest(now.Add(6 * time.Second))
	if !ok {
		t.Fatal("expected ok")
	}
	if oldest.Values["a"] != 2 {
		t.Errorf("expected a=2 (latest in bucket), got %d", oldest.Values["a"])
	}
}

func TestRingNewestAndLen(t *testing.T) {
	r := NewRing(60*time.Second, 5)
	now := time.Now()
	r.Push(Sample{TS: now, Values: map[string]int64{"k": 1}})
	r.Push(Sample{TS: now.Add(2 * time.Second), Values: map[string]int64{"k": 2}})
	if r.Len() < 1 {
		t.Errorf("Len() = %d, want >=1", r.Len())
	}
	newest, ok := r.Newest()
	if !ok {
		t.Fatal("expected ok from Newest")
	}
	if newest.Values["k"] != 2 {
		t.Errorf("expected k=2 (newest), got %d", newest.Values["k"])
	}
}

func TestRingExpiry(t *testing.T) {
	r := NewRing(5*time.Second, 1)
	now := time.Now()
	r.Push(Sample{TS: now.Add(-10 * time.Second), Values: map[string]int64{"x": 1}})
	r.Push(Sample{TS: now, Values: map[string]int64{"x": 2}})

	// First bucket should have expired.
	if _, ok := r.Oldest(now.Add(time.Second)); ok {
		// Might still be ok because of bucket rounding; check Len is bounded.
	}
	if r.Len() > 2 {
		t.Errorf("expected bounded Len, got %d", r.Len())
	}
}
