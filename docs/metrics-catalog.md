# pgcm — 指标目录

> **目的**：UI 上的每个数字 → PG 视图/字段/公式。前后端对齐契约。
> **配套**：[requirements.md](./requirements.md) · [ui-spec.md](./ui-spec.md) · [sql-scripts.md](./sql-scripts.md)
> **版本**：v0.1 — 2026-08-28

## 0. 阅读约定

每条指标格式：

```
| ID | 名称 | 来源 | 单位 | v0.1 可见性 | 备注 |
```

**v0.1 可见性**：

- **主显** — 默认在主面板可见
- **折叠** — 仅订阅/副本行展开后可见
- **隐藏** — v0.1 不渲染（保留数据采集，用于扩展）

指标分三类：

1. **位点类（LSN）**：原始 LSN，需 `pg_wal_lsn_diff(a, b)` 算字节差
2. **delta 类**：源码注释「自上次 pgstat 上报以来」，**必须差分**，不能直接当绝对值
3. **状态类**：状态枚举

所有指标通过 `pgcm-server` 拉取，浏览器不直连 PG。

---

## 1. Publisher 端

### 1.1 `pg_replication_slots`

| ID | 名称 | 来源 | 单位 | v0.1 | 备注 |
| --- | --- | --- | --- | --- | --- |
| M-PUB-01 | `slot_name` | `slot_name` | — | 主显 | |
| M-PUB-02 | `plugin` | `plugin` | — | 折叠 | |
| M-PUB-03 | `slot_type` | `slot_type` | — | 折叠 | `physical / logical` |
| M-PUB-05 | `active` | `active` | — | 折叠 | |
| M-PUB-07 | `restart_lsn` | `restart_lsn` | LSN | 折叠 | |
| M-PUB-08 | `confirmed_flush_lsn` | `confirmed_flush_lsn` | LSN | 折叠 | |
| M-PUB-09 | `wal_status` | `wal_status` | — | 主显 | `lost` → CRITICAL |
| M-PUB-11 | `inactive_since` | `inactive_since` | 秒 | 折叠 | > 600 → WARN |
| M-PUB-12 | `invalidation_reason` | `invalidation_reason` | — | 折叠 | |
| M-PUB-13 | `slot_wal_retention` | **派生** = `pg_wal_lsn_diff(now, restart_lsn)` | 字节 | 主显 | > 50GB → WARN |
| M-PUB-14 | `slot_unconsumed` | **派生** = `pg_wal_lsn_diff(now, confirmed_flush_lsn)` | 字节 | 折叠 | > 5GB → WARN |

### 1.2 `pg_stat_replication`（walsender）

| ID | 名称 | 来源 | 单位 | v0.1 | 备注 |
| --- | --- | --- | --- | --- | --- |
| M-PUB-20 | `application_name` | `application_name` | — | 主显 | 物理表 |
| M-PUB-21 | `client_addr` | `client_addr` | — | 主显 | |
| M-PUB-22 | `state` | `state` | — | 主显 | `startup/catchup/streaming/backup/stopping` |
| M-PUB-23 | `sent_lsn` | `sent_lsn` | LSN | 折叠 | |
| M-PUB-24 | `write_lsn` | `write_lsn` | LSN | 折叠 | |
| M-PUB-25 | `flush_lsn` | `flush_lsn` | LSN | 折叠 | |
| M-PUB-26 | `replay_lsn` | `replay_lsn` | LSN | 折叠 | 逻辑复制恒为 `0/0`，物理有意义 |
| M-PUB-27 | `write_lag` | `write_lag` | 秒 | 主显 | > 5min → CRITICAL |
| M-PUB-28 | `flush_lag` | `flush_lag` | 秒 | 主显 | |
| M-PUB-29 | `replay_lag` | `replay_lag` | 秒 | 主显 | > 5min → CRITICAL |
| M-PUB-30 | `sync_state` | `sync_state` | — | 主显 | `async/potential/sync/quorum` |
| M-PUB-31 | `backend_start` | `backend_start` | — | 主显 | `5 days ago` |
| M-PUB-32 | `reply_time` | `reply_time` | — | 主显 | `5s ago` |
| M-PUB-33 | `seg_pub_to_sent` | **派生** = `pg_wal_lsn_diff(now, sent_lsn)` | 字节 | 主显 | 大 → publisher 写入瓶颈 |
| M-PUB-34 | `seg_sent_to_flush` | **派生** = `pg_wal_lsn_diff(sent_lsn, flush_lsn)` | 字节 | 主显 | 大 → 网络瓶颈 |

