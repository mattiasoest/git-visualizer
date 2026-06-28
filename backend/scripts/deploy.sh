#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SERVER_PORT="${SERVER_PORT:-8080}"
HEALTH_URL="http://127.0.0.1:${SERVER_PORT}/actuator/health"

cd "${BACKEND_DIR}"

docker compose pull
docker compose up -d --wait

echo "Waiting for backend health at ${HEALTH_URL}..."
for _ in $(seq 1 30); do
  if curl -fsS "${HEALTH_URL}" >/dev/null 2>&1; then
    echo "Backend is healthy."
    curl -fsS "${HEALTH_URL}"
    echo
    exit 0
  fi
  sleep 2
done

echo "Backend failed health check. Recent logs:" >&2
docker compose logs --tail=50 backend >&2
exit 1
