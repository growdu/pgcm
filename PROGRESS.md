# Progress Log

> 实施进度跟踪。详细规范见 `docs/`。

## ✅ Phase 1-4：后端骨架 + Snapshot 流水线

### 实现内容

| 模块 | 文件 | 说明 |
| --- | --- | --- |
| 入口 | `cmd/pgcm/main.go` | flag 解析；5s 安全等待；graceful shutdown；ticker 推 snapshot |
| 版本 | `internal/version/version.go` | ldflags 注入 Version/Commit/Date |
| 模型 | `internal/model/types.go` | 与前端 TS 接口 1:1 对应的 Go struct；Snapshot.ClusterKind 已注入 |
| 注册表 | `internal/store/nodes.go` | 多节点 + 连接状态元信息 |
| 滚动窗口 | `internal/store/ring.go` | 5min / 30s 桶 的内存环形 buffer |
| PG 客户端 | `internal/pg/conns.go` | pgxpool 封装；自动检测集群类型 |
| 查询 | `internal/pg/queries.go` | 订阅 / worker / replica / slot / spill / error |
| SyncMatrix | `internal/pg/queries_sync.go` | 订阅 srsubstate 分布矩阵 |
| Snapshot | `internal/pg/snapshot.go` | 聚合单次 tick + spill/stream 5min 差分 + cluster_kind 透传 |
| HTTP | `internal/server/http.go` | chi 路由；`embed.FS` 静态资源；`/healthz` `/api/v1/*` |
| Manager | `internal/server/manager.go` | `/api/v1/connect/disconnect/snapshot/ws`；broadcast |

### 验证

- ✅ `go vet ./...` 通过（CI：`backend` job）
- ✅ `go test ./... -race -count=1` 通过（含 `model`/`store`/`pg`/`version` 单测）
- ✅ `go build` 通过；CI 在 `binary` job 跑端到端：`--help` + 监听 `:18080` + curl `/healthz` 断言 `status=='ok'`
- ⏳ 端到端 PG 连通：本地用 `make smoke`（需要 docker），CI 里可在跑 `binary` job 的 runner 上加 service container

### 已知简化

| 项 | 现状 | 后续 |
| --- | --- | --- |
| 4 段 lag | 只算 `received→applied` + `restart→confirmed_flush`（subscriber 端单连接够用） | v0.2 跨 publisher/subscriber 双连接 |
| `pg_stat_replication` lag 时长 | subscriber 端该列为 NULL（设计） | 切换 publisher 节点后正常 |

---

## ✅ Phase 5-7：前端（完成）

### 已完成

- 配置：`web/package.json` `web/vite.config.ts` `web/tsconfig.json` `web/tailwind.config.js` `web/postcss.config.js` `web/index.html`
- 入口：`web/src/main.tsx` `web/src/App.tsx`（顶层布局 + WS tick dispatcher）
- 类型：`web/src/types/index.ts` 与 Go struct 1:1
- 工具：`web/src/lib/format.ts` `web/src/store/index.ts`（Zustand + persist） `web/src/api/{client,ws}.ts` `web/src/i18n/index.ts`（中/英）
- 组件：`WelcomeScreen` `TopBar` `NodeSwitcher` `SummaryStrip` `LagStackBar` `LagTrendMiniChart` `RateCards` `SpillCards` `SubscriptionTable` `ReplicaTable` `WorkerTable` `SlotList` `SyncMatrix` `ErrorGrid` `SeverityBadge` `SettingsDrawer`
- 主题：dark mode + severity-* 色板（`globals.css`）

### 待跑

`pnpm install && pnpm build` 产出 `web/dist/`；CI 在 `frontend` job 跑。

---

## ✅ Phase 8：Docker / Compose / Smoke

- `Dockerfile`（3 阶段：node → golang → distroless `nonroot`）
- `docker-compose.yml`（publisher:5432 + pgcm:8080，subscriber slot 预留 v0.2）
- `scripts/sql/01-init-publisher.sql`（演示 publication）
- `scripts/smoke.sh`（docker run pg + ./bin/pgcm + curl /healthz）
- `make smoke / docker-build / docker-run / docker-push` 目标

---

## ✅ Phase 9：CI / CD

- `.github/workflows/ci.yml` 三 job：`backend` (vet/test/build) → `frontend` (pnpm install/typecheck/build) → `binary` (assemble embedded frontend + smoke `/healthz`)
- `.github/workflows/release.yml` `v*` tag 触发：goreleaser 5 平台二进制 + docker multi-arch + homebrew tap
- `.github/dependabot.yml` gomod/npm/github-actions/docker 每周更新
- `.goreleaser.yml` 5 平台矩阵 + ldflags 注入版本号

---

## 下次开工第一步

```bash
make build            # pnpm build + go build (embed)
make smoke            # 本地端到端 (docker run pg + ./bin/pgcm + curl /healthz)
make docker-build     # 单镜像测试
docker compose up -d  # publisher + pgcm
# 浏览器打开 http://127.0.0.1:8080  →  填 DSN → 看仪表盘
```

## CI 当前状态

- `main` 分支每次 push 触发 `ci.yml`
- `v*` tag 触发 `release.yml`
- Artifacts：`pgcm-bin`（14 天）、`web-dist`（7 天）

---

