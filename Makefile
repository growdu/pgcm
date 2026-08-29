.PHONY: all build run dev web web-build web-install test fmt vet clean
.PHONY: smoke docker-build docker-run docker-push

all: build

# 1) frontend build → web/dist
# 2) sync web/dist → cmd/pgcm/static (embedded by //go:embed static)
# 3) go build with embedded assets
build: web-build sync-dist
	@mkdir -p bin
	go build -o bin/pgcm ./cmd/pgcm

web-install:
	cd web && pnpm install --silent

web-build: web-install
	cd web && pnpm build

# rsync-like copy using cp -R to keep the embed happy.
# Vite output: cmd/pgcm/static/index.html + cmd/pgcm/static/assets/*.
sync-dist:
	rm -rf cmd/pgcm/static
	mkdir -p cmd/pgcm/static
	cp -R web/dist/. cmd/pgcm/static/

run: build
	./bin/pgcm --listen 127.0.0.1:8080

dev:
	go run ./cmd/pgcm --listen 127.0.0.1:8080

web-dev:
	cd web && pnpm dev

clean:
	rm -rf bin cmd/pgcm/static web/dist web/node_modules

test:
	go test ./...

smoke: build
	./scripts/smoke.sh

docker-build:
	docker build -t pgcm:dev \
	  --build-arg VERSION=$(shell git describe --tags --always --dirty 2>/dev/null || echo dev) \
	  --build-arg COMMIT=$(shell git rev-parse --short HEAD 2>/dev/null || echo unknown) \
	  --build-arg DATE=$(shell date -u +%Y-%m-%dT%H:%M:%SZ) \
	  .

docker-run: docker-build
	docker run --rm -p 8080:8080 pgcm:dev --listen 0.0.0.0:8080 --allow-remote

docker-push:
	docker build -t ghcr.io/growdu/pgcm:latest \
	  --build-arg VERSION=$(shell git describe --tags --always --dirty 2>/dev/null || echo dev) \
	  --build-arg COMMIT=$(shell git rev-parse --short HEAD 2>/dev/null || echo unknown) \
	  --build-arg DATE=$(shell date -u +%Y-%m-%dT%H:%M:%SZ) \
	  .

fmt:
	gofmt -w .
	goimports -w .

vet:
	go vet ./...
