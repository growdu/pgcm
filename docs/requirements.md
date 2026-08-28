# pgcm — 需求文档

> **目标**：浏览器打开 → 填 DSN → 一页看全 PG 复制状态。**没有登录、没有多租户、没有独立后端**。
> **形态**：`pgcm-server` 单二进制（内嵌静态前端 + PG wire-protocol 透明代理）。
> **支持**：逻辑复制 + 物理复制（同一集群并存时同时显示，二者都没有则提示 standalone）。
> **版本**：v0.1 — 2026-08-28

## 0. 架构

浏览器沙箱禁止 raw socket，无法直连 PG 5432（PG wire protocol）。需要一个**透明代理**把 HTTP/WS 翻译成 PG wire protocol。这不是「应用后端」——`pgcm-server` 只是协议桥，Go 大约 200 行。

```
Browser SPA ──── HTTP/WS ────▶ pgcm-server (单二进制) ──── TCP 5432 ────▶ PostgreSQL
              ◀─── JSON  ─────   (静态资源 + /api + /ws + pgx)        ◀──────────
```

### 0.1 部署

```bash
pgcm --listen 127.0.0.1:8080                    # UI 里填 DSN
pgcm --listen 127.0.0.1:8080 --dsn "postgres://..."   # 启动时定
docker run -p 8080:8080 pgcm/pgcm
```

### 0.2 安全

- **默认仅 `127.0.0.1`**。
- bind `0.0.0.0` = 无鉴权 = **任何人能读你整个 PG**。需要 LAN/远程访问请放 SSH tunnel / nginx basic auth / Cloudflare Tunnel 后面。
- 浏览器**不存密码到 localStorage**（v0.2 可加「记住 DSN」开关）。

---

## 1. 用户与场景

### 1.1 角色

操作者本人。无登录、无授权、DSN = 身份。

### 1.2 核心场景（来自参考文档 §十二）

| 场景 | UI 必须能答 |
| --- | --- |
| A：lag 突然 5GB | 哪一段最大（pub→sent / sent→flush / flush→received / received→applied） |
| B：表卡在 `srsubstate='i'` | 是哪个 sub 的哪张表；tablesync worker 是否在跑；是否触顶 `max_logical_replication_workers` |
| C：`confl_insert_exists` 涨 1000+ | 是哪个 sub 的哪类冲突；当前 `apply_error_count / sync_error_count` |
| D：物理 replica 落后 5GB | `write_lag / flush_lag / replay_lag` 实时可见 |
| E：slot 健康 | 每条 slot OK / WARN / CRITICAL |

---

## 2. 功能

### 2.1 必须做（v0.1）

| 编号 | 功能 |
| --- | --- |
| F-1 | UI 填 DSN，连上 PG |
| F-2 | 自动检测逻辑 / 物理 / 混合 / standalone |
| F-3 | 一页显示逻辑复制（4 段 lag、spill/stream、worker、错误冲突、slot 健康） |
| F-4 | 一页显示物理复制（4 LSN + 3 lag） |
| F-5 | 5 秒自动刷新（可调 1/2/5/10/30s） |
| F-6 | 阈值可视化（warn / alert / critical）+ 越界染色 |
| F-7 | 中 / 英 i18n |
| F-8 | 暗 / 亮主题 |
| F-9 | 一键导出当前快照 JSON |

### 2.2 不做（v0.1）

- ❌ 登录 / 鉴权 / 多租户 / RBAC
- ❌ 多 DSN（v0.2：可同时配多个节点做 cluster merge；v0.1 = 单 DSN）
- ❌ 长期历史趋势（v0.1 仅内存滚动 5 分钟）
- ❌ 告警通道（webhook / email / Slack）—— 仅 UI 染色
- ❌ 审计日志
- ❌ Helm / k8s

### 2.3 扩展性钩子（v0.2+ 占位，结构上预留，不实现）

- 「记住 DSN」开关（localStorage 加密）
- 多 DSN 同时监控（`Nodes: NodeConfig[]`，type 已含）
- IndexedDB 历史（接口 `ts` 字段已含）
- Token auth（`pgcm-server` 启动参数 `--token`）
- prometheus_exporter 兼容输出
- Webhook 告警（`AlertChannel` type 已预留）

---

## 3. 功能需求

### FR-1 DSN 输入