## ✅ Phase 10：v0.2 preview + CI 联通

### v0.2 起步（`574defc`）

- `internal/pg/queries.go` 订阅查询 LEFT JOIN `pg_replication_slots`，回带
  `wal_status` / `wal_retention_bytes` / `restart_lsn` / `confirmed_flush_lsn`
- `SubscriptionSummary` 新增 `SlotWalStatus` / `SlotWalRetentionB` / `SegPubToFlush` 字段
- `severityOf()` 新增两条规则：
  - `slot_wal_retention_bytes >= 100GiB → critical` / `>= 50GiB → warn`
  - `wal_status='lost' → critical` / `'unreserved' → warn`
- `TotalLag` 改为显式 `SegPubToFlush + SegFlushToReceived + SegReceivedToApplied`

v0.1 单连接仍是近似：`SegFlushToReceived=0` 等 v0.2 跨 publisher/subscriber 双连接再算。

### 顺手修掉预存在错误（`cc1fb25`）

(这些错误 v0.1 阶段没跑过 typecheck / 完整 test，所以一直没暴露。)

- `web/src/i18n/index.ts`：`settings` 同时声明了字符串 + 对象两种形态，对象版
  后写覆盖字符串版。重命名 `settings → settingsTitle`（TopBar 用）。
- `web/src/App.tsx:63` `raw as Snapshot` 强转缺 `unknown` 中转
- `web/src/App.tsx:116` `LogicalPanel.sync_matrix` 缺字段，加一次 unknown cast
- `web/src/components/SettingsDrawer.tsx:367` 强转 `Record<string,string>`
  不成立（zh/en 联合类型含嵌套对象）
- `internal/store/ring_test.go` `TestRingPushAndWindow` flaky：
  `now := time.Now()` 落在不同 10s 桶时第二次 push 不合并。改成
  `time.Now().Truncate(10*time.Second)` 让两次 push 落到同一桶。

### CI 联通（`11eb7f6` + `8ff0f7c`）

- `go 1.22 → 1.25`（pgx v5.10.0 要求 ≥ 1.25）
- ci.yml 两个 `setup-go` 都同步到 1.25
- binary job 补 `go mod tidy`（之前只在 backend job 跑，runner 内存里
  tidy 过不会回写，binary job 拿原始 go.mod 直接 build 就报
  `updates to go.mod needed`）

### CI 最终状态（run `33364578874`）

| Job | 时长 | 状态 |
| --- | --- | --- |
| Go · vet + test + build | 14s | ✓ |
| Web · install + typecheck + build | 35s | ✓ |
| Binary · full build (frontend embedded) | 34s | ✓ |

Artifacts：`pgcm-bin`（14 天）、`web-dist`（7 天）

### 仍待办

- `make smoke` 本地端到端（需 docker，沙箱里无）
- `--allow-remote` 在 CI smoke 里没单独覆盖（默认值 127.0.0.1 没问题）
- 前端 `pnpm-lock.yaml` 还没 commit（CI 当前不用 `--frozen-lockfile`，能过）

---

## ✅ Phase 11：lockfile 收口 + pnpm v9 workspace 修复

### 背景

Phase 10 之后 lockfile 已 commit（5a0ebc4），按 PROGRESS.md 的计划
该 re-enable `--frozen-lockfile`。但在 CI 里一开就挂：

```
Web · install + typecheck + build  pnpm install
  ERROR  packages field missing or empty
```

### 根因

仓库里 commit 的 `web/pnpm-workspace.yaml` 是：

```yaml
allowBuilds:
  esbuild: true
```

- `allowBuilds` 是 pnpm **v10** 才有的字段（控制 install 时允许运行
  postinstall 脚本的包）
- CI 锁定 pnpm **v9**。v9 不识别 `allowBuilds`，但 `pnpm-workspace.yaml`
  存在本身就让 v9 把仓库当成 monorepo，要求 `packages` 字段
- lockfile (`lockfileVersion: '9.0'`) 是用 v10 在 dev 机器上生成的，
  所以带 `allowBuilds`；CI 上 v9 解析失败

### 修法（`f0c80f5`）

- 删 `web/pnpm-workspace.yaml`（本仓库是单 package，不是 monorepo，
  没有 legitimate reason 留这个文件）
- 把 `esbuild` postinstall 放行改用 pnpm v9 原生写法：
  `package.json` 里加 `"pnpm": { "onlyBuiltDependencies": ["esbuild"] }`
  （v9 默认禁用 postinstall 以做安全加固）

### 步骤

1. `d831612` — ci(frontend): pnpm install --frozen-lockfile （首次尝试，CI 红）
2. `f0c80f5` — fix(frontend): drop pnpm-workspace.yaml + add onlyBuiltDependencies

### CI 收口（run `33404384874`）

| Job | 时长 | 状态 |
| --- | --- | --- |
| Go · vet + test + build | 16s | ✓ |
| Web · install + typecheck + build | 29s | ✓ |
| Binary · full build (frontend embedded) | 34s | ✓ |

至此 Phase 10 PROGRESS.md 里"前端 `pnpm-lock.yaml` 还没 commit"那条
遗留项真正落地。

### 仍待办

- `make smoke` 本地端到端（需 docker）
- `--allow-remote` 在 CI smoke 里没单独覆盖