### 1.3 `pg_stat_replication_slots`（**delta 类！**）

> **关键陷阱**：以下所有字段是「自上次 pgstat 上报以来」，**必须做 5min 差分**。

| ID | 名称 | 公式 | 单位 | v0.1 |
| --- | --- | --- | --- | --- |
| M-PUB-40 | `spill_txns` | 差分 | txn | 主显 |
| M-PUB-41 | `spill_count` | 差分 | 次 | 主显 |
| M-PUB-42 | `spill_bytes` | 差分 → `pg_size_pretty` | 字节 | 主显 |
| M-PUB-43 | `stream_txns` | 差分 | txn | 主显 |
| M-PUB-44 | `stream_count` | 差分 | 次 | 主显 |
| M-PUB-45 | `stream_bytes` | 差分 | 字节 | 主显 |
| M-PUB-46 | `total_txns` | 差分 | txn | 主显 |
| M-PUB-47 | `total_bytes` | 差分 | 字节 | 主显 |
| M-PUB-49 | `total_mbps` | **派生** = `(Δtotal_bytes/1024²)/window_s` | MB/s | 主显 |
| M-PUB-50 | `total_tps` | **派生** = `Δtotal_txns/window_s` | txn/s | 主显 |
| M-PUB-51 | `spill_mbps` | **派生** |  MB/s | 主显 |
| M-PUB-52 | `stream_mbps` | **派生** |  MB/s | 主显 |
| M-PUB-53 | `spill_pct` | **派生** = `100 * Δspill / Δtotal` | % | 主显 |
| M-PUB-54 | `stream_to_spill_ratio` | **派生** = `Δstream_txns / Δspill_txns` | — | 主显 |
| M-PUB-55 | `avg_spill_size` | **派生** = `spill_bytes / spill_count` | 字节 | 主显 |

---

## 2. Subscriber 端

### 2.1 `pg_subscription`

| ID | 名称 | 来源 | v0.1 |
| --- | --- | --- | --- |
| M-SUB-01 | `subname` | `subname` | 主显 |
| M-SUB-02 | `subenabled` | `subenabled` | 主显 |
| M-SUB-03 | `subslotname` | `subslotname` | 主显 |

### 2.2 `pg_subscription_rel`

| ID | 名称 | 来源 | v0.1 |
| --- | --- | --- | --- |
| M-SUB-10 | `srrelid` | `srrelid::regclass` | 折叠 |
| M-SUB-11 | `srsubstate` | `i/f/d/s/c/r/w` | 折叠 |
| M-SUB-12 | `srsublsn` | `srsublsn` | 折叠 |

### 2.3 `pg_stat_subscription`（worker）

| ID | 名称 | 来源 / 公式 | 单位 | v0.1 |
| --- | --- | --- | --- | --- |
| M-SUB-21 | `worker_type` | `apply / parallel apply / table synchronization` | — | 折叠 |
| M-SUB-22 | `pid` | `pid` | — | 折叠 |
| M-SUB-23 | `leader_pid` | 仅 parallel apply | — | 折叠 |
| M-SUB-24 | `relid` | `relid::regclass` | — | 折叠 |
| M-SUB-25 | `received_lsn` | `received_lsn` | LSN | 折叠 |
| M-SUB-26 | `latest_end_lsn` | `latest_end_lsn` | LSN | 折叠 |
| M-SUB-27 | `last_msg_send_time` | `extract(epoch from (now() - last_msg_send_time))` | 秒 | 折叠 |
| M-SUB-28 | `last_msg_receipt_time` | `extract(epoch from (now() - last_msg_receipt_time))` | 秒 | 主显 | > 5min → WARN；> 30min → CRITICAL |
| M-SUB-29 | `latest_end_time` | `extract(epoch from (now() - latest_end_time))` | 秒 | 折叠 |
| M-SUB-30 | `in_memory_lag` | **派生** = `pg_wal_lsn_diff(received_lsn, latest_end_lsn)` | 字节 | 折叠 |
| M-SUB-31 | `alive` | **派生** = `pg_get_backend_pid(pid) IS NOT NULL` | 布尔 | 折叠 |
| M-SUB-32 | `state` | JOIN `pg_stat_activity.state` | — | 折叠 |
| M-SUB-33 | `wait_event_type` | JOIN | — | 折叠 |
| M-SUB-34 | `wait_event` | JOIN | — | 折叠 |

### 2.4 `pg_stat_subscription_stats`（**delta 类**）

