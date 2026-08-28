// Package server 提供 pgcm-server 的 HTTP / WebSocket 端点。
package server

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/pgcm/pgcm/internal/version"
)

// Deps 注入 server 的依赖。
type Deps struct {
	StaticFS embed.FS
	Logger   *slog.Logger
	Manager  *Manager
}

// New 返回配置好的 *chi.Mux。
func New(d Deps) *chi.Mux {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(corsMiddleware)

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{
			"status":  "ok",
			"version": version.Full(),
		})
	})

	r.Route("/api/v1", func(r chi.Router) {
		r.Post("/connect", d.Manager.HandleConnect)
		r.Post("/disconnect", d.Manager.HandleDisconnect)
		r.Post("/snapshot", d.Manager.HandleSnapshot)
		r.Get("/ws", d.Manager.HandleWS)
	})

	staticSubFS, err := fs.Sub(d.StaticFS, "static")
	if err != nil {
		// 没有静态资源（开发期）；回退到简单欢迎页
		r.Get("/*", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			fmt.Fprint(w, welcomeHTML)
		})
		return r
	}
	fileServer := http.FileServer(http.FS(staticSubFS))
	r.Handle("/*", fileServer)

	return r
}

const welcomeHTML = `<!doctype html>
<html lang="zh">
<head><meta charset="utf-8"><title>pgcm</title></head>
<body>
<h1>pgcm</h1>
<p>前端尚未 build。请先在 web/ 下跑 <code>pnpm install &amp;&amp; pnpm build</code>，
   或用 dev 模式：<code>pnpm dev</code>（默认端口 5173，反代到 8080）。</p>
<p>` + version.Full() + `</p>
</body></html>`

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, code int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		_, _ = fmt.Fprintf(w, `{"error":%q}`, err.Error())
	}
}

func writeErr(w http.ResponseWriter, code int, err error) {
	writeJSON(w, code, map[string]string{"error": err.Error()})
}

// Run 启动 HTTP server 直到 ctx 取消。
func Run(ctx context.Context, addr string, handler http.Handler, logger *slog.Logger) error {
	srv := &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}
	errCh := make(chan error, 1)
	go func() {
		logger.Info("http server listening", "addr", addr)
		errCh <- srv.ListenAndServe()
	}()

	select {
	case <-ctx.Done():
		shutCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutCtx)
		return nil
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return fmt.Errorf("http server: %w", err)
	}
}