**字段**：`host` `port`（默认 5432）`dbname` `user` `password` `sslmode`（disable / require / verify-ca / verify-full）。

**按钮**：`[测试连接]`（调 `/api/v1/connect` → 返回 `{ ok, version, clusterKind }`）、`[连接并进入]`。

**多节点（v0.1 简化为同一集群下多 publisher/subscriber 节点）**：

- 节点下拉默认 `Single`，可加多个 publisher / subscriber / replica / standalone。
- 顶部下拉切换查看哪个节点（merged view 默认）。
- 节点配置存 localStorage，密码字段除外。

### FR-2 自动检测

连接后一次 `count(*)` 查询：

```sql
SELECT 'pubs', count(*) FROM pg_publication
UNION ALL SELECT 'subs', count(*) FROM pg_subscription
UNION ALL SELECT 'reps', count(*) FROM pg_stat_replication;
```

按结果展示对应区块；都没有 → 「此节点无任何复制角色」。

### FR-3 逻辑复制区块

**默认显示**：

- **4 段 Lag 可视化**（pub→sent→flush→received→applied，堆叠条，对数映射，颜色按阈值染色）
- **速率卡** ×4（total MB/s、total TPS、stream MB/s、spill MB/s；最近 5min 差分）
- **Spill/Stream 卡** ×4（spill_pct、stream_to_spill_ratio、avg_spill_size、stats_age）
- **订阅表**：subname / subenabled / slot_name / slot_wal_status / slot_wal_retention / 4 段 lag / apply worker pid / spill% / total_mbps / apply_error_count / 7 类 conflict / last_recv_age / severity

**折叠展开（点击订阅行）**：

- Worker 表（apply / parallel apply / table synchronization 三类）
- 同步状态机矩阵（`i/f/d/s/c/r/w` × 表数量）
- 错误冲突 9 卡（apply_error + sync_error + 7 类 conflict）
- Slot 健康列表（按参考文档 §八 触发规则）

### FR-4 物理复制区块

**默认显示**：

- Replica 表：application_name / client_addr / state / sync_state / sent_lsn / write_lsn / flush_lsn / replay_lsn / write_lag / flush_lag / replay_lag / backend_start / reply_time

**折叠展开（点击 replica 行）**：

- Lag 趋势图（write_lag / flush_lag / replay_lag 三条线，5 分钟滚动窗口）

### FR-5 阈值配置（设置抽屉）

10 个 metric × 3 档（warn / alert / critical），来自参考文档 §九：

| metric | warn | alert | critical |
| --- | --- | --- | --- |
| `total_lag` | 100 MB | 1 GB | 10 GB |
| `slot_wal_retention` | 10 GB | 50 GB | ≥ `max_slot_wal_keep_size` |
| `wal_status` | `extended` | `unreserved` | `lost` |
| `apply_error_count` 5min | 5 | 50 | — |
| `confl_*` 5min 任一 | 10 | 100 | — |
| `spill_pct` | 20% | 50% | — |
| `spill_count` 5min | 100 | 10000 | — |
| `last_recv_age` | 5 min | 30 min | — |
| `write_lag` (物理) | 30 s | 5 min | — |
| `replay_lag` (物理) | 30 s | 5 min | — |

存 localStorage；越界 → 数字染色 + 顶部状态点变红。

### FR-6 i18n + 主题

- 中 / En 切换；亮 / 暗切换。
- 文案按 key 抽取（实现细节）。

### FR-7 导出

`[导出 JSON]` 按钮 → 当前快照（`{ takenAt, node, logical, physical, slots, workers, errors, thresholds }`）下载。

---

## 4. 非功能需求

| 编号 | 指标 |
| --- | --- |
| NFR-1 | 默认 5s 刷新（可调 1~30s） |
| NFR-2 | 单页首屏 ≤ 1.5s（桌面 1280px） |
| NFR-3 | 100 订阅场景下浏览器内存 ≤ 100 MB |
| NFR-4 | `pgcm-server` 静态二进制 ≤ 20 MB |
| NFR-5 | 支持 PG 14 / 15 / 16 / 17 / 18 |
| NFR-6 | 浏览器不直连 PG；密码仅内存 + HTTPS POST |

---

## 5. 数据模型（接口契约）

无持久化（v0.1）。前端 localStorage + 内存，结构上预留扩展：

