package model

// NodeConfig 表示用户配置的单个 PG 节点。
type NodeConfig struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Role       string `json:"role"` // publisher / subscriber / primary / replica / standalone
	Host       string `json:"host"`
	Port       int    `json:"port"`
	DBName     string `json:"dbname"`
	User       string `json:"user"`
	Password   string `json:"password"`
	SSLMode    string `json:"sslMode"` // disable / require / verify-ca / verify-full
	PGVersion  string `json:"pgVersion,omitempty"`
	ClusterKind string `json:"clusterKind,omitempty"` // logical / physical / hybrid / standalone
}

// SubscriptionSummary 订阅表一行核心摘要。
type SubscriptionSummary struct {
	SubName             string             `json:"subname"`
	SubEnabled          bool               `json:"subenabled"`
	SlotName            string             `json:"slot_name"`
	SlotWalStatus       string             `json:"slot_wal_status"`
	SlotWalRetentionB    int64              `json:"slot_wal_retention_bytes"`
	SegPubToFlush       int64              `json:"seg_pub_to_flush"`
	SegFlushToReceived  int64              `json:"seg_flush_to_received"`
	SegReceivedToApplied int64             `json:"seg_received_to_applied"`
	SegPubToSent        int64              `json:"seg_pub_to_sent"`
	SegSentToFlush      int64              `json:"seg_sent_to_flush"`
	TotalLag            int64              `json:"total_lag"`
	ApplyWorkerPID      *int               `json:"apply_worker_pid"`
	WorkerType          *string            `json:"worker_type"`
	SpillPct            float64            `json:"spill_pct"`
	TotalMbps           float64            `json:"total_mbps"`
	ApplyErrorCount     int64              `json:"apply_error_count"`
	ConflictCounts      map[string]int64   `json:"conflict_counts"`
	LastRecvAgeSeconds  float64            `json:"last_recv_age_seconds"`
	Severity            string            `json:"severity"` // ok / warn / alert / critical
}

// PhysicalReplicaStat replica 表一行。
type PhysicalReplicaStat struct {
	ApplicationName string  `json:"application_name"`
	ClientAddr      string  `json:"client_addr"`
	State           string  `json:"state"`
	SyncState       string  `json:"sync_state"`
	SentLSN         string  `json:"sent_lsn"`
	WriteLSN        string  `json:"write_lsn"`
	FlushLSN        string  `json:"flush_lsn"`
	ReplayLSN       string  `json:"replay_lsn"`
	WriteLagSec     float64 `json:"write_lag_seconds"`
	FlushLagSec     float64 `json:"flush_lag_seconds"`
	ReplayLagSec    float64 `json:"replay_lag_seconds"`
	BackendStartAgo string  `json:"backend_start_ago"`
	ReplyTimeAgo    string  `json:"reply_time_ago"`
	Severity            string  `json:"severity"`
}

// SlotHealth 一条 slot 的体检结果。
type SlotHealth struct {
	SlotName          string `json:"slot_name"`
	Plugin            string `json:"plugin"`
	SlotType          string `json:"slot_type"`
	WalStatus         string `json:"wal_status"`
	Active            bool   `json:"active"`
	HasActivePID      bool   `json:"has_active_pid"`
	RestartLSN        string `json:"restart_lsn"`
	ConfirmedFlushLSN string `json:"confirmed_flush_lsn"`
	RetainedWal       string `json:"retained_wal"`
	UnconsumedWal     string `json:"unconsumed_wal"`
	InactiveSeconds   float64 `json:"inactive_seconds"`
	InvalidationReason *string `json:"invalidation_reason,omitempty"`
	HealthStatus      string `json:"health_status"`
	Severity          string `json:"severity"`
}

// Snapshot 一个 tick 的完整快照（前端用）。
type Snapshot struct {
	TakenAt   string         `json:"taken_at"`
	NodeID    string         `json:"node_id"`
	NodeName  string         `json:"node_name"`
	PGVersion string         `json:"pg_version"`
	Logical   *LogicalPanel  `json:"logical,omitempty"`
	Physical  *PhysicalPanel `json:"physical,omitempty"`
	Slots     []SlotHealth   `json:"slots"`
	Errors    []string       `json:"errors,omitempty"`
}

