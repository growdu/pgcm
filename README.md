# pgcm

> 浏览器打开 → 填 DSN → 一页看全 PG 复制状态。
> 没有登录、没有多租户、没有独立后端 —— 只有 `pgcm-server`（PG wire-protocol 透明代理）+ 内嵌前端 SPA。

## 启动

```bash
pgcm --listen 127.0.0.1:8080
# 打开 http://127.0.0.1:8080
```

⚠️ 默认仅 `127.0.0.1`。bind `0.0.0.0` = 无鉴权 = **任何人能读你整个 PG**。

## 文档

| 文件 | 作用 |
| --- | --- |
| [docs/requirements.md](./docs/requirements.md) | 需求（场景 / FR / NFR / 数据模型 / 验收） |
| [docs/architecture.md](./docs/architecture.md) | 架构（模块、数据流、安全、部署、扩展点） |
| [docs/tech-selection.md](./docs/tech-selection.md) | 技术选型（语言、框架、库与理由） |
| [docs/ui-spec.md](./docs/ui-spec.md) | 单页 UI 规格 |
| [docs/metrics-catalog.md](./docs/metrics-catalog.md) | 指标 → 视图/字段/公式 |
| [docs/sql-scripts.md](./docs/sql-scripts.md) | 8 个 SQL + API 契约 |

## 设计原则

- **简单**：单 URL / 单页 / 单二进制 / 单 DSN
- **少即是多**：默认 4 卡 + 2 区块；细节折叠
- **不配就不会坏**：阈值有出厂默认
- **保留扩展**：接口留好，v0.2 再加

## 技术栈速览

- **pgcm-server**：Go 1.22 + stdlib net/http + chi + pgx v5 + coder/websocket
- **前端**：React 18 + Vite + TypeScript + Tailwind + shadcn/ui + Recharts + Zustand
- **发布**：GoReleaser（5 平台二进制 + Docker + Homebrew）

详见 [tech-selection.md](./docs/tech-selection.md)。

## 参考

[PostgreSQL 逻辑复制监控：六视图 + 一组可执行 SQL](~/code/blog/docs/database/postgresql-logical-replication-monitoring/index.html) · [pgweb 形态参考](https://github.com/sosedoff/pgweb)
