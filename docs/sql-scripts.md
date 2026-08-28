# pgcm — 端到端 SQL 脚本

> **来源**：参考文档 §六（8 个脚本）+ 物理复制补充 SQL。
> **配套**：[requirements.md](./requirements.md) · [ui-spec.md](./ui-spec.md) · [metrics-catalog.md](./metrics-catalog.md)
> **版本**：v0.1 — 2026-08-28

## 0. 前置

- **pgcm-server 端**执行（不在浏览器）。SQL 通过 `/api/v1/snapshot` 等端点触发，pgx / tokio-postgres 驱动跑 PG wire protocol。
- **视图权限**：要求 `pg_read_all_stats` + `SELECT ON pg_authid, pg_database`。建议给 pgcm 专用 role：

  ```sql
  CREATE ROLE pgcm_monitor LOGIN PASSWORD '...' INHERIT;
  GRANT pg_read_all_stats TO pgcm_monitor;
  GRANT SELECT ON pg_authid, pg_database TO pgcm_monitor;
  ```

- **5min 差分**：v0.1 不建 `lr_rate_history` 表。pgcm-server 内存保留每个 slot 最近 5 分钟（30s 一档，10 bucket），差分在服务端算。

- **跨节点拼接**：脚本 ①/③ 需要 publisher + subscriber 端视图。pgcm-server 按节点分发连接，按 `subslotname` / `application_name` 拼装。

---

## 1. 脚本 ① 全链路状态一屏

**对应 UI**：Summary-Strip + Subscription-Table + Lag-Stack-Bar + Rate-Cards。

**调用**：`POST /api/v1/snapshot { nodeId? }`

```sql
SELECT
    s.subname, s.subenabled, sub_slot.slot_name,
    pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), sub_slot.restart_lsn))        AS slot_wal_retention,
    pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), sub_slot.confirmed_flush_lsn)) AS pub_to_flush_lag,
    pg_size_pretty(pg_wal_lsn_diff(sub_slot.confirmed_flush_lsn, sub_stats.received_lsn))  AS flush_to_received_lag,
    pg_size_pretty(pg_wal_lsn_diff(sub_stats.received_lsn, sub_stats.latest_end_lsn))     AS received_to_applied_lag,
    pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), sub_stats.latest_end_lsn))      AS total_lag,
    sub_stats.pid AS apply_worker_pid, sub_stats.worker_type,
    rs.spill_txns, rs.spill_count, rs.spill_bytes,
    rs.stream_txns, rs.stream_count, rs.stream_bytes,
    ss.apply_error_count, ss.sync_error_count,
    ss.confl_insert_exists, ss.confl_update_exists,
    ss.confl_delete_missing, ss.confl_multiple_unique_conflicts
FROM pg_subscription s
LEFT JOIN pg_replication_slots sub_slot ON sub_slot.slot_name = s.subslotname
LEFT JOIN pg_stat_subscription sub_stats
       ON sub_stats.subid = s.oid AND sub_stats.relid IS NULL
LEFT JOIN pg_stat_replication_slots rs ON rs.slot_name = s.subslotname
LEFT JOIN pg_stat_subscription_stats ss ON ss.subid = s.oid
ORDER BY s.subname;
```

## 2. 脚本 ② 5 分钟窗口吞吐（v0.1 内存差分）

**对应 UI**：Rate-Cards / Spill-Cards。

**调用**：`GET /api/v1/spill-stats { window?: 5m }`

**当前 snapshot SQL**（publisher）：

```sql
SELECT slot_name, spill_txns, spill_count, spill_bytes,
       stream_txns, stream_count, stream_bytes,
       total_txns, total_bytes, stats_reset
FROM pg_stat_replication_slots
ORDER BY slot_name;
```

**差分在 pgcm-server 内存算**：

```
delta_total_bytes = curr.total_bytes - prev.total_bytes
window_seconds    = curr.ts - prev.ts
total_mbps        = (delta_total_bytes / 1024²) / window_seconds
total_tps         = delta_total_txns / window_seconds
spill_pct         = 100 * delta_spill_bytes / delta_total_bytes
stream_to_spill_ratio = delta_stream_txns / NULLIF(delta_spill_txns, 0)
```

## 3. 脚本 ③ 端到端 lag 4 段拼接

**对应 UI**：Lag-Stack-Bar。

**调用**：`GET /api/v1/lag-segments { subName? }`

**SQL**（pgcm-server 跨 publisher + subscriber 双连接；约定 walsender `application_name = subname`）：

