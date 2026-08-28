package version

import "runtime"

// 通过 ldflags 注入（构建时）：-ldflags "-X github.com/pgcm/pgcm/internal/version.Version=v0.1.0"
var (
	Version = "dev"
	Commit  = "none"
	Date    = "unknown"
)

// GoVersion returns the runtime Go version.
func GoVersion() string { return runtime.Version() }

// Full returns a human-readable version string.
func Full() string { return Version + " (" + Commit + ", " + Date + ", " + GoVersion() + ")" }