| ID | 名称 | 来源 | v0.1 |
| --- | --- | --- | --- |
| M-SUB-40 | `apply_error_count` | `apply_error_count` | 主显 |
| M-SUB-41 | `sync_error_count` | `sync_error_count` | 折叠 |
| M-SUB-42 | `confl_insert_exists` | `confl_insert_exists` | 主显 |
| M-SUB-43 | `confl_update_origin_differs` | | 折叠 |
| M-SUB-44 | `confl_update_exists` | | 主显 |
| M-SUB-45 | `confl_update_missing` | | 折叠 |
| M-SUB-46 | `confl_delete_origin_differs` | | 折叠 |
| M-SUB-47 | `confl_delete_missing` | | 主显 |
| M-SUB-48 | `confl_multiple_unique_conflicts` | | 主显 |

### 2.5 派生：4 段 lag + total_lag（核心）

| ID | 名称 | 公式 | 单位 | v0.1 |
| --- | --- | --- | --- | --- |
| M-SUB-50 | `seg_pub_to_flush` | `pg_wal_lsn_diff(now, confirmed_flush_lsn)` | 字节 | 主显 |
| M-SUB-51 | `seg_flush_to_received` | `pg_wal_lsn_diff(walsnd.flush_lsn, sub.received_lsn)` | 字节 | 主显 |
| M-SUB-52 | `seg_received_to_applied` | `pg_wal_lsn_diff(received_lsn, latest_end_lsn)` | 字节 | 主显 |
| M-SUB-53 | `total_lag` | `pg_wal_lsn_diff(now, latest_end_lsn)` | 字节 | 主显 | < 100MB 健康 / > 10GB CRITICAL |

---

## 3. 物理复制专属

| ID | 名称 | 来源 | v0.1 |
| --- | --- | --- | --- |
| M-PHY-01 | `sync_priority` | `pg_stat_replication.sync_priority` | 折叠 |
| M-PHY-02 | `usename` | JOIN `pg_authid` | 隐藏 |
| M-PHY-03 | `replay_lsn` (物理) | `pg_stat_replication.replay_lsn` | 折叠 |
| M-PHY-04 | `pg_stat_wal_receiver.*` | replica 节点才有 | 隐藏（v0.2） |

---

## 4. 节点参数

| ID | 名称 | 来源 | v0.1 |
| --- | --- | --- | --- |
| M-NOD-01 | `wal_level` | `SHOW wal_level` | 隐藏（设置 drawer v0.2 显示） |
| M-NOD-02 | `max_replication_slots` | | 隐藏 |
| M-NOD-03 | `max_wal_senders` | | 隐藏 |
| M-NOD-04 | `max_logical_replication_workers` | | 折叠（worker panel 显示） |
| M-NOD-05 | `max_slot_wal_keep_size` | | 隐藏（slot health 阈值用） |

---

## 5. 阈值默认值（来自参考文档 §九）

| metric | warn | alert | critical |
| --- | --- | --- | --- |
| M-SUB-53 `total_lag` | 100MB | 1GB | 10GB |
| M-PUB-13 `slot_wal_retention` | 10GB | 50GB | ≥ M-NOD-05 |
| M-PUB-09 `wal_status` | `extended` | `unreserved` | `lost` |
| M-SUB-40 `apply_error_count` 5min | 5 | 50 | — |
| M-SUB-42..48 任一 conflict | 10 | 100 | — |
| M-PUB-53 `spill_pct` | 20% | 50% | — |
| M-PUB-41 `spill_count` 5min | 100 | 10000 | — |
| M-SUB-28 `last_recv_age` | 5min | 30min | — |
| M-PUB-27 `write_lag` | 30s | 5min | — |
| M-PUB-29 `replay_lag` | 30s | 5min | — |

---

## 6. 关键陷阱（来自参考文档 §十一）

| 误区 | pgcm 如何避免 |
| --- | --- |
| `pg_stat_replication_slots.*` 是 delta 不是累计 | 所有 delta 类必须 5min 差分，**不直接渲染当前值** |
| `pg_stat_replication.replay_lsn` 在逻辑复制下恒为 `0/0` | 逻辑复制面板不渲染此字段 |
| `pg_stat_subscription` 一行 = 一个 worker | Worker 面板已声明 |
| `spill_txns + stream_txns ≠ total_txns` | 只看 `total_txns` 差分，不反推 |
| `apply_error_count > 0` ≠「worker 已停」 | 同时显示 worker `alive` |
