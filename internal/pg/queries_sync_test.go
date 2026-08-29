package pg

import "testing"

func TestStateName(t *testing.T) {
	cases := map[string]string{
		"i": "INIT",
		"d": "DATA",
		"f": "FINISHED",
		"s": "SYNCED",
		"r": "READY",
		"x": "?",
		"":  "?",
	}
	for in, want := range cases {
		if got := stateName(in); got != want {
			t.Errorf("stateName(%q) = %q; want %q", in, got, want)
		}
	}
}
