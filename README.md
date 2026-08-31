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

## flag 总览

| flag | 默认值 | 作用 |
| --- | --- | --- |
| `--listen` | `127.0.0.1:8080` | HTTP 监听地址 |
| `--dsn` | _(空)_ | 启动时直连一个 PG 节点（`postgres://user:pwd@host:5432/db`） |
| `--allow-remote` | `false` | 允许 bind 非 loopback（必须显式开） |
| `--log-json` | `false` | stderr 日志切到 JSON 行 |

非 loopback bind 会先倒计时 5s 让你 Ctrl-C 取消。

## 从源码构建

```bash
git clone git@github.com:growdu/pgcm.git
cd pgcm
make build      # pnpm install + pnpm build + go build (embed)
make test       # go test ./... -race -count=1
make smoke      # 端到端：docker run pg + ./bin/pgcm + curl /healthz
```

或者直接拿 CI artifact：Actions 页面下载 `pgcm-bin`（已经是 build 好的 Linux 二进制）。

## 自己 build 镜像

```bash
make docker-build       # 本地 tag pgcm:dev
make docker-run         # = docker run --rm -p 8080:8080 pgcm:dev --listen 0.0.0.0:8080 --allow-remote
make docker-push        # push 到 ghcr.io/growdu/pgcm:latest
```

## 部署

### 形态选择

| 场景 | 推荐 |
| --- | --- |
| 本机单机 | `pgcm --listen 127.0.0.1:8080`，需要时 SSH tunnel |
| 多人 LAN / 内网 demo | docker compose + nginx basic_auth 反代 |
| 远程访问 / 跨网段 | 必须反向代理 + 鉴权（pgcm 本身不鉴权） |
| K8s | 单 Deployment + ClusterIP Service，DSN 通过 Secret 注入 |
| CI / 演示 | docker compose，publisher + pgcm 一把起 |

### 反向代理示例（nginx）

```nginx
server {
    listen 443 ssl;
    server_name pgcm.internal.example.com;

    ssl_certificate     /etc/ssl/certs/pgcm.pem;
    ssl_certificate_key /etc/ssl/private/pgcm.key;

    # basic auth（pgcm 没有内建鉴权，反代层挡）
    auth_basic           "pgcm";
    auth_basic_user_file /etc/nginx/.htpasswd;

    location / {
        proxy_pass         http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host $host;
        proxy_read_timeout 86400;     # WS 长连接
    }
}
```

pgcm 跑在 `127.0.0.1:8080`（不带 `--allow-remote`），由 nginx 终结 TLS + 鉴权。

### K8s 最小示例

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: pgcm }
spec:
  replicas: 1
  selector: { matchLabels: { app: pgcm } }
  template:
    metadata: { labels: { app: pgcm } }
    spec:
      containers:
        - name: pgcm
          image: ghcr.io/growdu/pgcm:latest
          args: ["--listen", "0.0.0.0:8080", "--allow-remote"]
          ports: [{ containerPort: 8080 }]
---
apiVersion: v1
kind: Service
metadata: { name: pgcm }
spec:
  selector: { app: pgcm }
  ports: [{ port: 80, targetPort: 8080 }]
```

DSN 不应进 ConfigMap；推荐用户从浏览器 UI 填，或后续 v0.2 走 Secret + 启动参数。

## 安全

pgcm 是 **PG wire-protocol 透明协议桥**，**没有登录、没有 RBAC、没有审计**：

- 它会拿你给的 DSN 跑 `pg_stat_subscription` / `pg_stat_replication` / `pg_replication_slots` 等只读查询
- 它**不会**写库、不会 DDL、不会执行任意 SQL（v0.1 不暴露 ad-hoc 接口）
- 浏览器**不存密码**到 localStorage（v0.1 设计决策）

任何 bind 到非 loopback 的实例 = 把 DSN 账号的整个 PG 权限暴露给网络。

必读：

1. **默认仅 `127.0.0.1`**，启动想 bind `0.0.0.0` 必须显式 `--allow-remote`（启动前倒计时 5s）
2. 远程访问走 **nginx + TLS + basic auth**（或 Cloudflare Tunnel / OAuth proxy）
3. 给 pgcm 的 PG 账号**建议只授 `pg_read_all_stats` + replication client**，不要 superuser
4. v0.1 只有 HTTP；LAN 内是安全的，跨网段必须 TLS
5. 不用的实例随手停 —— pgcm 没有 idle timeout 自动停

## 故障排查

```bash
# 1) 健康检查
curl -s http://127.0.0.1:8080/healthz | jq .
# → {"status":"ok","version":"v0.1.0 (commit, date, go1.25.0)"}

# 2) 前端是否 embed 成功？
./bin/pgcm --help              # 应看到上面 4 个 flag
ls -lh ./bin/pgcm              # 内嵌 web/dist 后体积 ~10MB+

# 3) DSN 连不上？
#    UI 顶部「测试连接」会显示 pgx 返回的具体 error
#    stderr 日志（--log-json 可换 JSON 行）会打印 connection refused / auth failed

# 4) 浏览器打开 404？
#    大概率 listen 不是 loopback 又没加 --allow-remote
#    或者反代没透传 Upgrade / Connection header（WS 断了 → 仪表盘无数据）

# 5) 仪表盘空 / 一直无数据？
#    浏览器 DevTools → Network → WS → 看 tick 帧是否在推
#    pgcm 端每 5s 给所有 WS 客户端推 snapshot，无订阅则不推

# 6) go build 报 "updates to go.mod needed"
#    = 仓库里 go.mod / go.sum 没 tidy 过，跑一次 `go mod tidy` 再提交
```

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
（工具链：`go 1.25`，CI `setup-go@v5` 也是 1.25；pgx v5.10.0 要求 ≥ 1.25）
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
