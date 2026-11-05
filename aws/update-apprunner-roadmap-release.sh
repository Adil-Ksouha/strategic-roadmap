#!/usr/bin/env bash
set -Eeuo pipefail

# Update an existing Architecture Master Roadmap App Runner service without changing
# its VPC connector, RDS instance, runtime secrets, or administrator account.
# The existing service temporarily receives an initializer image that runs Drizzle
# migrations once, then it is updated back to the normal application image.

REGION="${AWS_REGION:-us-east-1}"
REPOSITORY="${REPOSITORY:-architecture-master-roadmap}"
SERVICE_ARN="${SERVICE_ARN:-}"
WAIT_ATTEMPTS="${WAIT_ATTEMPTS:-90}"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Required command not found: $1" >&2
    exit 1
  }
}

wait_for_running() {
  local label="$1"
  local status
  for _ in $(seq 1 "$WAIT_ATTEMPTS"); do
    status="$(aws apprunner describe-service --region "$REGION" --service-arn "$SERVICE_ARN" --query 'Service.Status' --output text)"
    case "$status" in
      RUNNING)
        echo "${label} is RUNNING."
        return 0
        ;;
      UPDATE_FAILED|CREATE_FAILED|DELETE_FAILED)
        echo "${label} ended in state ${status}. The current service was retained for log inspection." >&2
        return 1
        ;;
      *)
        echo "${label} status: ${status}"
        sleep 10
        ;;
    esac
  done
  echo "Timed out waiting for ${label}. The service was retained for inspection." >&2
  return 1
}

for command in aws docker curl date mktemp python3; do
  require_command "$command"
done

[[ -n "$SERVICE_ARN" ]] || {
  echo "Set SERVICE_ARN to the existing Architecture Master Roadmap App Runner service ARN." >&2
  exit 1
}
[[ -f Dockerfile.migration ]] || { echo "Dockerfile.migration is missing." >&2; exit 1; }
[[ -f drizzle/0009_budget_classification.sql ]] || { echo "The additive Financial Roadmap budget classification migration is missing." >&2; exit 1; }
aws sts get-caller-identity --region "$REGION" >/dev/null

CURRENT_STATUS="$(aws apprunner describe-service --region "$REGION" --service-arn "$SERVICE_ARN" --query 'Service.Status' --output text)"
[[ "$CURRENT_STATUS" == "RUNNING" ]] || {
  echo "The target service must be RUNNING before this guarded update. Current status: ${CURRENT_STATUS}" >&2
  exit 1
}

cat <<'NOTICE'
This guarded update will:
  1. build and push two versioned images to the existing ECR repository;
  2. update the existing App Runner service with an initializer image that applies
     only checked-in Drizzle migrations to its existing private RDS database; and
  3. update the same service back to the normal migration-free application image.

It does not create or delete an RDS instance, VPC connector, App Runner service,
runtime secret, or local administrator account. The application may be briefly
unavailable while App Runner replaces the running revision.
NOTICE
read -r -p "Type UPDATE_ARCHITECTURE_MASTER_ROADMAP to continue: " CONFIRMATION
[[ "$CONFIRMATION" == "UPDATE_ARCHITECTURE_MASTER_ROADMAP" ]] || {
  echo "Confirmation did not match. No AWS resources were changed."
  exit 1
}

ACCOUNT_ID="$(aws sts get-caller-identity --region "$REGION" --query Account --output text)"
ECR_REGISTRY="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
ECR_URI="${ECR_REGISTRY}/${REPOSITORY}"
IMAGE_TAG="release-$(date -u +%Y%m%d%H%M%S)"
INITIALIZER_IMAGE_URI="${ECR_URI}:${IMAGE_TAG}-initialize"
APPLICATION_IMAGE_URI="${ECR_URI}:${IMAGE_TAG}"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

aws apprunner describe-service --region "$REGION" --service-arn "$SERVICE_ARN" \
  --query 'Service.SourceConfiguration' --output json >"${TEMP_DIR}/current-source.json"

write_source_configuration() {
  local image_uri="$1"
  local output_file="$2"
  python3 - "${TEMP_DIR}/current-source.json" "$image_uri" "$output_file" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source_file:
    configuration = json.load(source_file)

configuration["ImageRepository"]["ImageIdentifier"] = sys.argv[2]
with open(sys.argv[3], "w", encoding="utf-8") as output_file:
    json.dump(configuration, output_file)
PY
}

write_source_configuration "$INITIALIZER_IMAGE_URI" "${TEMP_DIR}/initializer-source.json"
write_source_configuration "$APPLICATION_IMAGE_URI" "${TEMP_DIR}/application-source.json"

echo "Building and pushing the migration and application images..."
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ECR_REGISTRY"
docker build --platform linux/amd64 --file Dockerfile.migration --tag "$INITIALIZER_IMAGE_URI" .
docker build --platform linux/amd64 --tag "$APPLICATION_IMAGE_URI" .
docker push "$INITIALIZER_IMAGE_URI"
docker push "$APPLICATION_IMAGE_URI"

echo "Applying checked-in migrations through the existing service..."
aws apprunner update-service --region "$REGION" --service-arn "$SERVICE_ARN" \
  --source-configuration "file://${TEMP_DIR}/initializer-source.json" \
  --query 'Operation.{Id:Id,Status:Status,Type:Type}' --output table
wait_for_running "Migration revision"

echo "Switching the existing service back to the normal application image..."
aws apprunner update-service --region "$REGION" --service-arn "$SERVICE_ARN" \
  --source-configuration "file://${TEMP_DIR}/application-source.json" \
  --query 'Operation.{Id:Id,Status:Status,Type:Type}' --output table
wait_for_running "Application revision"

SERVICE_URL="$(aws apprunner describe-service --region "$REGION" --service-arn "$SERVICE_ARN" --query 'Service.ServiceUrl' --output text)"
curl --fail --silent --show-error --max-time 20 "${SERVICE_URL%/}/health"
echo
echo "Release complete: ${SERVICE_URL}"
echo "The private administrator account and existing database records were retained."
