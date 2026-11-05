#!/usr/bin/env bash
set -Eeuo pipefail

# Applies the checked-in database migrations through a temporary App Runner service,
# then updates the active Architecture Master Roadmap service. It preserves the
# current private RDS, VPC connector, runtime secrets, no-NAT routes, and EC2 fallback.
REGION="${AWS_REGION:-us-east-1}"
SERVICE_ARN="${SERVICE_ARN:-arn:aws:apprunner:us-east-1:026090547003:service/architecture-master-roadmap-apprunner/f43b0266b6e8460fb58218fd59c343fe}"
REPOSITORY="${REPOSITORY:-architecture-master-roadmap}"
MIGRATION_SERVICE_NAME="${MIGRATION_SERVICE_NAME:-amr-db-migrate-$(date -u +%Y%m%d%H%M%S)}"
WAIT_ATTEMPTS="${WAIT_ATTEMPTS:-90}"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Required command not found: $1" >&2
    exit 1
  }
}

wait_for_running() {
  local service_arn="$1"
  local label="$2"
  local status
  for _ in $(seq 1 "$WAIT_ATTEMPTS"); do
    status="$(aws apprunner describe-service --region "$REGION" --service-arn "$service_arn" --query 'Service.Status' --output text)"
    case "$status" in
      RUNNING)
        echo "${label} is RUNNING."
        return 0
        ;;
      CREATE_FAILED|UPDATE_FAILED|DELETE_FAILED)
        echo "${label} ended in state ${status}. The temporary service was retained for log inspection." >&2
        return 1
        ;;
      *)
        echo "${label} status: ${status}"
        sleep 10
        ;;
    esac
  done
  echo "Timed out waiting for ${label}. The temporary service was retained for inspection." >&2
  return 1
}

for command in aws docker jq curl date mktemp; do
  require_command "$command"
done

[[ -f Dockerfile.migration ]] || { echo "Dockerfile.migration is missing." >&2; exit 1; }
[[ -f drizzle/0006_sloppy_thor_girl.sql ]] || { echo "The direct-SAR migration is missing." >&2; exit 1; }
grep -Fq 'SET `amountUsdM` = 0' drizzle/0006_sloppy_thor_girl.sql || {
  echo "The direct-SAR migration does not contain the approved zero-value baseline." >&2
  exit 1
}

aws sts get-caller-identity --region "$REGION" >/dev/null
CURRENT_STATUS="$(aws apprunner describe-service --region "$REGION" --service-arn "$SERVICE_ARN" --query 'Service.Status' --output text)"
[[ "$CURRENT_STATUS" == "RUNNING" ]] || {
  echo "The active service must be RUNNING before release. Current status: ${CURRENT_STATUS}" >&2
  exit 1
}

if aws apprunner list-services --region "$REGION" --query "ServiceSummaryList[?ServiceName=='${MIGRATION_SERVICE_NAME}'].ServiceArn | [0]" --output text | grep -qv '^None$'; then
  echo "A migration service named ${MIGRATION_SERVICE_NAME} already exists. Choose another MIGRATION_SERVICE_NAME." >&2
  exit 1
fi

cat <<'NOTICE'
This guarded release will:
  1. Build and push a temporary migration image and the new application image.
  2. Create a short-lived App Runner migration service using the active service's
     existing private RDS connector, runtime-secret mappings, and instance role.
  3. Apply the checked-in 0005 Shared Strategic Objectives and 0006 direct-SAR migrations.
  4. Update the active App Runner service only after the migration service is healthy.
  5. Verify the public /health endpoint, then delete the temporary migration service.

It does not create or modify a NAT Gateway, VPC, subnets, RDS instance, security groups,
runtime secret values, or the EC2 fallback host. The 0006 migration resets legacy dummy
financial values to zero before converting the stored field to direct SAR millions.
NOTICE
read -r -p "Type RELEASE_DIRECT_SAR_TO_APP_RUNNER to continue: " CONFIRMATION
[[ "$CONFIRMATION" == "RELEASE_DIRECT_SAR_TO_APP_RUNNER" ]] || {
  echo "Confirmation did not match. No AWS resources were changed."
  exit 1
}

