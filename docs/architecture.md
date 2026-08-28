# pgcm — 架构设计

> **配套**：[requirements.md](./requirements.md) · [ui-spec.md](./ui-spec.md) · [tech-selection.md](./tech-selection.md) · [metrics-catalog.md](./metrics-catalog.md) · [sql-scripts.md](./sql-scripts.md)
> **版本**：v0.1 — 2026-08-28
> **范围**：架构与模块边界、模块间协作、数据流、安全模型、扩展点

## 0. 设计原则

1. **少即是多**：能用 stdlib 就不引第三方库；能用一张表就不引数据库；能用内存就不引磁盘
3. **协议透明**：`pgcm-server` 不解释业务，只翻译协议（HTTP/WS ↔ PG TCP wire protocol）
4. **失败显式**：PG 不可达时，UI 红 banner，**不"假装"显示旧数据**
5. **可丢弃**：所有内部状态都在内存；重启即丢；用户接受这个权衡换简洁

## 1. 系统拓扑

```
┌─────────────────────────────────────────────────────────────────────┐
│ 用户浏览器                                                          │
│   - 单 HTML 页 SPA（React + Tailwind + shadcn/ui + Recharts）        │
│   - localStorage（节点配置 / 阈值 / 主题 / 语言；不含密码）            │
│   - 内存（最近 5min 滚动窗口、当前快照、WebSocket 客户端）             │
└────────────────┬────────────────────────────────────────────────────┘
                 │ HTTP (静态资源) + WS (snapshot 推送)
                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ pgcm-server（Go 单二进制）                                           │
│   - HTTP server（stdlib net/http）                                   │
│   - 静态资源服务（embed.FS）                                          │
│   - /api/v1 REST（连接 / 快照 / 查询）                                │
│   - /ws WebSocket 推送                                              │
│   - pgxpool（每节点一条持久连接）                                     │
│   - 5min 内存滚动窗口（差分计算用）                                   │
└────────────────┬────────────────────────────────────────────────────┘
                 │ PG wire protocol（TCP 5432）
                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ PostgreSQL 14 / 15 / 16 / 17 / 18                                    │
│   - 视图：pg_replication_slots / pg_stat_replication /               │
│           pg_stat_replication_slots / pg_subscription / ...         │
└─────────────────────────────────────────────────────────────────────┘
```

**关键边界**：

- 浏览器**绝不直连 PG**（沙箱限制 + 安全隔离）
- pgcm-server **不持久化任何东西**（用户数据、配置、采集数据均不留）
- 单进程 → 用户 DSN 数量 ≤ ~10（每节点 1 连接 + 1 健康检查连接）

## 2. pgcm-server 模块

```
pgcm-server/
├── main.go                    // 启动入口，flags、信号处理
├── server/
│   ├── http.go                // net/http 路由；静态 embed.FS
│   ├── ws.go                  // /ws 升级 + 心跳 + snapshot 推送
│   └── handlers.go            // /api/v1/connect, /snapshot 等
├── pg/
│   ├── client.go              // pgxpool 封装；连接、重连、健康检查
│   ├── snapshot.go            // 单次 snapshot 聚合（sql-scripts §1）
│   ├── lag.go                 // 4 段 lag（sql-scripts §3）
│   ├── spill.go               // 5min 差分（sql-scripts §2、§7）
│   ├── workers.go             // worker 水位（sql-scripts §5）
│   ├── errors.go              // 错误冲突（sql-scripts §6）
│   ├── slots.go               // slot 健康（sql-scripts §8）
│   ├── physical.go            // 物理 replica（sql-scripts §9）
│   └── detect.go              // 自动检测（sql-scripts §10）
├── store/
│   ├── ring.go                // 通用滚动窗口（最近 5min，30s 桶）
│   └── nodes.go               // 节点配置 + 连接注册表
├── model/
│   └── types.go               // 与前端共享的 TypeScript 对应 Go struct
└── version/
    └── version.go             // git SHA、构建时间
```

### 2.1 模块职责（精简表）

