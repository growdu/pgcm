# pgcm — 用户接口规格（单页）

> **配套**：[requirements.md](./requirements.md) · [metrics-catalog.md](./metrics-catalog.md) · [sql-scripts.md](./sql-scripts.md)
> **目标读者**：前端 / 设计 / QA
> **版本**：v0.1 — 2026-08-28
> **UI 语言**：中文为主，PG 技术术语保留英文（`apply worker / slot / spill` 等）

## 0. 原则

- **一个 URL：`/`**（不引入路由）
- **少即是多**：默认显示最关键的 4 卡 + 区块；细节全部折叠，按需展开
- **不配就不会坏**：未配置阈值 = 用出厂默认；未选节点 = 默认 Single
- **状态色**：OK 绿 / WARN 橙 / ALERT 红 / CRITICAL 暗红 / UNKNOWN 灰
- **i18n key 化**：所有可见文案 `[i18nKey]` 标注

## 1. 单页布局

```
┌─ Top-Bar (fixed, 56px) ────────────────────────────────────────────┐
│  pgcm | [节点▼] [● PG 18.0 · 5s 前] [⚙ 设置] [⤓ JSON] [中/En] [☼/☾]│
├─ Summary-Strip（4 卡，等宽） ───────────────────────────────────────┤
│  [max total_lag]  [活跃订阅数]  [活跃 replica 数]  [最高严重度]      │
├─ 逻辑复制区块（检测到 publisher/subscriber 时显示，否则隐藏） ───────┤
│  ├─ Lag-Stack-Bar（4 段堆叠条）                                    │
│  ├─ Rate-Cards × 4                                                 │
│  ├─ Spill-Cards × 4                                                │
│  └─ Subscription-Table（点行 → 折叠展开 Worker/Sync/Errors/Slot）  │
├─ 物理复制区块（检测到 replica 时显示，否则隐藏） ───────────────────┤
│  ├─ Replica-Table（点行 → 折叠展开 Lag-Trend）                     │
└─ Settings-Drawer（右上 ⚙ 触发） ──────────────────────────────────┘
    DSN 列表 / 刷新间隔 / 阈值默认值 / 主题 / 语言
```

未检测到任何复制角色时：区块全部隐藏，居中显示「此节点暂无复制角色」+ DSN 编辑入口。

## 2. Top-Bar

| 元素 | 内容 |
| --- | --- |
| Logo | `pgcm` 文字 |
| 节点下拉 | `Single` / `All nodes merged view` / 各节点 |
| 连接状态 | `● 已连 PG 18.0` / `● 超时` / `○ 未连接` |
| 刷新指示 | `5s 前` / `刷新中…` |
| 设置 | `⚙` 打开 Drawer |
| 导出 | `⤓ JSON` 下载 |
| 语言 | `中 / En` |
| 主题 | `☼ / ☾` |

节点下拉切换 = `POST /api/v1/connect { nodeId }` → 服务端切连接 → UI 全量重渲染。

## 3. Summary-Strip（4 卡）

| 卡 | 来源 | 渲染 |
| --- | --- | --- |
| `max total_lag` | 所有 sub 的 `total_lag` 最大 | pg_size_pretty + 阈值染色 |
| `活跃订阅数` | `pg_subscription WHERE subenabled=true` | 数字 |
| `活跃 replica 数` | `pg_stat_replication` | 数字 |
| `最高严重度` | 所有指标中最严重 badge |

## 5. 逻辑复制区块

### 5.1 Lag-Stack-Bar

- 横向堆叠条，4 段（pub→sent→flush→received→applied）
- 段宽**对数映射**（避免大段吞掉小段）
- 每段中央写字节数人类可读
- 颜色：pub→sent 粉 / sent→flush 紫 / flush→received 绿 / received→applied 蓝
- 阈值越界 → 段描边红
- hover：原文 LSN + 公式

### 5.2 Rate-Cards（× 4）

| 卡 | 主 | 副 |
| --- | --- | --- |
| `Total 字节速率` | `total_mbps` | 上一窗口对比（↑/↓ %） |
| `Total 事务速率` | `total_tps` | 上一窗口对比 |
| `Stream 字节` | `stream_mbps` | 占比 |
| `Spill 字节` | `spill_mbps` | spill_pct |