```sql
SELECT
    s.subname, sub_slot.slot_name,
    pg_current_wal_lsn()                                                       AS pub_current,
    sub_stats.latest_end_lsn                                                   AS sub_latest_end,
    pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), walsnd.sent_lsn))    AS seg_pub_to_sent,
    pg_size_pretty(pg_wal_lsn_diff(walsnd.sent_lsn, walsnd.flush_lsn))        AS seg_sent_to_flush,
    pg_size_pretty(pg_wal_lsn_diff(walsnd.flush_lsn, sub_stats.received_lsn)) AS seg_flush_to_received,
    pg_size_pretty(pg_wal_lsn_diff(sub_stats.received_lsn, sub_stats.latest_end_lsn)) AS seg_received_to_applied,
    pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), sub_stats.latest_end_lsn)) AS seg_total
FROM pg_subscription s
LEFT JOIN pg_replication_slots sub_slot ON sub_slot.slot_name = s.subslotname
LEFT JOIN pg_stat_subscription sub_stats
       ON sub_stats.subid = s.oid AND sub_stats.relid IS NULL
LEFT JOIN pg_stat_replication walsnd ON walsnd.application_name = s.subname
ORDER BY s.subname;
```

## 4. 脚本 ④ 同步状态机

**对应 UI**：订阅行折叠 → Sync-Matrix。

**调用**：`GET /api/v1/sync-matrix { subName? }`

```sql
SELECT
    s.subname, r.srsubstate,
    CASE r.srsubstate
        WHEN 'i' THEN 'INIT' WHEN 'f' THEN 'FINISHEDCOPY'
        WHEN 'd' THEN 'DATASYNC' WHEN 'c' THEN 'CATCHUP'
        WHEN 's' THEN 'SYNCDONE' WHEN 'r' THEN 'READY'
        WHEN 'w' THEN 'SYNCWAIT' ELSE 'UNKNOWN'
    END AS state_name,
    count(*) AS table_count,
    min(r.srsublsn) AS oldest_state_lsn
FROM pg_subscription s
JOIN pg_subscription_rel r ON r.srsubid = s.oid
GROUP BY s.subname, r.srsubstate
ORDER BY s.subname, r.srsubstate;
```

## 5. 脚本 ⑤ worker 水位

**对应 UI**：订阅行折叠 → Worker-Table。

**调用**：`GET /api/v1/workers { subName? }`

```sql
SELECT
    s.subname, ps.pid, ps.worker_type, ps.leader_pid, ps.relid::regclass AS relid,
    ps.received_lsn, ps.latest_end_lsn,
    pg_size_pretty(pg_wal_lsn_diff(ps.received_lsn, ps.latest_end_lsn)) AS in_memory_lag,
    extract(epoch from (now() - ps.last_msg_send_time))     AS last_send_age,
    extract(epoch from (now() - ps.last_msg_receipt_time))  AS last_recv_age,
    extract(epoch from (now() - ps.latest_end_time))        AS last_apply_age,
    pg_get_backend_pid(ps.pid) IS NOT NULL                  AS alive,
    (SELECT state FROM pg_stat_activity WHERE pid = ps.pid) AS backend_state,
    (SELECT wait_event FROM pg_stat_activity WHERE pid = ps.pid) AS wait_event
FROM pg_subscription s
JOIN pg_stat_subscription ps ON ps.subid = s.oid
ORDER BY s.subname,
         CASE ps.worker_type WHEN 'apply' THEN 1 WHEN 'parallel apply' THEN 2 WHEN 'table synchronization' THEN 3 ELSE 4 END;
```

## 6. 脚本 ⑥ 错误 + 冲突

**对应 UI**：订阅行折叠 → Error-Grid。

**调用**：`GET /api/v1/errors { subName? }`

```sql
SELECT
    s.subname, ss.apply_error_count, ss.sync_error_count,
    ss.confl_insert_exists, ss.confl_update_origin_differs, ss.confl_update_exists,
    ss.confl_update_missing, ss.confl_delete_origin_differs, ss.confl_delete_missing,
    ss.confl_multiple_unique_conflicts,
    CASE WHEN now() - ss.stats_reset > interval '30 days' THEN 'STALE_RESET' ELSE 'OK' END AS stats_reset_status
FROM pg_subscription s
JOIN pg_stat_subscription_stats ss ON ss.subid = s.oid
ORDER BY (ss.apply_error_count + ss.sync_error_count) DESC;
```

## 7. 脚本 ⑦ spill / stream

**对应 UI**：订阅行折叠 → Spill-Cards（也用于 Rate-Cards）。

