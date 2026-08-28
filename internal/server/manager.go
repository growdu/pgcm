package server

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/pgcm/pgcm/internal/model"
	"github.com/pgcm/pgcm/internal/pg"
	"github.com/pgcm/pgcm/internal/store"
)

// Manager 是 server 的核心协调器：节点注册表、pgxpool、5min 滚动窗口、WS 客户端。
type Manager struct {
	logger *slog.Logger
	reg    *store.Registry
	conns  *pg.Conns

	ringsMu sync.Mutex
	rings   map[string]*store.Ring

	subsMu sync.Mutex
	subs   map[*subscriber]struct{}

	defaultInterval time.Duration
}

type subscriber struct {
	conn *websocket.Conn
	send chan []byte
	done chan struct{}
}

// NewManager 创建 Manager。
func NewManager(logger *slog.Logger, reg *store.Registry, conns *pg.Conns) *Manager {
	return &Manager{
		logger:          logger,
		reg:             reg,
		conns:           conns,
		rings:           map[string]*store.Ring{},
		subs:            map[*subscriber]struct{}{},
		defaultInterval: 5 * time.Second,
	}
}

// HandleConnect POST /api/v1/connect
func (m *Manager) HandleConnect(w http.ResponseWriter, r *http.Request) {
	var cfg model.NodeConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid body: %w", err))
		return
	}
	if cfg.ID == "" {
		cfg.ID = fmt.Sprintf("n_%d", time.Now().UnixNano())
	}
	if cfg.Host == "" || cfg.DBName == "" || cfg.User == "" {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("host / dbname / user required"))
		return
	}
	if cfg.Port == 0 {
		cfg.Port = 5432
	}
	if cfg.SSLMode == "" {
		cfg.SSLMode = "disable"
	}

	node := &store.Node{NodeConfig: cfg}
	m.reg.Upsert(node)

	pgv, kind, err := m.conns.Connect(r.Context(), &cfg)
	if err != nil {
		node.SetConnected(false, err.Error())
		writeJSON(w, http.StatusBadGateway, model.ConnectResponse{OK: false, Error: err.Error()})
		return
	}
	node.SetMeta(pgv, kind)
	node.SetConnected(true, "")

	m.ringsMu.Lock()
	if _, ok := m.rings[cfg.ID]; !ok {
		m.rings[cfg.ID] = store.NewRing(5*time.Minute, 30)
	}
	m.ringsMu.Unlock()

	writeJSON(w, http.StatusOK, model.ConnectResponse{
		OK:          true,
		NodeID:      cfg.ID,
		PGVersion:   pgv,
		ClusterKind: kind,
	})
}

// HandleDisconnect POST /api/v1/disconnect
func (m *Manager) HandleDisconnect(w http.ResponseWriter, r *http.Request) {
	var body struct {
		NodeID string `json:"node_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	m.conns.Close(body.NodeID)
	m.reg.Remove(body.NodeID)
	m.ringsMu.Lock()
	delete(m.rings, body.NodeID)
	m.ringsMu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// HandleSnapshot POST /api/v1/snapshot { node_id? }
func (m *Manager) HandleSnapshot(w http.ResponseWriter, r *http.Request) {
	var body struct {
		NodeID string `json:"node_id"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	var ids []string
	if body.NodeID != "" {
		ids = []string{body.NodeID}
	} else {
		ids = m.reg.All()
	}

	var snaps []model.Snapshot
	for _, id := range ids {
		snap, err := m.buildSnapshot(r.Context(), id)
		if err != nil {
			m.logger.Warn("snapshot build failed", "node", id, "err", err)
			continue
		}
		snaps = append(snaps, snap)
	}
	writeJSON(w, http.StatusOK, snaps)
}

// HandleWS GET /api/v1/ws
func (m *Manager) HandleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
	})
	if err != nil {
		m.logger.Error("ws accept failed", "err", err)
		return
	}
	sub := &subscriber{
		conn: conn,
		send: make(chan []byte, 16),
		done: make(chan struct{}),
	}
	m.subsMu.Lock()
	m.subs[sub] = struct{}{}
	m.subsMu.Unlock()

	go m.writePump(sub)
	m.readPump(sub)
}