每卡右下迷你折线（5min 滚动窗口，内存）。

### 5.3 Spill-Cards（× 4）

| 卡 | 主 | 副 |
| --- | --- | --- |
| `spill_pct` | `12%` | 上一窗口对比 |
| `stream_to_spill_ratio` | `8.5` | 比值越大越健康 |
| `avg_spill_size` | `200 MB` | 平均单事务 spill |
| `stats_age` | `12 days` | 距 `stats_reset` |

颜色按 `spill_pct` 阈值染色。

### 5.4 Subscription-Table

**列**：

| 列 | 来源 | 渲染 |
| --- | --- | --- |
| `subname` | `pg_subscription.subname` | 高亮可点击展开 |
| `subenabled` | `pg_subscription.subenabled` | `✓ / ✗` badge |
| `slot_name` | `pg_subscription.subslotname` | monospace |
| `slot_wal_status` | `pg_replication_slots.wal_status` | badge |
| `slot_wal_retention` | `pg_wal_lsn_diff(now, restart_lsn)` | pg_size_pretty |
| 4 段 lag | §5.1 | 4 列数值 |
| apply worker pid | `pg_stat_subscription.pid` (`worker_type='apply', relid IS NULL`) | `12345` |
| `spill%` | 5min 差分 | % + 颜色 |
| `total_mbps` | 5min 差分 | `12.34 MB/s` |
| `apply_error_count` | `pg_stat_subscription_stats` | 整数 |
| 7 类 conflict | 同上 | 单 badge，> 0 标红 |
| `last_recv_age` | `now() - last_msg_receipt_time` | `5s / 5m / 30m` + 颜色 |
| `severity` | 综合 | OK/WARN/ALERT/CRITICAL badge |

**行点击 → 折叠展开**（4 个折叠子区块，紧凑纵向堆叠）：

1. **Worker-Table**（apply / parallel apply / table synchronization 三类 worker，字段同需求 FR-3 折叠区）
2. **Sync-Matrix**（一行热图：列 `i/f/d/s/c/r/w` × 表数量）
3. **Error-Grid**（3×3 9 卡：apply_error + sync_error + 7 类 conflict）
4. **Slot-List**（每条 slot 一行：slot_name / plugin / slot_type / wal_status / active / restart_lsn / confirmed_flush_lsn / retained_wal / unconsumed_wal / inactive_seconds / invalidation_reason / health_status）

**行高亮规则**：

- `alive=false` → 行红
- `last_recv_age > 5min` → 行橙
- `worker_type='table synchronization' AND relid IS NULL` → 行灰

## 6. 物理复制区块

### 6.1 Replica-Table

**列**：

| 列 | 来源 |
| --- | --- |
| `application_name` | `pg_stat_replication.application_name` |
| `client_addr` | `pg_stat_replication.client_addr` |
| `state` | badge：`startup/catchup/streaming/backup/stopping` |
| `sync_state` | badge：`async/potential/sync/quorum` |
| `sent_lsn / write_lsn / flush_lsn / replay_lsn` | LSN |
| `write_lag / flush_lag / replay_lag` | interval 人类可读 |
| `backend_start` | `12 days ago` |
| `reply_time` | `5s ago` |

**行点击 → 折叠展开 Lag-Trend-Mini-Chart**：

- 折线图，3 条线：`write_lag / flush_lag / replay_lag`（秒）
- 5 分钟滚动窗口（内存）
- 4 条阈值参考线（虚线 + 标签）

## 7. Settings-Drawer

**触发**：右上 `⚙`。右侧滑出，宽 480px。

**Sections**（折叠手风琴，按需展开；最常用 DSN 列表默认展开）：

