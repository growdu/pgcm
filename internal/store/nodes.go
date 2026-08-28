package store

import (
	"sync"
	"time"

	"github.com/pgcm/pgcm/internal/model"
)

// Node 一条节点配置 + 状态（不直接持 *pgxpool.Pool，由 Manager 持有）。
type Node struct {
	model.NodeConfig

	mu          sync.RWMutex
	pgVersion   string
	clusterKind string
	connected   bool
	lastError   string
	lastTick    time.Time
}

// SetConnected 更新连接状态。
func (n *Node) SetConnected(ok bool, errMsg string) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.connected = ok
	n.lastError = errMsg
	if ok {
		n.lastTick = time.Now()
	}
}

// Touch 记录本次 tick 时间。
func (n *Node) Touch() {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.lastTick = time.Now()
}

// Snapshot 返回只读状态。
func (n *Node) Snapshot() (connected bool, lastTick time.Time, lastErr string, pgv string, kind string) {
	n.mu.RLock()
	defer n.mu.RUnlock()
	return n.connected, n.lastTick, n.lastError, n.pgVersion, n.clusterKind
}

// SetMeta 设置 PG 版本与集群类型。
func (n *Node) SetMeta(pgv, kind string) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.pgVersion = pgv
	n.clusterKind = kind
}

// Registry 多节点注册表。
type Registry struct {
	mu    sync.RWMutex
	nodes map[string]*Node
}

// NewRegistry 创建 注册表。
func NewRegistry() *Registry {
	return &Registry{nodes: map[string]*Node{}}
}

// Upsert 新增或更新。
func (r *Registry) Upsert(n *Node) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.nodes[n.ID] = n
}

// Get 按 id 取节点。
func (r *Registry) Get(id string) (*Node, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	n, ok := r.nodes[id]
	return n, ok
}

// Remove 移除。
func (r *Registry) Remove(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.nodes, id)
}

// All 返回所有节点 id。
func (r *Registry) All() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]string, 0, len(r.nodes))
	for id := range r.nodes {
		out = append(out, id)
	}
	return out
}