```ts
type ClusterKind = 'logical' | 'physical' | 'hybrid' | 'standalone';
type Severity = 'ok' | 'warn' | 'alert' | 'critical';

interface NodeConfig {
  id: string;            // UUID
  name: string;
  role: 'publisher' | 'subscriber' | 'primary' | 'replica' | 'standalone';
  host: string;
  port: number;
  dbname: string;
  user: string;
  password: string;      // 仅内存；不落 localStorage
  sslMode: 'disable' | 'require' | 'verify-ca' | 'verify-full';
  pgVersion?: string;
  clusterKind?: ClusterKind;
}

interface Snapshot {
  takenAt: string;
  node: NodeConfig;
  logical?: LogicalPanel;
  physical?: PhysicalPanel;
  slots: SlotHealth[];
  thresholds: Thresholds;
}

// 逻辑复制面板（核心）
interface LogicalPanel {
  subscriptions: SubscriptionSummary[];
  workers: WorkerStat[];
  syncMatrix: SyncMatrixCell[];
  errors: ErrorStats;
  spillStats: SpillStats[];
  rates: { totalMbps: number; totalTps: number; spillMbps: number; streamMbps: number };
}

// 物理复制面板（核心）
interface PhysicalPanel {
  replicas: PhysicalReplicaStat[];
}

// 单订阅一行的核心摘要（订阅表用）
interface SubscriptionSummary {
  subname: string;
  subenabled: boolean;
  slotName: string;
  slotWalStatus: 'reserved' | 'extended' | 'unreserved' | 'lost';
  slotWalRetentionBytes: number;
  seg_pub_to_flush: number;
  seg_flush_to_received: number;
  seg_received_to_applied: number;
  totalLag: number;
  applyWorkerPid: number | null;
  workerType: string | null;
  spillPct: number;
  totalMbps: number;
  applyErrorCount: number;
  conflictCounts: Record<string, number>;
  lastRecvAgeSeconds: number;
  severity: Severity;
}

interface Thresholds {
  total_lag_bytes: { warn: number; alert: number; critical: number };
  slot_wal_retention: { warn: number; alert: number; critical: number };
  apply_error_count_5m: { warn: number; alert: number; critical: number };
  conflict_count_5m: { warn: number; alert: number; critical: number };
  spill_pct: { warn: number; alert: number; critical: number };
  worker_last_recv_age: { warn: number; alert: number; critical: number };
  replica_write_lag_seconds: { warn: number; alert: number; critical: number };
  replica_replay_lag_seconds: { warn: number; alert: number; critical: number };
}
```

---

## 6. 验收（v0.1）

- [ ] DSN → 连接 → 自动检测 → 进 Dashboard
- [ ] 4 段 lag 一屏可视化
- [ ] 订阅表所有列渲染正确
- [ ] 物理 replica 表 + 趋势图
- [ ] 5s 自动刷新；可调 1~30s
- [ ] 阈值可编辑 + 越界染色
- [ ] 主题 / 语言切换
- [ ] JSON 导出
- [ ] `pgcm-server` 二进制 ≤ 20 MB
- [ ] DSN 密码不进 localStorage
- [ ] 默认仅 `127.0.0.1`

---

## 7. 里程碑

| 版本 | 范围 |
| --- | --- |
| v0.1 | F-1~F-9（本期） |
| v0.2 | 「记住 DSN」+ IndexedDB 历史 + token auth + webhook 告警 |

---

## 8. 参考资料

- [PostgreSQL 逻辑复制监控：六视图 + 一组可执行 SQL](~/code/blog/docs/database/postgresql-logical-replication-monitoring/index.html)
- [PostgreSQL 逻辑复制表的生命周期](~/code/blog/docs/database/postgresql-logical-replication-tables-lifecycle/index.html)
- [PostgreSQL 逻辑复制的 Worker 模型](~/code/blog/docs/database/postgresql-logical-replication-worker-model/index.html)
- [PostgreSQL 逻辑复制 streaming 与 spill](~/code/blog/docs/database/postgresql-logical-replication-streaming-spill/index.html)
- [PostgreSQL 逻辑复制订阅参数全解](~/code/blog/docs/database/postgresql-logical-replication-options/index.html)
- [pgweb — pgcm 形态参考](https://github.com/sosedoff/pgweb)
