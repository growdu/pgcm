# Progress Log

> 实施进度跟踪。详细规范见 `docs/`。

## ✅ Phase 1-4：后端骨架 + Snapshot 流水线（已完成）

### 实现内容

| 模块 | 文件 | 说明 |
| --- | --- | --- |
| 入口 | `cmd/pgcm/main.go` | flag 解析；5s 安全等待；graceful shutdown；ticker 推 snapshot |
| 版本 | `internal/version/version.go` | ldflags 注入 Version/Commit/Date |
| 模型 | `internal/model/types.go` | 与前端 TS 接口 1:1 对应的 Go struct |
| 注册表 | `internal/store/nodes.go` | 多节点 + 连接状态元信息 |
| 滚动窗口 | `internal/store/ring.go` | 5min / 30s 桶 的内存环形 buffer |
| PG 客户端 | `internal/pg/conns.go` | pgxpool 封装；自动检测集群类型 |
| 查询 | `internal/pg/queries.go` | 订阅 / worker / replica / slot / spill / error |
| Snapshot | `internal/pg/snapshot.go` | 聚合单次 tick + spill/stream 5min 差分 |
| HTTP | `internal/server/http.go` | chi 路由；`embed.FS` 静态资源；`/healthz` `/api/v1/*` |
| Manager | `internal/server/manager.go` | `/api/v1/connect/disconnect/snapshot/ws`；broadcast |

### 验证

- ✅ `go build -o bin/pgcm ./cmd/pgcm` 编译通过（16 MB，arm64）
- ✅ `--help` 输出完整 flag 列表
- ⏳ 端到端（PG 连通 + WS 推送）待集成测试（需要 docker 启动 PG）

### 已知简化

| 项 | 现状 | 后续 |
| --- | --- | --- |
| 4 段 lag | 只算 `received→applied` 一段（subscriber 端单连接够用） | v0.2 跨 publisher/subscriber 双连接 |
| 同步状态机 | 未实现 | v0.1 末补（Phase 5 完成时） |
| `pg_stat_replication` lag 时长 | subscriber 端该列为 NULL（设计） | 切换 publisher 节点后正常 |

---

## ⏳ Phase 5-7：前端（部分完成）

### 已完成

- `web/package.json` Vite + React 18 + TS 5 + Tailwind 3 + Recharts + Zustand 5 + lucide-react
- `web/vite.config.ts` 含 `/api` `/healthz` 反代到 8080
- `web/tsconfig.json` strict + path alias `@/*`
- `web/tailwind.config.js` 含 `severity-{ok,warn,alert,critical}` 色板
- `web/postcss.config.js`
- `web/index.html`
- `web/src/types/index.ts` TypeScript 接口（与 Go struct 1:1）
- `web/src/lib/format.ts` 字节/时长/速率格式化 + 严重度染色
- `web/src/store/index.ts` Zustand + persist（lang / theme / refreshInterval / thresholds / nodes）
- `web/src/api/client.ts` connect / disconnect / snapshot / health
- `web/src/api/ws.ts` WS 客户端 + 指数退避重连
- `web/src/i18n/index.ts` 中 / En 文案 dict
- `web/src/main.tsx` + `web/src/globals.css`
- `web/src/components/WelcomeScreen.tsx` DSN 表单 + 错误展示
- `web/src/components/TopBar.tsx` 连接状态 / 主题 / 语言 / 导出 / 断开
- `web/src/components/SummaryStrip.tsx` 4 卡（max lag / 订阅数 / replica 数 / 严重度）

### 待补

- `LagStackBar.tsx` 4 段 lag 可视化（堆叠条 + 对数映射）
- `RateCards.tsx` 4 卡速率（total / tps / stream / spill）
- `SpillCards.tsx` 4 卡 spill
- `SubscriptionTable.tsx` 订阅主表 + 行折叠（worker / errors / slot）
- `ReplicaTable.tsx` 物理 replica 表
- `SettingsDrawer.tsx` 节点列表 / 刷新间隔 / 阈值 / 主题 / 语言
- `App.tsx` 顶层布局 + WS 订阅
- `web/dist/` 产物

### 待跑

```
cd web && pnpm install   # 没沙箱网络，先试 goproxy.cn 镜像
cd web && pnpm build     # 产物输出到 web/dist
```

---

## ⏳ Phase 8：Dockerfile / docker-compose / smoke test

未开始。

---

## 总览

```
pgcm/
├── docs/          ✅ 6 篇设计文档
├── cmd/pgcm/      ✅ main.go + 静态目录
├── internal/      ✅ server / pg / store / model / version
├── web/           ⏳ 配置 + 部分组件
├── bin/pgcm       ✅ 16MB 编译产物
├── go.mod         ✅
├── Makefile       ✅
└── PROGRESS.md    ✅ 本文件
```

## 下次开工第一步

```bash
cd web && pnpm install && pnpm build   # 拉依赖 + 构建前端
make                                    # 重新编译带前端产物的二进制
docker run -d --name pg-test -p 55432:5432 -e POSTGRES_PASSWORD=test postgres:18
./bin/pgcm --listen 127.0.0.1:8080 --dsn 'postgres://postgres:test@localhost:55432/postgres'
# 浏览器打开 http://127.0.0.1:8080
```
