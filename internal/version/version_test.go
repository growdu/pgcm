package version

import (
	"strings"
	"testing"
)

func TestFull(t *testing.T) {
	got := Full()
	for _, want := range []string{"dev", "none", "unknown", "go"} {
		if !strings.Contains(got, want) {
			t.Errorf("Full() = %q; missing substring %q", got, want)
		}
	}
}

func TestGoVersion(t *testing.T) {
	if GoVersion() == "" {
		t.Error("GoVersion() returned empty string")
	}
}