1. **节点列表 / DSN**：节点卡片堆叠，每卡显示 `name / role / host:port/dbname`（脱敏）+ `[编辑] [测试连接] [删除]`；顶部 `[+ 添加节点]` 主按钮
2. **刷新间隔**：单选 `1s / 2s / 5s / 10s / 30s`（默认 5s）
3. **阈值默认值**：10 行表格，每行 4 数字输入框（warn / alert / critical / unit）；底部 `[恢复出厂]`
4. **主题**：亮 / 暗
5. **语言**：中文 / English

DSN 编辑表单字段（弹 Dialog）：`name` `host` `port` `dbname` `user` `password`（编辑时 placeholder `已保存`）`sslmode`。底部 `[取消] [测试连接] [保存]`。

## 8. 状态

| 状态 | 渲染 |
| --- | --- |
| 未连接 | Dashboard 区显示 Welcome-Screen：大 Logo + DSN 表单 + `[连接]` |
| 连接中 | Top-Bar spinner + 按钮禁用 |
| 已连接 | 正常渲染 |
| 连接失败 | Top-Bar 红点 + Drawer 自动打开 + 错误消息 |
| 连接超时 | Top-Bar 红点「超时」+ 保留旧数据 30s |
| 节点不可达 | 顶部红 banner；表格灰显「暂无数据」 |

加载态：Skeleton（与表格行同高）。空态：「此节点暂无订阅 / 暂无 replica / 无复制角色」。

## 9. 实时刷新

```
ws://<host>/ws
  C → S: { type: "subscribe", topics: ["snapshot"] }
  C → S: { type: "set_interval", ms: 5000 }
  S → C: { type: "tick", ts, payload: Snapshot }
  S → C: { type: "error", code, message }
  S → C: { type: "node_status", nodeId, status }
```

WS 失败时自动降级到 `setInterval` + `/api/v1/snapshot`。

## 10. 组件清单（按使用频率排）

| 组件 | 用途 |
| --- | --- |
| `<Top-Bar>` | 顶部固定栏 |
| `<Node-Switcher>` | 节点下拉 |
| `<Summary-Strip>` | 4 卡汇总 |
| `<Lag-Stack-Bar>` | 4 段 lag 可视化 |
| `<Rate-Cards>` | 4 卡速率 |
| `<Spill-Cards>` | 4 卡 spill |
| `<Subscription-Table>` | 订阅表 + 行折叠子区块 |
| `<Worker-Table>` | worker 子表 |
| `<Sync-Matrix>` | 同步状态机热图 |
| `<Error-Grid>` | 9 卡错误冲突 |
| `<Slot-List>` | slot 卡片 |
| `<Replica-Table>` | 物理 replica 表 + 行折叠 |
| `<Lag-Trend-Mini-Chart>` | 趋势小图 |
| `<Settings-Drawer>` | 设置抽屉 |
| `<Welcome-Screen>` | 未连接时欢迎屏 |
| `<Severity-Badge>` | 严重度 badge |
| `<Lsn-Text>` | LSN 渲染（hover 显示 diff） |
| `<Byte-Text>` | 字节数渲染 |
| `<Interval-Text>` | 时间间隔渲染 |

**实现建议**：shadcn-vue 或 shadcn/ui 风格；Tailwind + lucide 图标；折线图 uPlot 或 ECharts。

## 12. 响应式

| 断点 | 布局 |
| --- | --- |
| ≥ 1280px | 完整 12 列；4 卡等宽 |
| 768–1279px | 8 列；4 卡变 2×2 |
| < 768px | 单列；表格转卡片视图 |

## 13. 可访问性

键盘可达；颜色对比 ≥ WCAG AA；数值变化 `aria-live="polite"`；不依赖颜色单一通道。

## 14. 验收（前端）

- [ ] DSN → 连接 → Dashboard
- [ ] 自动检测；缺失区块隐藏
- [ ] 4 段 lag + 阈值染色
- [ ] 订阅表所有列 + 行折叠 4 个子区块
- [ ] Replica 表 + 趋势图
- [ ] 5s 自动刷新；可调 1~30s
- [ ] 阈值编辑 + 越界染色
- [ ] 主题 / 语言切换
- [ ] JSON 导出
- [ ] 桌面 1280px 首屏 ≤ 1.5s
- [ ] Lighthouse Performance ≥ 80