| 模块 | 职责 | 不做什么 |
| --- | --- | --- |
| `main` | flag 解析、启动 HTTP、优雅退出 | 业务逻辑 |
| `server.http` | 路由 / 静态 / 跨域 | 不解析 PG 数据 |
| `server.ws` | 客户端连接管理、订阅、推送 | 不查 PG（由 `pg` 模块提供数据） |
| `pg.client` | pgxpool 封装、连接生命周期、健康检查 | 不做业务查询 |
| `pg.*` | 跑 SQL → struct；用 `store.ring` 维护滚动窗口 | 不做 HTTP |
| `store.ring` | 通用环形 buffer（线程安全） | 不解析 PG 数据 |
| `store.nodes` | 节点元信息（id / role / 连接句柄） | 不查 PG |
| `model` | 共享类型 | 不

### 2.2 关键不变量

- **同一节点只有一个持久连接**（pgxpool max=1 就够；snapshot 用短连接复用）
- **5min 滚动窗口**每 30s 推一个 bucket；新数据覆盖最旧
- **snapshot 频率**由 WS 客户端发 `set_interval` 控制；服务端不主动定时（避免浪费）
- **重连**：pgx 自带；HTTP/WS 客户端侧负责（前端用 reconnecting-websocket）

## 3. 前端 SPA 模块

```
web/src/
├── main.tsx                   // Vite 入口
├── App.tsx                    // 根布局
├── api/
│   ├── client.ts              // REST 封装
│   └── ws.ts                  // WS 封装（自动重连、降级）
├── store/
│   ├── nodes.ts               // Zustand: 节点列表 + 当前选中
│   ├── snapshot.ts            // Zustand: 最新 snapshot
│   ├── settings.ts            // Zustand: 阈值 / 主题 / 语言 / 刷新间隔
│   └── history.ts             // Zustand: 5min 滚动窗口
├── i18n/
│   ├── zh.ts
│   └── en.ts
├── components/                // 纯展示组件（无状态或读 store）
│   ├── TopBar.tsx
│   ├── SummaryStrip.tsx
│   ├── LagStackBar.tsx
│   ├── RateCards.tsx
│   ├── SpillCards.tsx
│   ├── SubscriptionTable.tsx
│   ├── WorkerTable.tsx
│   ├── SyncMatrix.tsx
│   ├── ErrorGrid.tsx
│   ├── SlotList.tsx
│   ├── ReplicaTable.tsx
│   ├── LagTrendMiniChart.tsx
│   ├── SettingsDrawer.tsx
│   ├── WelcomeScreen.tsx
│   └── SeverityBadge.tsx
├── lib/
│   ├── format.ts              // pg_size_pretty / interval 格式化
│   ├── threshold.ts           // 越界判定 + severity 染色
│   └── export.ts              // JSON 导出
└── styles/
    └── globals.css            // Tailwind 入口
```

### 3.1 模块职责

- `api`：唯一与 pgcm-server 通信的层；其余模块只依赖 store
- `store`：Zustand stores；持久化（localStorage）的写入集中在 `settings.ts`
- `components`：纯渲染；props in / event out；不直接调 API
- `lib`：纯函数；单测覆盖
- `i18n`：所有可见文案按 key 抽取（实现细节）；v0.1 = 中 / En

### 3.2 数据流

```
User input (DSN)
  → WelcomeScreen 表单
  → api.client.connect()
  → server 调 pg.client.Connect
  → 自动检测 → snapshot 返回
  → store.snapshot.set(snap)
  → components re-render
  → WS 推送增量 → store.snapshot.set(...)
  → components re-render
```

## 4. 数据流（详细时序）

### 4.1 连接

```
Browser                         pgcm-server                      PostgreSQL
  │                                  │                                │
  │ POST /api/v1/connect { dsn }      │                                │
  ├─────────────────────────────────▶│                                │
  │                                  │ pgxpool.Connect                │
  │                                  ├───────────────────────────────▶│
  │                                  │ ◀──── OK ──────────────────────┤
  │                                  │ 自动检测 SQL                    │
  │                                  ├───────────────────────────────▶│
  │                                  │ ◀──── {pubs: 1, subs: 3, ... }─┤
  │ 200 { ok, version, clusterKind } │                                │
  │◀─────────────────────────────────┤                                │
  │                                  │                                │
  │ Upgrade /ws                      │                                │
  ├─────────────────────────────────▶│                                │
  │ { type: "subscribe", topics }    │                                │
  │ { type: "set_interval", ms: 5000}│                                │
  │                                  │                                │
  │ { type: "tick", payload: ... }   │ (5s 后) snapshot 聚合          │
  │◀─────────────────────────────────┤ 调 pg.snapshot.Run()           │
  │                                  ├───────────────────────────────▶│
  │                                  │ ◀──── { ... }─────────────────┤
  │                                  │ 差分（pg.spill）                │
  │                                  │ struct 序列化 → JSON           │
  │ { type: "tick", payload: ... }   │                                │
  │◀─────────────────────────────────┤                                │
```

