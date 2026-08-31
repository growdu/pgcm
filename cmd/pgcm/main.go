// pgcm - PostgreSQL Cluster Monitor 单二进制入口。
package main

import (
	"context"
	"embed"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"fmt"
	"strings"
	"syscall"
	"time"

	"github.com/pgcm/pgcm/internal/model"
	"github.com/pgcm/pgcm/internal/pg"
	"github.com/pgcm/pgcm/internal/server"
	"github.com/pgcm/pgcm/internal/store"
)

//go:embed static
var staticFS embed.FS

func main() {
	var (
		listen     = flag.String("listen", "127.0.0.1:8080", "HTTP listen address")
		dsn        = flag.String("dsn", "", "Optional initial DSN (postgres://user:pass@host:5432/db). If empty, prompt via UI.")
		allowRemote = flag.Bool("allow-remote", false, "Allow bind to non-loopback without prompt (NOT RECOMMENDED)")
		logJSON    = flag.Bool("log-json", false, "Log in JSON format")
	)
	flag.Parse()

	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	if *logJSON {
		logger = slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	}

	// 安全提示
	if !isLoopback(*listen) && !*allowRemote {
		logger.Warn("⚠️  Listening on non-loopback without authentication",
			"addr", *listen,
			"warning", "anyone on the network can read your entire PostgreSQL instance",
		)
		logger.Info("waiting 5s before start (Ctrl-C to abort)")
		select {
		case <-time.After(5 * time.Second):
		case <-signalChan():
			logger.Info("aborted")
			return
		}
	}

	// graceful shutdown
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	reg := store.NewRegistry()
	conns := pg.NewConns(logger)
	mgr := server.NewManager(logger, reg, conns)
	defer mgr.CloseAll()
	defer conns.CloseAll()

	// ticker：每 5s 给所有 WS 客户端推 snapshot
	go runTicker(ctx, logger, mgr, reg)

	handler := server.New(server.Deps{
		StaticFS: staticFS,
		Logger:   logger,
		Manager:  mgr,
	})

	// 启动时可选 DSN
	if *dsn != "" {
		go connectInitial(ctx, logger, mgr, *dsn)
	}

	if err := server.Run(ctx, *listen, handler, logger); err != nil {
		logger.Error("server exit", "err", err)
		os.Exit(1)
	}
	logger.Info("graceful shutdown complete")
}

func runTicker(ctx context.Context, logger *slog.Logger, mgr *server.Manager, reg *store.Registry) {
	tk := time.NewTicker(5 * time.Second)
	defer tk.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tk.C:
			for _, id := range reg.All() {
				if !mgr.HasPool(id) {
					// 节点尚未连接 / 连接失败 / 已断开。registry 暂时留着，
					// 等用户重连或显式 disconnect。不刷 WARN。
					continue
				}
				snap, err := mgr.BuildSnapshotFor(ctx, id)
				if err != nil {
					logger.Warn("tick snapshot failed", "node", id, "err", err)
					continue
				}
				mgr.Broadcast(map[string]any{
					"type":    "tick",
					"ts":      time.Now().UTC().Format(time.RFC3339),
					"payload": snap,
				})
			}
		}
	}
}

func connectInitial(ctx context.Context, logger *slog.Logger, mgr *server.Manager, dsn string) {
	cfg, err := parseDSN(dsn)
	if err != nil {
		logger.Error("invalid --dsn", "err", err)
		return
	}
	cfg.Name = "initial"
	cfg.ID = "n_initial"
	logger.Info("connecting initial DSN", "host", cfg.Host, "db", cfg.DBName, "user", cfg.User)
	// 通过 HTTP 内部调用：直接调 Manager 暴露的等价方法
	if err := mgr.ConnectDirect(ctx, cfg); err != nil {
		logger.Error("initial connect failed", "err", err)
	}
}

func parseDSN(s string) (model.NodeConfig, error) {
	// 简化：仅支持 postgres://user:pass@host:port/db?sslmode=...
	// 真正生产建议用 pgxpool.ParseConfig。这里足够起步。
	cfg := model.NodeConfig{Port: 5432, SSLMode: "prefer"}
	if !strings.HasPrefix(s, "postgres://") && !strings.HasPrefix(s, "postgresql://") {
		return cfg, fmt.Errorf("dsn must start with postgres:// or postgresql://")
	}
	rest := strings.TrimPrefix(strings.TrimPrefix(s, "postgres://"), "postgresql://")
	if i := strings.Index(rest, "@"); i >= 0 {
		userPass := rest[:i]
		rest = rest[i+1:]
		if j := strings.Index(userPass, ":"); j >= 0 {
			cfg.User = userPass[:j]
			cfg.Password = userPass[j+1:]
		} else {
			cfg.User = userPass
		}
	}
	if i := strings.Index(rest, "/"); i >= 0 {
		hostPort := rest[:i]
		rest = rest[i+1:]
		if j := strings.Index(hostPort, ":"); j >= 0 {
			cfg.Host = hostPort[:j]
			fmt.Sscanf(hostPort[j+1:], "%d", &cfg.Port)
		} else {
			cfg.Host = hostPort
		}
		if j := strings.Index(rest, "?"); j >= 0 {
			cfg.DBName = rest[:j]
			for _, kv := range strings.Split(rest[j+1:], "&") {
				if strings.HasPrefix(kv, "sslmode=") {
					cfg.SSLMode = strings.TrimPrefix(kv, "sslmode=")
				}
			}
		} else {
			cfg.DBName = rest
		}
	}
	return cfg, nil
}

func isLoopback(addr string) bool {
	return strings.HasPrefix(addr, "127.") || strings.HasPrefix(addr, "localhost") || strings.HasPrefix(addr, "[::1]")
}

func signalChan() chan os.Signal {
	ch := make(chan os.Signal, 1)
	signal.Notify(ch, syscall.SIGINT, syscall.SIGTERM)
	return ch
}