// Broadcast 给所有订阅者发消息。
func (m *Manager) Broadcast(payload any) {
	data, err := json.Marshal(payload)
	if err != nil {
		m.logger.Warn("marshal broadcast", "err", err)
		return
	}
	m.subsMu.Lock()
	for sub := range m.subs {
		select {
		case sub.send <- data:
		default:
		}
	}
	m.subsMu.Unlock()
}

// CloseAll 关闭所有 WS（graceful shutdown）。
func (m *Manager) CloseAll() {
	m.subsMu.Lock()
	defer m.subsMu.Unlock()
	for sub := range m.subs {
		close(sub.done)
		_ = sub.conn.Close(websocket.StatusNormalClosure, "server shutdown")
	}
	m.subs = map[*subscriber]struct{}{}
}

func (m *Manager) writePump(s *subscriber) {
	for {
		select {
		case msg, ok := <-s.send:
			if !ok {
				return
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			err := s.conn.Write(ctx, websocket.MessageText, msg)
			cancel()
			if err != nil {
				return
			}
		case <-s.done:
			return
		}
	}
}

func (m *Manager) readPump(s *subscriber) {
	defer func() {
		m.subsMu.Lock()
		delete(m.subs, s)
		m.subsMu.Unlock()
		_ = s.conn.Close(websocket.StatusNormalClosure, "")
	}()
	ctx := context.Background()
	for {
		_, data, err := s.conn.Read(ctx)
		if err != nil {
			return
		}
		var msg map[string]any
		if json.Unmarshal(data, &msg) == nil {
			_ = msg // 当前不处理客户端消息；snapshot 由 ticker 驱动
		}
	}
}

// buildSnapshot 聚合一次完整快照。
func (m *Manager) buildSnapshot(ctx context.Context, nodeID string) (model.Snapshot, error) {
	node, ok := m.reg.Get(nodeID)
	if !ok {
		return model.Snapshot{}, fmt.Errorf("node %s not found", nodeID)
	}
	m.ringsMu.Lock()
	r, ok := m.rings[nodeID]
	m.ringsMu.Unlock()
	if !ok {
		r = store.NewRing(5*time.Minute, 30)
		m.ringsMu.Lock()
		m.rings[nodeID] = r
		m.ringsMu.Unlock()
	}
	return m.conns.BuildSnapshot(ctx, node, r)
}

// BuildSnapshotFor 暴露给 ticker；行为等同 buildSnapshot 但语义独立。
func (m *Manager) BuildSnapshotFor(ctx context.Context, nodeID string) (model.Snapshot, error) {
	return m.buildSnapshot(ctx, nodeID)
}

// ConnectDirect 给启动 --dsn 用；等价 HandleConnect 但不返回 HTTP response。
func (m *Manager) ConnectDirect(ctx context.Context, cfg model.NodeConfig) error {
	if cfg.Host == "" || cfg.DBName == "" || cfg.User == "" {
		return fmt.Errorf("host / dbname / user required")
	}
	if cfg.Port == 0 {
		cfg.Port = 5432
	}
	if cfg.SSLMode == "" {
		cfg.SSLMode = "prefer"
	}
	node := &store.Node{NodeConfig: cfg}
	m.reg.Upsert(node)
	pgv, kind, err := m.conns.Connect(ctx, &cfg)
	if err != nil {
		node.SetConnected(false, err.Error())
		return err
	}
	node.SetMeta(pgv, kind)
	node.SetConnected(true, "")
	m.ringsMu.Lock()
	if _, ok := m.rings[cfg.ID]; !ok {
		m.rings[cfg.ID] = store.NewRing(5*time.Minute, 30)
	}
	m.ringsMu.Unlock()
	return nil
}
