package model

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestSnapshotMarshal(t *testing.T) {
	s := Snapshot{
		TakenAt:     "2025-01-01T00:00:00Z",
		NodeID:      "n1",
		NodeName:    "primary",
		PGVersion:   "16.1",
		ClusterKind: "logical",
		Slots:       []SlotHealth{},
	}
	b, err := json.Marshal(s)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	// omitempty check: ClusterKind non-empty → present
	if !contains(string(b), `"cluster_kind":"logical"`) {
		t.Errorf("expected cluster_kind in JSON: %s", string(b))
	}

	// omitempty on Logical/Physical
	var s2 Snapshot
	if err := json.Unmarshal(b, &s2); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if s2.ClusterKind != "logical" {
		t.Errorf("ClusterKind round-trip failed: got %q", s2.ClusterKind)
	}
}

func TestSnapshotOmitClusterKind(t *testing.T) {
	s := Snapshot{TakenAt: "x"}
	b, _ := json.Marshal(s)
	if contains(string(b), `"cluster_kind"`) {
		t.Errorf("expected cluster_kind to be omitted when empty: %s", string(b))
	}
}

func contains(haystack, needle string) bool {
	return strings.Contains(haystack, needle)
}
