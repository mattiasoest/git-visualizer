#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INFRA_DIR="${ROOT_DIR}/infra"

cd "${INFRA_DIR}"

API_URL="$(terraform output -raw api_url)"
BUCKET="$(terraform output -raw frontend_bucket_name)"
DISTRIBUTION_ID="$(terraform output -raw cloudfront_distribution_id)"

echo "Building frontend with VITE_API_BASE_URL=${API_URL}"
cd "${ROOT_DIR}/frontend"
VITE_API_BASE_URL="${API_URL}" npm run build

echo "Uploading to s3://${BUCKET}"
aws s3 sync dist/ "s3://${BUCKET}/" --delete

echo "Invalidating CloudFront distribution ${DISTRIBUTION_ID}"
aws cloudfront create-invalidation \
  --distribution-id "${DISTRIBUTION_ID}" \
  --paths "/*" \
  --output text \
  --query 'Invalidation.Id'

echo "Frontend deployed. Open: $(terraform -chdir="${INFRA_DIR}" output -raw cloudfront_url)"
