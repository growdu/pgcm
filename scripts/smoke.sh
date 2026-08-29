#!/usr/bin/env bash
# scripts/smoke.sh — local end-to-end smoke test.
#
# Boots a throwaway PostgreSQL, waits for it to be ready, then starts pgcm
# and curls /healthz. Used by `make smoke` and (optionally) by CI on PRs.
#
# Requirements: docker, curl, jq, a built `bin/pgcm` (run `make build` first).

set -euo pipefail

PORT_PG="${PORT_PG:-55432}"
PORT_PGCM="${PORT_PGCM:-18080}"
PG_PASS="${PG_PASS:-smoke}"
DSN="postgres://postgres:${PG_PASS}@127.0.0.1:${PORT_PG}/postgres?sslmode=disable"

cleanup() {
  set +e
  if [[ -n "${PGCM_PID:-}" ]]; then
    kill "$PGCM_PID" 2>/dev/null || true
    wait "$PGCM_PID" 2>/dev/null || true
  fi
  if [[ -n "${PG_ID:-}" ]]; then
    docker rm -f "$PG_ID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [[ ! -x bin/pgcm ]]; then
  echo "bin/pgcm missing; run 'make build' first" >&2
  exit 1
fi

PG_ID=$(docker run -d --rm \
  -e POSTGRES_PASSWORD="$PG_PASS" \
  -e POSTGRES_DB=postgres \
  -p "${PORT_PG}:5432" \
  postgres:16-alpine \
  -c wal_level=logical \
  -c max_replication_slots=4 \
  -c max_wal_senders=4)
echo "pg container: $PG_ID"

# wait up to ~30s for pg to be ready
for i in $(seq 1 30); do
  if docker exec "$PG_ID" pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$PG_ID" pg_isready -U postgres >/dev/null 2>&1 || {
  echo "pg never became ready" >&2
  exit 1
}

# start pgcm
./bin/pgcm --listen "127.0.0.1:${PORT_PGCM}" --dsn "$DSN" &
PGCM_PID=$!
echo "pgcm pid: $PGCM_PID"

# wait for /healthz to come up
for i in $(seq 1 15); do
  if curl -fsS "http://127.0.0.1:${PORT_PGCM}/healthz" >/tmp/healthz.json 2>/dev/null; then
    break
  fi
  sleep 1
done

status=$(jq -r .status /tmp/healthz.json 2>/dev/null || echo "missing")
ver=$(jq -r .version /tmp/healthz.json 2>/dev/null || echo "missing")

if [[ "$status" != "ok" ]]; then
  echo "FAIL: /healthz did not return ok (got: $status)" >&2
  cat /tmp/healthz.json >&2 || true
  exit 1
fi

echo "OK: /healthz → status=$status version=$ver"