### 4.2 snapshot 内部流程

```
WS tick (every 5s)
  └─▶ pgcm-server
        ├─▶ pg.snapshot.Run()        // 脚本 §1（全链路一屏），subscriber 端
        ├─▶ pg.lag.Run()              // 脚本 §3（4 段 lag），需 publisher 端（跨节点）
        ├─▶ pg.spill.Run()            // 脚本 §2/§7（5min 差分），publisher 端
        ├─▶ pg.workers.Run()          // 脚本 §5，subscriber 端
        ├─▶ pg.errors.Run()          // 脚本 §6，subscriber 端
        ├─▶ pg.slots.Run()            // 脚本 §8，publisher 端
        ├─▶ pg.physical.Run()         // 脚本 §9，publisher 端
        └─▶ struct 合并 → JSON
              ↓
        WS push { type: "tick", payload: Snapshot }
              ↓
        Browser
          store.snapshot.set(payload)
          components re-render
```

### 4.3 失败路径

| 失败 | 检测 | UI 行为 |
| --- | --- | --- |
| PG 不可达 | pgxpool 重连失败 / 健康检查超时 | Top-Bar 红点；`{ type: "error" }` 推送；Welcome-Screen 半透明叠加 |
| PG 慢 | snapshot.Run 超时 10s | 跳过本次 tick；下一 tick 重试 |
| WS 断 | 浏览器侧 onclose | 自动重连 + 退避（1s/2s/4s/8s 上限 30s）；断连期间降级 fetch |
| 浏览器关闭 | WS onclose | pgcm-server 清理该客户端 |

## 5. 并发与状态

### 5.1 pgcm-server

- **Goroutine 模型**：
  - main：启动 HTTP + 等待信号
  - 每 HTTP 请求：1 goroutine（stdlib net/http）
  - 每 WS 客户端：1 读 goroutine + 1 写 goroutine
  - 每节点：1 健康检查 goroutine（每 30s）
  - 每 5min 滚动窗口：1 个 ring buffer（无独立 goroutine，snapshot.Run 内同步写）

- **共享状态**：
  - `store.nodes`：节点列表 + `pgxpool.Pool` 指针
  - `store.ring`：每个 slot 一个 ring buffer
  - 通过 `sync.RWMutex` 保护（粒度足够小，不用 channel）

- **优雅退出**：signal.NotifyContext → cancel context → 关闭所有 pgxpool → 等 WS 客户端断开 → 退出

### 5.2 前端

- **React 18 + concurrent**：自动 batching；不手动 throttle（snapshot 频率已经受控 5s）
- **Zustand store**：单例 + selectors；避免 re-render 爆炸
- **WS 客户端**：1 个 WebSocket 实例 + onmessage dispatch 到 store；多组件订阅各自 slice
- **环形 buffer**：复用服务端 ring 思路，纯前端实现

## 6. 安全模型

### 6.1 威胁模型

| 威胁 | 防护 |
| --- | --- |
| 远程攻击者读 PG（bind 0.0.0.0） | 默认仅 127.0.0.1；文档文档里多处提醒；启动 banner 警告 |
| 中间人（HTTP/WS 明文） | v0.1 仅 HTTP（127.0.0.1 内 loopback 无 MITM）；v0.2 加 `--tls` 自签证书 |
| 浏览器本地攻击者读 localStorage | 不存密码；其他配置无敏感 |
| 浏览器侧 XSS 读 snapshot | React 默认转义；CSP（v0.2 加） |
| 任意 SQL 注入（如果有 ad-hoc 查询） | v0.1 不暴露原始 SQL 接口；只有固化端点 |

### 6.2 凭证生命周期

1. 用户在 Welcome-Screen 输入
3. POST 到 `/api/v1/connect`（HTTPS / loopback）
5. pgcm-server 内存持有（**不写日志、不写磁盘**）
7. 前端不持久化密码（v0.1 设计决策）
9. WS 推送的 snapshot **不含密码**

