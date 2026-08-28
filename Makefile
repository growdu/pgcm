.PHONY: all build run dev test fmt vet

all: build

build:
	cd web && pnpm install --silent && pnpm build
	go build -o bin/pgcm ./cmd/pgcm

run: build
	./bin/pgcm --listen 127.0.0.1:8080

dev:
	go run ./cmd/pgcm --listen 127.0.0.1:8080

web-dev:
	cd web && pnpm dev

test:
	go test ./...

fmt:
	gofmt -w .
	goimports -w .

vet:
	go vet ./...
