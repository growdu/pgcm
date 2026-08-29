# syntax=docker/dockerfile:1.7
#
# Multi-stage build for pgcm.
#   1) frontend: node + pnpm + vite → web/dist
#   2) backend:  golang + go build (with web/dist embedded via //go:embed)
#   3) runtime:  scratch + ca-certificates + tzdata + pgcm binary
#
# Default bind: 127.0.0.1:8080 (per pgcm main.go). Override with --listen.

ARG NODE_VERSION=20
ARG GO_VERSION=1.22

# ── Stage 1: frontend ───────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS frontend
WORKDIR /src/web

# pnpm via corepack (officially recommended for reproducible installs)
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@9 --activate

COPY web/package.json ./
RUN pnpm install --no-frozen-lockfile

COPY web/ ./
RUN pnpm build

# ── Stage 2: backend ────────────────────────────────────────────────
FROM golang:${GO_VERSION}-alpine AS backend
WORKDIR /src

# git for `go mod` if we ever need it; ca-certs for pgx TLS
RUN apk add --no-cache git ca-certificates tzdata

# Pre-cache modules
COPY go.mod go.sum ./
RUN go mod download

# Copy sources; cmd/pgcm/static will be filled by web/dist from stage 1
COPY cmd/      cmd/
COPY internal/ internal/

# Bring frontend artefacts into the //go:embed path
COPY --from=frontend /src/web/dist/ /src/cmd/pgcm/static/

# Reproducible, stripped binary
ARG VERSION=dev
ARG COMMIT=unknown
ARG DATE=unknown
RUN CGO_ENABLED=0 go build -trimpath \
      -ldflags "-s -w \
        -X github.com/pgcm/pgcm/internal/version.Version=${VERSION} \
        -X github.com/pgcm/pgcm/internal/version.Commit=${COMMIT}  \
        -X github.com/pgcm/pgcm/internal/version.Date=${DATE}" \
      -o /out/pgcm ./cmd/pgcm

# ── Stage 3: runtime ────────────────────────────────────────────────
FROM gcr.io/distroless/static-debian12:nonroot AS runtime
LABEL org.opencontainers.image.title="pgcm" \
      org.opencontainers.image.description="Browser-based PostgreSQL replication monitor" \
      org.opencontainers.image.source="https://github.com/growdu/pgcm"

COPY --from=backend /out/pgcm /pgcm
COPY --from=backend /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=backend /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/

EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/pgcm"]
CMD ["--listen", "0.0.0.0:8080"]
