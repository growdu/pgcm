.PHONY: all build run dev web web-build web-install test fmt vet clean

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

fmt:
	gofmt -w .
	goimports -w .

vet:
	go vet ./...