ACCOUNT_ID="$(aws sts get-caller-identity --region "$REGION" --query Account --output text)"
ECR_REGISTRY="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
ECR_URI="${ECR_REGISTRY}/${REPOSITORY}"
RELEASE_TAG="direct-sar-$(date -u +%Y%m%d%H%M%S)"
MIGRATION_IMAGE_URI="${ECR_URI}:${RELEASE_TAG}-migrate"
APPLICATION_IMAGE_URI="${ECR_URI}:${RELEASE_TAG}"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

SOURCE_CONFIGURATION_FILE="${TEMP_DIR}/source-configuration.json"
MIGRATION_SOURCE_CONFIGURATION_FILE="${TEMP_DIR}/migration-source-configuration.json"
INSTANCE_CONFIGURATION_FILE="${TEMP_DIR}/instance-configuration.json"
NETWORK_CONFIGURATION_FILE="${TEMP_DIR}/network-configuration.json"
HEALTH_CHECK_CONFIGURATION_FILE="${TEMP_DIR}/health-check-configuration.json"

aws ecr describe-repositories --region "$REGION" --repository-names "$REPOSITORY" >/dev/null
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ECR_REGISTRY"
docker build --platform linux/amd64 --file Dockerfile.migration --tag "$MIGRATION_IMAGE_URI" .
docker build --platform linux/amd64 --tag "$APPLICATION_IMAGE_URI" .
docker push "$MIGRATION_IMAGE_URI"
docker push "$APPLICATION_IMAGE_URI"

aws apprunner describe-service --region "$REGION" --service-arn "$SERVICE_ARN" --query 'Service.SourceConfiguration' --output json > "$SOURCE_CONFIGURATION_FILE"
aws apprunner describe-service --region "$REGION" --service-arn "$SERVICE_ARN" --query 'Service.InstanceConfiguration' --output json > "$INSTANCE_CONFIGURATION_FILE"
aws apprunner describe-service --region "$REGION" --service-arn "$SERVICE_ARN" --query 'Service.NetworkConfiguration' --output json > "$NETWORK_CONFIGURATION_FILE"
aws apprunner describe-service --region "$REGION" --service-arn "$SERVICE_ARN" --query 'Service.HealthCheckConfiguration' --output json > "$HEALTH_CHECK_CONFIGURATION_FILE"

jq --arg image "$MIGRATION_IMAGE_URI" \
  '.AutoDeploymentsEnabled = false | .ImageRepository.ImageIdentifier = $image' \
  "$SOURCE_CONFIGURATION_FILE" > "$MIGRATION_SOURCE_CONFIGURATION_FILE"

MIGRATION_SERVICE_ARN="$(aws apprunner create-service \
  --region "$REGION" \
  --service-name "$MIGRATION_SERVICE_NAME" \
  --source-configuration "file://${MIGRATION_SOURCE_CONFIGURATION_FILE}" \
  --instance-configuration "file://${INSTANCE_CONFIGURATION_FILE}" \
  --network-configuration "file://${NETWORK_CONFIGURATION_FILE}" \
  --health-check-configuration "file://${HEALTH_CHECK_CONFIGURATION_FILE}" \
  --query 'Service.ServiceArn' \
  --output text)"

wait_for_running "$MIGRATION_SERVICE_ARN" "Temporary migration service"

SERVICE_URL="$(aws apprunner describe-service --region "$REGION" --service-arn "$SERVICE_ARN" --query 'Service.ServiceUrl' --output text)"
jq --arg image "$APPLICATION_IMAGE_URI" \
  '.AutoDeploymentsEnabled = false | .ImageRepository.ImageIdentifier = $image' \
  "$SOURCE_CONFIGURATION_FILE" > "${TEMP_DIR}/application-source-configuration.json"

aws apprunner update-service \
  --region "$REGION" \
  --service-arn "$SERVICE_ARN" \
  --source-configuration "file://${TEMP_DIR}/application-source-configuration.json" \
  --query 'Operation.{Id:Id,Status:Status,Type:Type}' \
  --output table

wait_for_running "$SERVICE_ARN" "Active Architecture Master Roadmap service"
curl --fail --silent --show-error --max-time 20 "${SERVICE_URL%/}/health"
echo

aws apprunner delete-service --region "$REGION" --service-arn "$MIGRATION_SERVICE_ARN" --query 'Operation.{Id:Id,Status:Status,Type:Type}' --output table
echo "Release complete. The active service is available at ${SERVICE_URL}. The temporary migration service is deleting."
