#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${BACKEND_DIR}"

docker compose pull
docker compose up -d

echo "Backend is running. Health: http://localhost:${SERVER_PORT:-8080}/actuator/health"
