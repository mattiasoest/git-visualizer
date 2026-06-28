#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${BACKEND_DIR}/.." && pwd)"

GITHUB_OWNER="${GITHUB_OWNER:-}"
if [[ -z "${GITHUB_OWNER}" ]] && git -C "${REPO_ROOT}" remote get-url origin &>/dev/null; then
  GITHUB_OWNER="$(git -C "${REPO_ROOT}" remote get-url origin | sed -E 's#.*github\.com[:/]([^/]+)/.*#\1#')"
fi
GITHUB_OWNER="${GITHUB_OWNER:-mattiasoest}"

IMAGE_NAME="${IMAGE_NAME:-git-visualizer-backend}"
IMAGE_TAG="${1:-${IMAGE_TAG:-latest}}"
GHCR_IMAGE="${GHCR_IMAGE:-ghcr.io/${GITHUB_OWNER}/${IMAGE_NAME}}"

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "Error: GITHUB_TOKEN is required (needs write:packages scope)." >&2
  exit 1
fi

GITHUB_ACTOR="${GITHUB_ACTOR:-${GITHUB_OWNER}}"
echo "Logging in to ghcr.io as ${GITHUB_ACTOR}..."
echo "${GITHUB_TOKEN}" | docker login ghcr.io -u "${GITHUB_ACTOR}" --password-stdin

docker buildx inspect multiarch >/dev/null 2>&1 \
  || docker buildx create --name multiarch --use
docker buildx use multiarch

echo "Building ${GHCR_IMAGE}:${IMAGE_TAG} for linux/amd64,linux/arm64..."
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t "${GHCR_IMAGE}:${IMAGE_TAG}" \
  --push \
  "${BACKEND_DIR}"

if [[ "${IMAGE_TAG}" != "latest" ]]; then
  docker buildx imagetools create \
    -t "${GHCR_IMAGE}:latest" \
    "${GHCR_IMAGE}:${IMAGE_TAG}"
  echo "Updated ${GHCR_IMAGE}:latest"
fi

echo "Published ${GHCR_IMAGE}:${IMAGE_TAG}"