### 6.3 启动时安全提示

```
$ pgcm --listen 0.0.0.0:8080
WARNING: Listening on 0.0.0.0:8080 without authentication.
ANYONE on the network can read your entire PostgreSQL instance.
Press Ctrl-C within 5 seconds to abort.
5...
```

## 7. 部署与发布

### 7.1 构建产物

| 平台 | 产物 | 命令 |
| --- | --- | --- |
| macOS arm64 | `pgcm-darwin-arm64` | `GOOS=darwin GOARCH=arm64 go build` |
| macOS amd64 | `pgcm-darwin-amd64` | `GOOS=darwin GOARCH=amd64 go build` |
| Linux amd64 | `pgcm-linux-amd64` | `GOOS=linux GOARCH=amd64 go build` |
| Linux arm64 | `pgcm-linux-arm64` | `GOOS=linux GOARCH=arm64 go build` |
| Windows amd64 | `pgcm-windows-amd64.exe` | `GOOS=windows GOARCH=amd64 go build` |
| Docker | `pgcm/pgcm:latest` | multi-stage Dockerfile |

- 目标：静态二进制 ≤ 20 MB（无 CGO；`CGO_ENABLED=0`）
- 前端产物通过 `embed.FS` 打包进二进制（构建期 `pnpm build` → `cp -r dist ./internal/static`）

### 7.2 发布管道

```
git tag v0.1.0
  → GitHub Actions:
      - build 5 平台二进制
      - 跑 Go test + 前端 test
      - 生成 SBOM（syft）
      - 上传 release assets
      - 构建 + push Docker image
```

### 7.3 包管理

| 渠道 | 形式 |
| --- | --- |
| macOS Homebrew | tap：`brew install pgcm/tap/pgcm` |
| Linux deb / rpm | `nfpm` 打包 |
| Docker | `docker pull pgcm/pgcm` |
| 源码 | `go install github.com/.../pgcm@latest` |

## 8. 故障与恢复

| 故障 | 恢复 |
| --- | --- |
| pgcm-server 崩溃 | 用户重启；无状态丢失（除滚动窗口）；浏览器 WS 重连后重新拉首屏 |
| PG 重启 | pgxpool 自动重连；浏览器无感知（继续收到 tick） |
| PG 慢 / 超时 | snapshot.Run 内部超时 10s；本次跳过；UI 数字短暂不动 |
| 网络抖动 | 浏览器 WS 重连 + 退避；fetch 兜底 |
| 前端崩溃 | React error boundary；reload |

## 9. 扩展点（v0.2+ 占位）

| 扩展 | 接入点 |
| --- | --- |
| 记住 DSN | `store/settings.ts` 加 `rememberDsn: boolean`；前端 input 旁加 checkbox |
| 多 DSN 切换 | `store.nodes.ts` 已支持 `NodeConfig[]`；UI 加顶部节点下拉 |
| IndexedDB 历史 | `store/history.ts` 写入 IndexedDB；折线图读 IndexedDB |
| Token auth | `main.go` 加 `--token` flag；`server.http` middleware 校验 |
| Webhook 告警 | 新增 `pgcm-server/notify/webhook.go`；threshold 计算触发 |
| prometheus_exporter | 新增 `/metrics` 端点；复用 `pg.snapshot` 输出 |
| Helm chart | `deploy/helm/pgcm/` |
| 节点参数展示 | 已预留 `M-NOD-01..05`（metrics-catalog §4）；`pg/params.go` + UI 抽屉新增 section |

## 10. 验收（架构层）

- [ ] `pgcm-server` 单二进制 ≤ 20 MB；`go build` 无 CGO
- [ ] 前端 SPA 单 HTML 页；首屏 ≤ 1.5s
- [ ] WS 5s 推送；自动重连；fetch 兜底
- [ ] 节点连接失败 → UI 红 banner，**不"假装"显示旧数据**
- [ ] bind 0.0.0.0 启动时打印 WARNING + 5s 倒计时
- [ ] 密码不进 localStorage / 不进日志
- [ ] graceful shutdown（Ctrl-C 等所有 WS 断开后退出）
- [ ] 5min 滚动窗口正确（5min 后数据被覆盖）
- [ ] PG 14 / 18 都跑通（最低版本与最新版本各跑一次）
