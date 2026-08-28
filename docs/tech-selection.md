# pgcm — 技术选型

> **配套**：[requirements.md](./requirements.md) · [architecture.md](./architecture.md) · [ui-spec.md](./ui-spec.md)
> **版本**：v0.1 — 2026-08-28
> **原则**：能用 stdlib 就不引第三方库；能用主流成熟方案就不引小众方案

## 0. 选型一览

| 层 | 选型 | 版本目标 |
| --- | --- | --- |
| pgcm-server 语言 | **Go** | 1.22+ |
| PG 驱动 | **pgx**（jackc/pgx） | v5 |
| HTTP 路由 | **stdlib `net/http`** + [`chi`](https://github.com/go-chi/chi)（轻量 middleware） | Go 1.22 / chi v5 |
| WebSocket | [`coder/websocket`](https://github.com/coder/websocket)（nhooyr 维护版） | latest |
| 静态资源 | `embed.FS`（stdlib） | Go 1.16+ |
| 配置 | stdlib `flag` + 环境变量 | — |
| 日志 | stdlib `log/slog` | Go 1.21+ |
| 测试 | stdlib `testing` + [`testcontainers-go`](https://github.com/testcontainers/testcontainers-go)（PG integration） | — |
| 前端框架 | **React** + **Vite** + **TypeScript** | React 18 / Vite 5 / TS 5 |
| 样式 | **Tailwind CSS** + **shadcn/ui**（vanilla-extract 也行，shadcn 更主流） | Tailwind 3 / shadcn 最新 |
| 图表 | **Recharts**（折线 + 柱 + mini-chart 够用） | v2 |
| 状态管理 | **Zustand** | v4 |
| WS 客户端 | 原生 `WebSocket` + 自封装（≤50 行 reconnect） | — |
| 图标 | **lucide-react** | latest |
| i18n | **i18next** + react-i18next | v23 / v14 |
| 包管理 | **pnpm**（前端）/ Go modules（后端） | — |
| 测试（前端） | **Vitest** + **React Testing Library** | latest |
| E2E | **Playwright**（v0.2） | — |
| 构建 | Go `go build` + Vite `pnpm build` + multi-stage Dockerfile | — |
| CI | GitHub Actions | — |
| 发布 | GoReleaser（自动交叉编译 + Docker + Homebrew） | — |

---

## 1. pgcm-server 语言：Go

**为什么是 Go**：

- **单二进制**：交叉编译简单；`CGO_ENABLED=0 go build` 出 20MB 静态二进制
- **PG 生态**：`pgx` 是 PG 官方推荐客户端，性能和功能均最佳
- **stdlib 强大**：`net/http` + `embed.FS` + `log/slog` + `flag` 一站式；不必引入 gin/echo/zerolog 等
- **运维友好**：goroutine 调度简单；pprof 内置；defer + recover 处理 panic 干净
- **同形态参考**：[pgweb](https://github.com/sosedoff/pgweb) 已用 Go 多年，模式成熟

**拒绝的方案**：

| 方案 | 不选的理由 |
| --- | --- |
| Rust | `tokio-postgres` 同样好，但交叉编译工具链更重，团队学习成本高 |
| Node.js (TS) | pkg/nexe 打包麻烦；首启慢；用户层 "no backend" 体验不符 |
| Python | 同上；pyinstaller 体验差 |
| C++ | 过于底层 |

## 2. PG 驱动：pgx

`jackc/pgx/v5` 是 Go 生态 PG 客户端的事实标准：

- 支持 native PG wire protocol（含 logical replication protocol 的扩展）
- 类型映射完整（LSN → `pgtype.LSN`；numeric → `pgtype.Numeric`）
- `pgxpool` 提供连接池；自动重连
- prepared statement 缓存开箱即用

**用法**：每个节点一个 `*pgxpool.Pool`，`max_conns=1`（足够，snapshot 是顺序查）；设 `min_conns=1` 减少首查延迟。

**拒绝**：`database/sql` + `lib/pq` 仍可用，但 `lib/pq` 已停止维护；新项目直接 pgx。

## 3. HTTP 路由：stdlib + chi

**为什么 stdlib**：

- Go 1.22+ `net/http` 已支持 method-based routing（`http.ServeMux.HandleFunc("GET /api/v1/snapshot", ...)`）
- v0.1 只有 ~10 个端点；不需要复杂的路由 group / middleware chain

**为什么加 chi**：

- CORS、RequestID、RealIP、Logger 等常用 middleware 一行引入
- ~30KB 静态库；零业务侵入
- 后期想换回 stdlib 很容易

**拒绝**：Gin / Echo / Fiber — 体积大、反射多、抽象重；对 v0.1 过度。

## 4. WebSocket：coder/websocket

**为什么 coder/websocket（nhooyr）**：

- 轻量；~3KB；API 干净
- 内置 ping/pong；context-aware；避免 `gorilla/websocket` 的旧式 channel API
- 活跃维护

**拒绝**：`gorilla/websocket` 仍可用，但 API 老旧（channel 模式）；`melody` / `neurosnap/socket.io` 太重。

## 5. 前端：React + Vite + TypeScript

**为什么 React**：

- 生态最大：shadcn/ui / Recharts / Zustand 都是 React 优先
- 并发模式（useTransition / Suspense）自然
- 招人 / 接手成本最低

**为什么 Vite**：

- 启动 < 1s；HMR < 100ms
- 配置简单；build 产物干净
- `pnpm build` 输出纯静态文件，`embed.FS` 一行打包

**为什么 TypeScript**：

- 数据结构复杂（Snapshot / Thresholds / NodeConfig）；TS 让接口对齐零成本
- 与 Go struct 1:1 对应（用 `json:"sn"` 标签 + `tsc --strict`）

**拒绝**：

| 方案 | 不选的理由 |
| --- | --- |
| Vue 3 | 生态略小；shadcn-vue 不如 shadcn/ui 成熟 |
| Svelte/SvelteKit | bundle 最小；但 shadcn-svelte 仍 beta |
| vanilla TS + Web Components | 最少代码；但状态管理 / 路由得自己写，开发慢 |
| Next.js | 不需要 SSR；SSG 也不需要（全是客户端状态） |

## 6. 样式：Tailwind CSS + shadcn/ui

**为什么 Tailwind**：

- 工具类直接写在 JSX 里，**没有 CSS-in-JS runtime**
- 产物小（PurgeCSS 内置）；构建后几乎无冗余

**为什么 shadcn/ui**：

- **不是 npm 包，是复制粘贴**：每个组件直接进项目源码；可改可学；bundle 极小
- 基于 Radix UI（无障碍完备）+ Tailwind
- 默认美观（与 macOS 原生风接近）；主题切换通过 CSS variable
- v0.1 复制 5 个组件就够：`Button` `Card` `Drawer` `Dialog` `Table`

**拒绝**：

| 方案 | 不选的理由 |
| --- | --- |
| MUI / Ant Design | 100KB+；主题定制难；与"简单美观"原则冲突 |
| Chakra UI | 主题系统好；但运行时 token 解析有开销 |
| CSS Modules | 写得多；shadcn/ui 已包好 |

## 7. 图表：Recharts

**为什么 Recharts**：

- React-native（声明式）；与 React 生态 1:1
- 折线 / 柱 / 饼 / mini-chart 全部覆盖
- bundle ~150KB gzip；v0.1 可接受

**使用场景**：

- Lag-Trend-Mini-Chart（折线，3 条线 + 4 阈值参考线）
- Rate/Spill 卡右下角 mini-chart（折线，1 条线）

**拒绝**：

| 方案 | 不选的理由 |
| --- | --- |
| uPlot | 性能最好（<10KB）；但 API 命令式；React 集成要 wrapper |
| ECharts | 全功能但 ~400KB；v0.1 用不上 80% 功能 |
| visx | 灵活但 low-level；开发慢 |
| Chart.js | canvas-based；与 React 集成差 |

## 8. 状态管理：Zustand

**为什么 Zustand**：

- **无 reducer / dispatch / Provider**；hooks 风格直白
- ~1KB；选 selector 避免 re-render
- localStorage 持久化一行：`persist` middleware

**用法**：

```ts
// store/snapshot.ts
const useSnapshot = create<SnapState>((set) => ({
  data: null,
  set: (snap) => set({ data: snap, takenAt: Date.now() }),
}));
```

**拒绝**：

| 方案 | 不选的理由 |
| --- | --- |
| Redux Toolkit | 仪式太多；v0.1 用不上 time-travel debug |
| Jotai | atomic 适合超细粒度；v0.1 store 切片不多 |
| React Context | 全部 re-render；规模化后痛 |

## 9. WS 客户端：原生 + 自封装

- 直接用 `WebSocket` 全局对象
- 自封装一个 `createWSClient(url)`：自动重连（指数退避 1s/2s/4s/8s 上限 30s）+ 降级 fetch
- 总共 < 80 行；不引第三方

**拒绝**：`socket.io` 服务端要配套协议；`reconnecting-websocket` 旧维护。

## 10. i18n：i18next

- 成熟；按 namespace 组织 key
- 中 / En 双语切换 + localStorage 持久化
- bundle 增量 ~10KB

**拒绝**：`react-intl` 类似；LinguiJS 学习曲线陡。

## 11. 测试

**后端**：

- `testing`（stdlib）+ `dockertest`/`testcontainers-go` 跑 PG 容器做 integration
- v0.1 重点测 `pg.spill`（差分逻辑最容易出 bug）和 `store.ring`（环形 buffer）

**前端**：

- Vitest（与 Vite 一体化；HMR 跑测试）
- React Testing Library（组件渲染）
- v0.1 重点测 `lib/format.ts`（LSN / interval / byte 格式化）和 `lib/threshold.ts`（越界判定）

**E2E**（v0.2）：

- Playwright；启动 pgcm-server + 真 PG，跑"连接 → → 看到 4 段 lag"链路

## 12. 构建 / 发布：GoReleaser

**为什么 GoReleaser**：

- 一行配置：5 平台二进制 + Docker + Homebrew tap + SBOM
- 复用 `.goreleaser.yaml`；GitHub Actions 集成现成

**示例**（核心节选）：

```yaml
builds:
  - id: pgcm
    main: ./cmd/pgcm
    binary: pgcm
    env: [CGO_ENABLED=0]
    goos: [linux, darwin, windows]
    goarch: [amd64, arm64]

archives:
  - formats: ['tar.gz']
    files: ['README.md']

dockers:
  - image_templates: ['ghcr.io/pgcm/pgcm:{{ .Tag }}']
    dockerfile: Dockerfile

brews:
  - tap:
      owner: pgcm
      name: homebrew-tap
    homepage: https://pgcm.dev
    description: PostgreSQL Cluster Monitor
```

## 13. CI：GitHub Actions

最小 2 个 job：

```yaml
jobs:
  backend:
    steps:
      - go test ./...
      - go vet ./...
      - golangci-lint run

  frontend:
    steps:
      - pnpm install
      - pnpm test
      - pnpm build
      - pnpm typecheck
```

## 14. 项目结构（最终）

```
pgcm/
├── cmd/pgcm/main.go
├── internal/
│   ├── server/      (架构 §2)
│   ├── pg/
│   ├── store/
│   ├── model/
│   └── version/
├── web/             (架构 §3)
│   ├── src/
│   ├── public/
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
├── docs/
├── .goreleaser.yaml
├── Dockerfile
├── Makefile
└── README.md
```

## 15. 关键拒绝记录

| 想用 | 不用的最终理由 |
| --- | --- |
| Web framework（Gin 等） | stdlib + chi 够；少一层抽象 |
| ORM（ent / gorm） | pgx + 原生 SQL 足矣；8 个固化脚本足够 |
| 任何 key-value store / 时序库 | v0.1 内存滚动窗口；v0.2 再说 |
| Tailwind plugins（typography / forms） | v0.1 用不上 |
| 自定义主题系统 | shadcn/ui 默认 OK；改 CSS variable 即可 |

## 16. 验收（选型层）

- [ ] `pgcm-server` 单二进制 ≤ 20 MB（实测）
- [ ] 前端 build 产物 ≤ 500 KB gzip（实测）
- [ ] 首屏资源 ≤ 200 KB（实测，Lighthouse）
- [ ] `go test ./...` 全绿
- [ ] `pnpm test` 全绿
- [ ] 5 平台均能启动并连接 PG
