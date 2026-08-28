// Package pg 提供 PG wire-protocol 客户端封装。
package pg

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pgcm/pgcm/internal/model"
)

// Conns 管理多节点 pgxpool。
type Conns struct {
	logger *slog.Logger
	mu     sync.Mutex
	pools  map[string]*pgxpool.Pool
}

// NewConns 创建 Conns。
func NewConns(logger *slog.Logger) *Conns {
	return &Conns{
		logger: logger,
		pools:  map[string]*pgxpool.Pool{},
	}
}

// Connect 建池 + 校验 + 自动检测集群类型。
// 返回 (pg_version, cluster_kind)。
func (c *Conns) Connect(ctx context.Context, cfg *model.NodeConfig) (string, string, error) {
	dsn := buildDSN(cfg)
	cfg5, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return "", "", fmt.Errorf("parse dsn: %w", err)
	}
	cfg5.MaxConns = 2
	cfg5.MinConns = 1
	cfg5.MaxConnIdleTime = 5 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, cfg5)
	if err != nil {
		return "", "", fmt.Errorf("connect: %w", err)
	}
	pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return "", "", fmt.Errorf("ping: %w", err)
	}

	var pgv string
	if err := pool.QueryRow(ctx, "SHOW server_version").Scan(&pgv); err != nil {
		pool.Close()
		return "", "", fmt.Errorf("version: %w", err)
	}

	kind, err := detectClusterKind(ctx, pool)
	if err != nil {
		pool.Close()
		return "", "", fmt.Errorf("detect: %w", err)
	}

	c.mu.Lock()
	c.pools[cfg.ID] = pool
	c.mu.Unlock()

	cfg.PGVersion = pgv
	cfg.ClusterKind = kind
	return pgv, kind, nil
}

// Pool 返回指定节点的 pool。
func (c *Conns) Pool(id string) (*pgxpool.Pool, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	p, ok := c.pools[id]
	return p, ok
}

// Close 关闭并移除节点。
func (c *Conns) Close(id string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if p, ok := c.pools[id]; ok {
		p.Close()
		delete(c.pools, id)
	}
}

// CloseAll 关闭所有（graceful shutdown）。
func (c *Conns) CloseAll() {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, p := range c.pools {
		p.Close()
	}
	c.pools = map[string]*pgxpool.Pool{}
}

func buildDSN(cfg *model.NodeConfig) string {
	// 简化版：password 直接明文；前端通过 HTTPS（loopback）传
	return fmt.Sprintf(
		"host=%s port=%d dbname=%s user=%s password=%s sslmode=%s application_name=pgcm connect_timeout=10",
		cfg.Host, cfg.Port, cfg.DBName, cfg.User, cfg.Password, cfg.SSLMode,
	)
}

// detectClusterKind 通过三个 count(*) 判定。
func detectClusterKind(ctx context.Context, pool *pgxpool.Pool) (string, error) {
	var pubs, subs, reps int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM pg_publication").Scan(&pubs); err != nil {
		return "", fmt.Errorf("count pg_publication: %w", err)
	}
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM pg_subscription").Scan(&subs); err != nil {
		return "", fmt.Errorf("count pg_subscription: %w", err)
	}
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM pg_stat_replication").Scan(&reps); err != nil {
		return "", fmt.Errorf("count pg_stat_replication: %w", err)
	}
	switch {
	case pubs > 0 && subs > 0 && reps > 0:
		return "hybrid", nil
	case (pubs > 0 || subs > 0) && reps == 0:
		return "logical", nil
	case pubs == 0 && subs == 0 && reps > 0:
		return "physical", nil
	default:
		return "standalone", nil
	}
}
