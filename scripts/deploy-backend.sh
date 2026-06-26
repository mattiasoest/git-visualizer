#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INFRA_DIR="${ROOT_DIR}/infra"
JAR_NAME="gitvisualizer-0.0.1-SNAPSHOT.jar"
S3_KEY="releases/${JAR_NAME}"

cd "${INFRA_DIR}"

INSTANCE_ID="$(terraform output -raw ec2_instance_id)"
ARTIFACTS_BUCKET="$(terraform output -raw artifacts_bucket_name)"
AWS_REGION="$(terraform output -raw aws_region)"

echo "Building backend JAR"
cd "${ROOT_DIR}/backend"
./mvnw -DskipTests package

JAR_PATH="${ROOT_DIR}/backend/target/${JAR_NAME}"
if [[ ! -f "${JAR_PATH}" ]]; then
  echo "JAR not found at ${JAR_PATH}" >&2
  exit 1
fi

echo "Uploading JAR to s3://${ARTIFACTS_BUCKET}/${S3_KEY}"
aws s3 cp "${JAR_PATH}" "s3://${ARTIFACTS_BUCKET}/${S3_KEY}"

COMMAND_ID="$(aws ssm send-command \
  --region "${AWS_REGION}" \
  --instance-ids "${INSTANCE_ID}" \
  --document-name "AWS-RunShellScript" \
  --comment "Deploy git-visualizer backend JAR" \
  --parameters "commands=[
    \"aws s3 cp s3://${ARTIFACTS_BUCKET}/${S3_KEY} /opt/gitvisualizer/gitvisualizer.jar\",
    \"chown gitvisualizer:gitvisualizer /opt/gitvisualizer/gitvisualizer.jar\",
    \"systemctl enable gitvisualizer || true\",
    \"systemctl restart gitvisualizer\",
    \"systemctl is-active gitvisualizer\",
    \"curl -fsS http://127.0.0.1:8080/actuator/health\"
  ]" \
  --query 'Command.CommandId' \
  --output text)"

echo "SSM command submitted: ${COMMAND_ID}"
echo "Waiting for deployment to finish..."

for _ in $(seq 1 60); do
  STATUS="$(aws ssm list-command-invocations \
    --region "${AWS_REGION}" \
    --command-id "${COMMAND_ID}" \
    --details \
    --query 'CommandInvocations[0].Status' \
    --output text 2>/dev/null || echo "Pending")"

  if [[ "${STATUS}" == "Success" ]]; then
    echo "Backend deployed successfully."
    aws ssm list-command-invocations \
      --region "${AWS_REGION}" \
      --command-id "${COMMAND_ID}" \
      --details \
      --query 'CommandInvocations[0].CommandPlugins[0].Output' \
      --output text
    echo "API URL: $(terraform -chdir="${INFRA_DIR}" output -raw api_url)"
    exit 0
  fi

  if [[ "${STATUS}" == "Failed" || "${STATUS}" == "Cancelled" || "${STATUS}" == "TimedOut" ]]; then
    echo "Deployment failed with status: ${STATUS}" >&2
    aws ssm list-command-invocations \
      --region "${AWS_REGION}" \
      --command-id "${COMMAND_ID}" \
      --details \
      --query 'CommandInvocations[0].CommandPlugins[0].Output' \
      --output text >&2 || true
    exit 1
  fi

  sleep 5
done

echo "Timed out waiting for SSM command ${COMMAND_ID}" >&2
exit 1
