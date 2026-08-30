# pgcm

> 浏览器打开 → 填 DSN → 一页看全 PG 复制状态。
> 没有登录、没有多租户、没有独立后端 —— 只有 `pgcm`（PG wire-protocol 透明代理）+ 内嵌前端 SPA。

![CI](https://github.com/growdu/pgcm/actions/workflows/ci.yml/badge.svg)
![Release](https://github.com/growdu/pgcm/actions/workflows/release.yml/badge.svg)

## 启动

### 二进制（推荐）

```bash
pgcm --listen 127.0.0.1:8080
# 打开 http://127.0.0.1:8080
```

⚠️ 默认仅 `127.0.0.1`。bind `0.0.0.0` = 无鉴权 = **任何人能读你整个 PG**。
非 loopback 需要显式 `--allow-remote`（启动前会倒计时 5s）。

### Docker

```bash
docker run --rm -p 8080:8080 ghcr.io/growdu/pgcm:latest \
  --listen 0.0.0.0:8080 --allow-remote
```

### docker-compose（演示 publisher + pgcm）

```bash
docker compose up -d
# publisher: localhost:55432 (postgres / demo)
# pgcm:      http://localhost:8080
```

预置 publication `demo_pub`，启动后仪表盘立即有数据。

## 开发

```bash
make build      # pnpm install + pnpm build + go build
make web-dev    # vite dev server (5173) 反代到 8080
make smoke      # 端到端：docker run pg + ./bin/pgcm + curl /healthz
make test       # go test ./... -race -count=1
```

## 文档

| 文件 | 作用 |
| --- | --- |
| [docs/requirements.md](./docs/requirements.md) | 需求（场景 / FR / NFR / 数据模型 / 验收） |
| [docs/architecture.md](./docs/architecture.md) | 架构（模块、数据流、安全、部署、扩展点） |
| [docs/tech-selection.md](./docs/tech-selection.md) | 技术选型（语言、框架、库与理由） |
| [docs/ui-spec.md](./docs/ui-spec.md) | 单页 UI 规格 |
| [docs/metrics-catalog.md](./docs/metrics-catalog.md) | 指标 → 视图/字段/公式 |
| [docs/sql-scripts.md](./docs/sql-scripts.md) | 8 个 SQL + API 契约 |
| [PROGRESS.md](./PROGRESS.md) | 实施进度（阶段 / 验证 / 已知简化） |

## 设计原则

- **简单**：单 URL / 单页 / 单二进制 / 单 DSN
- **少即是多**：默认 4 卡 + 2 区块；细节折叠
- **不配就不会坏**：阈值有出厂默认
- **保留扩展**：接口留好，v0.2 再加

## 技术栈速览

- **后端**：Go 1.22 + stdlib net/http + chi + pgx v5 + coder/websocket
- **前端**：React 18 + Vite + TypeScript + Tailwind + Recharts + Zustand
- **发布**：GoReleaser（5 平台二进制 + Docker multi-arch + Homebrew tap）
- **CI**：GitHub Actions（`ci.yml` 3 job + `release.yml` tag-driven）

详见 [tech-selection.md](./docs/tech-selection.md)。

## 版本

每次构建通过 `-ldflags` 注入 `Version` / `Commit` / `Date`：

```bash
$ ./bin/pgcm --version   # 暂未单独 flag；会出现在 /healthz.version
{"status":"ok","version":"v0.1.0 (abc1234, 2025-01-01T00:00:00Z, go1.22.0)"}
```

## 参考

[PostgreSQL 逻辑复制监控：六视图 + 一组可执行 SQL](~/code/blog/docs/database/postgresql-logical-replication-monitoring/index.html) · [pgweb 形态参考](https://github.com/sosedoff/pgweb)
