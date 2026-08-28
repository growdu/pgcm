package pg

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pgcm/pgcm/internal/model"
)

// querySubscriptions 跑脚本 §1 的子集（单连接：subscriber 视角），返回订阅表主行。
// 注：sub_slot（pg_replication_slots）和 pg_stat_replication_slots 是 publisher 端视图；
// 单连接场景下 subscriber 上的 pg_replication_slots 视图也是空的（PG 设计如此）。
// v0.1 简化：在 subscriber 端跑，slot_* 列允许为空。后续 v0.2 跨 publisher/subscriber。
func querySubscriptions(ctx context.Context, pool *pgxpool.Pool) ([]model.SubscriptionSummary, error) {
	rows, err := pool.Query(ctx, `
		SELECT
			s.subname,
			s.subenabled,
			COALESCE(s.subslotname, '') AS slot_name,
			sub_stats.received_lsn::text,
			sub_stats.latest_end_lsn::text,
			sub_stats.last_msg_receipt_time,
			sub_stats.pid AS apply_worker_pid,
			COALESCE(sub_stats.worker_type, '') AS worker_type,
			COALESCE(ss.apply_error_count, 0) AS apply_error_count,
			COALESCE(ss.confl_insert_exists, 0),
			COALESCE(ss.confl_update_exists, 0),
			COALESCE(ss.confl_update_missing, 0),
			COALESCE(ss.confl_delete_missing, 0),
			COALESCE(ss.confl_update_origin_differs, 0),
			COALESCE(ss.confl_delete_origin_differs, 0),
			COALESCE(ss.confl_multiple_unique_conflicts, 0)
		FROM pg_subscription s
		LEFT JOIN pg_stat_subscription sub_stats
		       ON sub_stats.subid = s.oid AND sub_stats.relid IS NULL
		LEFT JOIN pg_stat_subscription_stats ss ON ss.subid = s.oid
		ORDER BY s.subname
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []model.SubscriptionSummary
	for rows.Next() {
		var s model.SubscriptionSummary
		var receivedLSN, latestEndLSN *string
		var lastRecv *time.Time
		var workerType string
		if err := rows.Scan(
			&s.SubName, &s.SubEnabled, &s.SlotName,
			&receivedLSN, &latestEndLSN, &lastRecv,
			&s.ApplyWorkerPID, &workerType,
			&s.ApplyErrorCount,
			&s.ConflictCounts["confl_insert_exists"],
			&s.ConflictCounts["confl_update_exists"],
			&s.ConflictCounts["confl_update_missing"],
			&s.ConflictCounts["confl_delete_missing"],
			&s.ConflictCounts["confl_update_origin_differs"],
			&s.ConflictCounts["confl_delete_origin_differs"],
			&s.ConflictCounts["confl_multiple_unique_conflicts"],
		); err != nil {
			return nil, err
		}
		if lastRecv != nil {
			s.LastRecvAgeSeconds = time.Since(*lastRecv).Seconds()
		}
		if receivedLSN != nil && latestEndLSN != nil {
			// 简化：不展开 4 段 lag（需要 publisher 端视图），仅给 received→applied 这一段
			seg, _ := lsnDiff(*receivedLSN, *latestEndLSN, pool, ctx)
			s.SegReceivedToApplied = seg
		}
		s.ConflictCounts = ensureKeys(s.ConflictCounts)
		s.Severity = severityOf(s)
		out = append(out, s)
	}
	return out, rows.Err()
}

// queryReplicationSlotCounters 当前 PG 视角的 pg_stat_replication_slots。
// 注意：subscriber 端该视图为空；只有 publisher 端才有数据。
// v0.1：如果连接到的是 subscriber 节点，这里会自然为空 → spill stats 全 0。
func queryReplicationSlotCounters(ctx context.Context, pool *pgxpool.Pool) (map[string]map[string]int64, error) {
	rows, err := pool.Query(ctx, `
		SELECT slot_name,
		       spill_txns, spill_count, spill_bytes,
		       stream_txns, stream_count, stream_bytes,
		       total_txns, total_bytes
		FROM pg_stat_replication_slots
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := map[string]map[string]int64{}
	for rows.Next() {
		var name string
		var m map[string]int64
		m = map[string]int64{}
		if err := rows.Scan(
			&name,
			&m["spill_txns"], &m["spill_count"], &m["spill_bytes"],
			&m["stream_txns"], &m["stream_count"], &m["stream_bytes"],
			&m["total_txns"], &m["total_bytes"],
		); err != nil {
			return nil, err
		}
		out[name] = m
	}
	return out, rows.Err()
}

func queryWorkers(ctx context.Context, pool *pgxpool.Pool) ([]model.WorkerStat, error) {
	rows, err := pool.Query(ctx, `
		SELECT s.subname, ps.pid, ps.worker_type, ps.leader_pid,
		       ps.relid::regclass::text, ps.received_lsn::text, ps.latest_end_lsn::text,
		       ps.last_msg_send_time, ps.last_msg_receipt_time, ps.latest_end_time,
		       pg_get_backend_pid(ps.pid) IS NOT NULL AS alive
		FROM pg_subscription s
		JOIN pg_stat_subscription ps ON ps.subid = s.oid
		ORDER BY s.subname,
		         CASE ps.worker_type
		              WHEN 'apply' THEN 1
		              WHEN 'parallel apply' THEN 2
		              WHEN 'table synchronization' THEN 3
		              ELSE 4 END
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []model.WorkerStat
	for rows.Next() {
		var w model.WorkerStat
		var relid *string
		var leaderPID *int
		var recvLSN, endLSN *string
		var sendTime, recvTime, endTime *time.Time
		if err := rows.Scan(
			&w.SubName, &w.PID, &w.WorkerType, &leaderPID,
			&relid, &recvLSN, &endLSN,
			&sendTime, &recvTime, &endTime,
			&w.Alive,
		); err != nil {
			return nil, err
		}
		if relid != nil {
			r := *relid
			w.RelID = &r
		}
		if leaderPID != nil {
			v := *leaderPID
			w.LeaderPID = &v
		}
		if recvLSN != nil {
			w.ReceivedLSN = *recvLSN
		}
		if endLSN != nil {
			w.LatestEndLSN = *endLSN
		}
		if sendTime != nil {
			w.LastSendAgeSec = time.Since(*sendTime).Seconds()
		}
		if recvTime != nil {
			w.LastRecvAgeSec = time.Since(*recvTime).Seconds()
		}
		if endTime != nil {
			w.LastApplyAgeSec = time.Since(*endTime).Seconds()
		}
		if recvLSN != nil && endLSN != nil {
			w.InMemoryLag = "n/a"
		}
		// 高亮
		switch {
		case !w.Alive:
			w.Severity = "critical"
		case w.LastRecvAgeSec > 1800:
			w.Severity = "critical"
		case w.LastRecvAgeSec > 300:
			w.Severity = "warn"
		default:
			w.Severity = "ok"
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

func queryReplicas(ctx context.Context, pool *pgxpool.Pool) ([]model.PhysicalReplicaStat, error) {
	rows, err := pool.Query(ctx, `
		SELECT application_name, COALESCE(host(client_addr), ''), COALESCE(client_port, 0),
		       state, sync_state,
		       sent_lsn::text, write_lsn::text, flush_lsn::text, replay_lsn::text,
		       extract(epoch from write_lag)::float8,
		       extract(epoch from flush_lag)::float8,
		       extract(epoch from replay_lag)::float8,
		       backend_start, reply_time
		FROM pg_stat_replication
		ORDER BY application_name
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []model.PhysicalReplicaStat
	for rows.Next() {
		var r model.PhysicalReplicaStat
		var backendStart, replyTime time.Time
		if err := rows.Scan(
			&r.ApplicationName, &r.ClientAddr, new(int),
			&r.State, &r.SyncState,
			&r.SentLSN, &r.WriteLSN, &r.FlushLSN, &r.ReplayLSN,
			&r.WriteLagSec, &r.FlushLagSec, &r.ReplayLagSec,
			&backendStart, &replyTime,
		); err != nil {
			return nil, err
		}
		r.BackendStartAgo = humanDuration(time.Since(backendStart))
		r.ReplyTimeAgo = humanDuration(time.Since(replyTime))
		switch {
		case r.ReplayLagSec > 300:
			r.Severity = "critical"
		case r.WriteLagSec > 300:
			r.Severity = "warn"
		default:
			r.Severity = "ok"
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func querySlotHealth(ctx context.Context, pool *pgxpool.Pool) ([]model.SlotHealth, error) {
	rows, err := pool.Query(ctx, `
		SELECT slot_name, plugin, slot_type,
		       active, active_pid IS NOT NULL,
		       restart_lsn::text, confirmed_flush_lsn::text,
		       pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn),
		       pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn),
		       extract(epoch from (now() - inactive_since))::float8,
		       wal_status, invalidation_reason
		FROM pg_replication_slots
		ORDER BY slot_name
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []model.SlotHealth
	for rows.Next() {
		var s model.SlotHealth
		var retained, unconsumed int64
		var inactiveSec *float64
		var invalidReason *string
		if err := rows.Scan(
			&s.SlotName, &s.Plugin, &s.SlotType,
			&s.Active, &s.HasActivePID,
			&s.RestartLSN, &s.ConfirmedFlushLSN,
			&retained, &unconsumed,
			&inactiveSec,
			&s.WalStatus, &invalidReason,
		); err != nil {
			return nil, err
		}
		s.RetainedWal = formatBytes(retained)
		s.UnconsumedWal = formatBytes(unconsumed)
		if inactiveSec != nil {
			s.InactiveSeconds = *inactiveSec
		}
		if invalidReason != nil {
			s.InvalidationReason = invalidReason
		}
		s.HealthStatus = "OK"
		s.Severity = "ok"
		switch {
		case s.WalStatus == "lost":
			s.HealthStatus = "CRITICAL: WAL recycled, slot unusable"
			s.Severity = "critical"
		case !s.Active && s.InactiveSeconds > 600:
			s.HealthStatus = "WARN: inactive > 10 min"
			s.Severity = "warn"
		case unconsumed > 5*1024*1024*1024:
			s.HealthStatus = "WARN: unconsumed > 5 GB"
			s.Severity = "warn"
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// lsnDiff 计算两个 LSN 的字节差。subscriber 端可用（pg_wal_lsn_diff 是 PG 函数）。
func lsnDiff(a, b string, pool *pgxpool.Pool, ctx context.Context) (int64, error) {
	var d int64
	err := pool.QueryRow(ctx, "SELECT pg_wal_lsn_diff($1::pg_lsn, $2::pg_lsn)", a, b).Scan(&d)
	return d, err
}

// severityOf 根据 sub 行判定严重度（参考文档 §九）。
func severityOf(s model.SubscriptionSummary) string {
	bad := "ok"
	thresholds := []struct {
		critical int64
		warn     int64
		value    int64
	}{
		{10 * 1024 * 1024 * 1024, 1024 * 1024 * 1024, s.TotalLag},
	}
	for _, t := range thresholds {
		if t.value >= t.critical {
			return "critical"
		}
		if t.value >= t.warn {
			bad = "warn"
		}
	}
	if s.ApplyErrorCount >= 50 {
		return "critical"
	}
	if s.ApplyErrorCount >= 5 {
		bad = "warn"
	}
	for _, c := range s.ConflictCounts {
		if c >= 100 {
			return "critical"
		}
		if c >= 10 {
			bad = "warn"
		}
	}
	if s.LastRecvAgeSeconds > 1800 {
		return "critical"
	}
	if s.LastRecvAgeSeconds > 300 {
		bad = "warn"
	}
	return bad
}

func ensureKeys(m map[string]int64) map[string]int64 {
	if m == nil {
		m = map[string]int64{}
	}
	for _, k := range []string{
		"confl_insert_exists", "confl_update_origin_differs",
		"confl_update_exists", "confl_update_missing",
		"confl_delete_origin_differs", "confl_delete_missing",
		"confl_multiple_unique_conflicts",
	} {
		if _, ok := m[k]; !ok {
			m[k] = 0
		}
	}
	return m
}

func humanDuration(d time.Duration) string {
	if d < time.Minute {
		return fmt.Sprintf("%ds", int(d.Seconds()))
	}
	if d < time.Hour {
		return fmt.Sprintf("%dm %ds", int(d.Minutes()), int(d.Seconds())%60)
	}
	if d < 24*time.Hour {
		return fmt.Sprintf("%dh %dm", int(d.Hours()), int(d.Minutes())%60)
	}
	return fmt.Sprintf("%dd %dh", int(d.Hours())/24, int(d.Hours())%24)
}

// 触发 imports（避免编译错误）
var _ = pgx.ErrNoRows