**调用**：`GET /api/v1/spill-stats { window?: 5m }`

注：`spill_pct / avg_spill_size` 在 v0.1 一律用 5min 差分算（脚本 §2），不再直接用当前值。

## 8. 脚本 ⑧ slot 健康体检

**对应 UI**：订阅行折叠 → Slot-List。

**调用**：`GET /api/v1/slots/health`

```sql
WITH slot_meta AS (
    SELECT
        r.slot_name, r.plugin, r.slot_type,
        r.active, r.active_pid IS NOT NULL AS has_active_pid,
        r.restart_lsn, r.confirmed_flush_lsn, r.wal_status,
        r.inactive_since, r.invalidation_reason,
        pg_wal_lsn_diff(pg_current_wal_lsn(), r.restart_lsn)        AS bytes_since_restart,
        pg_wal_lsn_diff(pg_current_wal_lsn(), r.confirmed_flush_lsn) AS bytes_since_confirmed,
        extract(epoch from (now() - r.inactive_since))               AS inactive_seconds
    FROM pg_replication_slots r
    WHERE r.datoid IS NOT NULL
)
SELECT
    slot_name, plugin, slot_type, wal_status, active, has_active_pid,
    pg_size_pretty(bytes_since_restart)    AS retained_wal,
    pg_size_pretty(bytes_since_confirmed)  AS unconsumed_wal,
    CASE
        WHEN wal_status = 'lost'              THEN 'CRITICAL: WAL recycled, slot unusable'
        WHEN NOT active AND inactive_seconds > 600 THEN 'WARN: inactive > 10 min'
        WHEN bytes_since_confirmed > 5*1024*1024*1024::bigint THEN 'WARN: unconsumed > 5 GB'
        WHEN NOT has_active_pid AND active    THEN 'WARN: marked active but no PID'
        ELSE 'OK'
    END AS health_status,
    invalidation_reason
FROM slot_meta
ORDER BY bytes_since_confirmed DESC;
```

## 9. 物理复制 SQL

### 9.1 replica 全字段表

**对应 UI**：Replica-Table。

**调用**：`GET /api/v1/physical/replicas`

```sql
SELECT pid, application_name, client_addr, client_port, backend_start,
       state, sync_state, sync_priority,
       sent_lsn, write_lsn, flush_lsn, replay_lsn,
       write_lag, flush_lag, replay_lag, reply_time
FROM pg_stat_replication
ORDER BY application_name;
```

### 9.2 物理 slot 健康

```sql
SELECT slot_name, plugin, slot_type, active, wal_status,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained_wal,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn)) AS unconsumed_wal
FROM pg_replication_slots
WHERE slot_type = 'physical'
ORDER BY unconsumed_wal DESC;
```

## 10. 自动检测

**调用**：连接成功后随 `POST /api/v1/connect` 自动跑。

```sql
SELECT 'pubs', count(*) FROM pg_publication
UNION ALL SELECT 'subs', count(*) FROM pg_subscription
UNION ALL SELECT 'reps', count(*) FROM pg_stat_replication;
```

→ 据此决定显示哪些区块。

---

## 11. pgcm-server API 契约（最小集）

REST：

```
POST /api/v1/connect        Body: { nodeId, dsn, role }
                            → { ok, pgVersion, clusterKind }
POST /api/v1/disconnect     Body: { nodeId }
                            → { ok }
POST /api/v1/snapshot       Body: { nodeId? }    → Snapshot
GET  /api/v1/lag-segments   { subName? }
GET  /api/v1/sync-matrix    { subName? }
GET  /api/v1/workers        { subName? }
GET  /api/v1/errors         { subName? }
GET  /api/v1/spill-stats    { window?: "5m" }
GET  /api/v1/slots/health
GET  /api/v1/physical/replicas
```

WebSocket：

```
ws://<host>/ws
  C → S: { type: "subscribe", topics: ["snapshot"] }
         { type: "set_interval", ms: 5000 }
  S → C: { type: "tick", ts, payload: Snapshot }
         { type: "error", code, message }
         { type: "node_status", nodeId, status }
```

---

## 12. v0.1 不做

- ❌ `lr_rate_history` 持久化表 → v0.1 内存
- ❌ `pg_stat_wal_receiver` 拉取 → v0.2
- ❌ 节点参数 `SHOW` 一键拉取 → v0.2（设置 drawer 展示）
- ❌ prometheus_exporter 兼容 → v0.2
- ❌ 告警通道 webhook → v0.2