// LogicalPanel 逻辑复制面板。
type LogicalPanel struct {
	Subscriptions []SubscriptionSummary `json:"subscriptions"`
	Workers       []WorkerStat           `json:"workers"`
	SyncMatrix    []SyncMatrixCell       `json:"sync_matrix"`
	Errors        []ErrorStat            `json:"errors"`
	SpillStats    []SpillStat            `json:"spill_stats"`
	Rates         RateStats              `json:"rates"`
}

// PhysicalPanel 物理复制面板。
type PhysicalPanel struct {
	Replicas []PhysicalReplicaStat `json:"replicas"`
}

// WorkerStat apply / parallel / tablesync worker。
type WorkerStat struct {
	SubName         string  `json:"subname"`
	PID              int     `json:"pid"`
	WorkerType       string  `json:"worker_type"`
	LeaderPID        *int    `json:"leader_pid"`
	RelID            *string `json:"relid"`
	ReceivedLSN      string  `json:"received_lsn"`
	LatestEndLSN     string  `json:"latest_end_lsn"`
	InMemoryLag      string  `json:"in_memory_lag"`
	LastSendAgeSec   float64 `json:"last_send_age_seconds"`
	LastRecvAgeSec   float64 `json:"last_recv_age_seconds"`
	LastApplyAgeSec  float64 `json:"last_apply_age_seconds"`
	Alive            bool    `json:"alive"`
	BackendState     *string `json:"backend_state"`
	WaitEvent        *string `json:"wait_event"`
	Severity         string  `json:"severity"`
}

// SyncMatrixCell 同步状态机矩阵一个单元。
type SyncMatrixCell struct {
	SubName      string `json:"subname"`
	SRSubState   string `json:"srsubstate"`
	StateName    string `json:"state_name"`
	TableCount   int    `json:"table_count"`
	OldestLSN    string `json:"oldest_state_lsn"`
}

// ErrorStat 错误 / 冲突统计。
type ErrorStat struct {
	SubName            string `json:"subname"`
	ApplyErrorCount    int64  `json:"apply_error_count"`
	SyncErrorCount     int64  `json:"sync_error_count"`
	ConflInsertExists  int64  `json:"confl_insert_exists"`
	ConflUpdateExists  int64  `json:"confl_update_exists"`
	ConflUpdateMissing int64  `json:"confl_update_missing"`
	ConflDeleteMissing int64  `json:"confl_delete_missing"`
	ConflMultipleUnique int64 `json:"confl_multiple_unique_conflicts"`
	StatsResetStatus   string `json:"stats_reset_status"`
}

// SpillStat publisher 端 slot 的 spill / stream 状态（差分后）。
type SpillStat struct {
	SlotName        string  `json:"slot_name"`
	SpillBytes      int64   `json:"spill_bytes"`
	SpillCount      int64   `json:"spill_count"`
	SpillTxns       int64   `json:"spill_txns"`
	StreamBytes     int64   `json:"stream_bytes"`
	StreamCount     int64   `json:"stream_count"`
	StreamTxns      int64   `json:"stream_txns"`
	TotalBytes      int64   `json:"total_bytes"`
	TotalTxns       int64   `json:"total_txns"`
	SpillPct        float64 `json:"spill_pct"`
	StreamToSpillRatio float64 `json:"stream_to_spill_ratio"`
	AvgSpillSize    string  `json:"avg_spill_size"`
	WindowSeconds   float64 `json:"window_seconds"`
	StatsAgeSec     float64 `json:"stats_age_seconds"`
}

// RateStats 汇总速率。
type RateStats struct {
	TotalMbps    float64 `json:"total_mbps"`
	TotalTps     float64 `json:"total_tps"`
	SpillMbps    float64 `json:"spill_mbps"`
	StreamMbps   float64 `json:"stream_mbps"`
}

// ConnectResponse /api/v1/connect 返回。
type ConnectResponse struct {
	OK          bool   `json:"ok"`
	NodeID      string `json:"node_id,omitempty"`
	PGVersion   string `json:"pg_version,omitempty"`
	ClusterKind string `json:"cluster_kind,omitempty"`
	Error       string `json:"error,omitempty"`
}
