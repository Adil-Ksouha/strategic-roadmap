#!/usr/bin/env bash
set -Eeuo pipefail

# Deploys the Shared Strategic Objectives and team-allocation release to the
# existing App Runner workload. A short-lived parallel App Runner service first
# applies the reviewed migrations to the same private RDS database, then the
# primary workload image is updated. The EC2 fallback, RDS network topology,
# VPC connector, security groups, and routes are not changed.
REGION="${AWS_REGION:-us-east-1}"
SERVICE_ARN="arn:aws:apprunner:us-east-1:026090547003:service/architecture-master-roadmap-apprunner/f43b0266b6e8460fb58218fd59c343fe"
REPOSITORY="architecture-master-roadmap"

for command in aws docker mktemp; do
  command -v "$command" >/dev/null 2>&1 || { echo "Required command not found: $command" >&2; exit 1; }
done
aws sts get-caller-identity --region "$REGION" >/dev/null

CURRENT_STATUS="$(aws apprunner describe-service --region "$REGION" --service-arn "$SERVICE_ARN" --query 'Service.Status' --output text)"
[[ "$CURRENT_STATUS" == "RUNNING" ]] || { echo "The primary App Runner service must be RUNNING; current state: ${CURRENT_STATUS}." >&2; exit 1; }

cat <<'NOTICE'
This performs a controlled Shared Strategic Objectives and team-allocation release:
  1. Build and push a temporary migration image and the new application image.
  2. Create a short-lived migration App Runner service using the existing RDS connector.
  3. Wait for that service to run, proving the reviewed migrations completed.
  4. Update the active App Runner service to the new application image and wait for it to be RUNNING.
  5. Verify the public /health endpoint, then delete the short-lived migration service.

The existing RDS database, VPC connector, security groups, routes, secrets,
and EC2 fallback host are not modified or removed.
NOTICE
read -r -p "Type APPLY_AMR_TEAM_ALLOCATION_RELEASE to continue: " CONFIRMATION
[[ "$CONFIRMATION" == "APPLY_AMR_TEAM_ALLOCATION_RELEASE" ]] || { echo "Confirmation did not match. No resources were changed."; exit 1; }

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
ECR_REGISTRY="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
ECR_URI="${ECR_REGISTRY}/${REPOSITORY}"
STAMP="$(date -u +%Y%m%d%H%M%S)"
MIGRATION_IMAGE="${ECR_URI}:team-allocation-migration-${STAMP}"
APPLICATION_IMAGE="${ECR_URI}:team-allocation-${STAMP}"
MIGRATION_SERVICE_NAME="amr-alloc-migrate-${STAMP}"
TEMP_DIR="$(mktemp -d)"
MIGRATION_SERVICE_ARN=""
cleanup() {
  if [[ -n "$MIGRATION_SERVICE_ARN" ]]; then
    aws apprunner delete-service --region "$REGION" --service-arn "$MIGRATION_SERVICE_ARN" >/dev/null 2>&1 || true
  fi
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

ECR_ACCESS_ROLE_ARN="$(aws apprunner describe-service --region "$REGION" --service-arn "$SERVICE_ARN" --query 'Service.SourceConfiguration.AuthenticationConfiguration.AccessRoleArn' --output text)"
INSTANCE_ROLE_ARN="$(aws apprunner describe-service --region "$REGION" --service-arn "$SERVICE_ARN" --query 'Service.InstanceConfiguration.InstanceRoleArn' --output text)"
VPC_CONNECTOR_ARN="$(aws apprunner describe-service --region "$REGION" --service-arn "$SERVICE_ARN" --query 'Service.NetworkConfiguration.EgressConfiguration.VpcConnectorArn' --output text)"
DATABASE_SECRET_ARN="$(aws apprunner describe-service --region "$REGION" --service-arn "$SERVICE_ARN" --query 'Service.SourceConfiguration.ImageRepository.ImageConfiguration.RuntimeEnvironmentSecrets.DATABASE_URL' --output text)"
JWT_SECRET_ARN="$(aws apprunner describe-service --region "$REGION" --service-arn "$SERVICE_ARN" --query 'Service.SourceConfiguration.ImageRepository.ImageConfiguration.RuntimeEnvironmentSecrets.JWT_SECRET' --output text)"
BOOTSTRAP_SECRET_ARN="$(aws apprunner describe-service --region "$REGION" --service-arn "$SERVICE_ARN" --query 'Service.SourceConfiguration.ImageRepository.ImageConfiguration.RuntimeEnvironmentSecrets.LOCAL_AUTH_BOOTSTRAP_TOKEN' --output text)"
for value in "$ECR_ACCESS_ROLE_ARN" "$INSTANCE_ROLE_ARN" "$VPC_CONNECTOR_ARN" "$DATABASE_SECRET_ARN" "$JWT_SECRET_ARN" "$BOOTSTRAP_SECRET_ARN"; do
  [[ -n "$value" && "$value" != "None" ]] || { echo "An existing App Runner runtime reference could not be read. No deployment was started." >&2; exit 1; }
done

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ECR_REGISTRY"
docker build --platform linux/amd64 --file Dockerfile.migration --tag "$MIGRATION_IMAGE" .
docker push "$MIGRATION_IMAGE"
docker build --platform linux/amd64 --file Dockerfile --tag "$APPLICATION_IMAGE" .
docker push "$APPLICATION_IMAGE"

write_source_configuration() {
  local image="$1"
  cat >"${TEMP_DIR}/source-configuration.json" <<EOF
{
  "AuthenticationConfiguration": { "AccessRoleArn": "${ECR_ACCESS_ROLE_ARN}" },
  "AutoDeploymentsEnabled": false,
  "ImageRepository": {
    "ImageIdentifier": "${image}",
    "ImageRepositoryType": "ECR",
    "ImageConfiguration": {
      "Port": "8080",
      "RuntimeEnvironmentVariables": { "NODE_ENV": "production" },
      "RuntimeEnvironmentSecrets": {
        "DATABASE_URL": "${DATABASE_SECRET_ARN}",
        "JWT_SECRET": "${JWT_SECRET_ARN}",
        "LOCAL_AUTH_BOOTSTRAP_TOKEN": "${BOOTSTRAP_SECRET_ARN}"
      }
    }
  }
}
EOF
}

cat >"${TEMP_DIR}/instance-configuration.json" <<EOF
{ "Cpu": "1 vCPU", "Memory": "2 GB", "InstanceRoleArn": "${INSTANCE_ROLE_ARN}" }
EOF
cat >"${TEMP_DIR}/network-configuration.json" <<EOF
{
  "EgressConfiguration": { "EgressType": "VPC", "VpcConnectorArn": "${VPC_CONNECTOR_ARN}" },
  "IngressConfiguration": { "IsPubliclyAccessible": true },
  "IpAddressType": "IPV4"
}
EOF
cat >"${TEMP_DIR}/health-check-configuration.json" <<'EOF'
{ "Protocol": "HTTP", "Path": "/health", "Interval": 10, "Timeout": 5, "HealthyThreshold": 1, "UnhealthyThreshold": 5 }
EOF

write_source_configuration "$MIGRATION_IMAGE"
MIGRATION_SERVICE_ARN="$(aws apprunner create-service \
  --region "$REGION" \
  --service-name "$MIGRATION_SERVICE_NAME" \
  --source-configuration "file://${TEMP_DIR}/source-configuration.json" \
  --instance-configuration "file://${TEMP_DIR}/instance-configuration.json" \
  --network-configuration "file://${TEMP_DIR}/network-configuration.json" \
  --health-check-configuration "file://${TEMP_DIR}/health-check-configuration.json" \
  --query 'Service.ServiceArn' --output text)"

for _ in $(seq 1 90); do
  STATUS="$(aws apprunner describe-service --region "$REGION" --service-arn "$MIGRATION_SERVICE_ARN" --query 'Service.Status' --output text)"
  [[ "$STATUS" == "RUNNING" ]] && break
  [[ "$STATUS" == "CREATE_FAILED" || "$STATUS" == "DELETE_FAILED" ]] && { echo "Migration service ended in state ${STATUS}. The primary service remains unchanged." >&2; exit 1; }
  sleep 10
done
[[ "${STATUS:-}" == "RUNNING" ]] || { echo "Timed out waiting for the migration service. The primary service remains unchanged." >&2; exit 1; }

write_source_configuration "$APPLICATION_IMAGE"
UPDATE_OPERATION_ID="$(aws apprunner update-service \
  --region "$REGION" \
  --service-arn "$SERVICE_ARN" \
  --source-configuration "file://${TEMP_DIR}/source-configuration.json" \
  --query 'Operation.Id' \
  --output text)"

echo "Primary-service update requested: ${UPDATE_OPERATION_ID}"
for _ in $(seq 1 90); do
  STATUS="$(aws apprunner describe-service --region "$REGION" --service-arn "$SERVICE_ARN" --query 'Service.Status' --output text)"
  [[ "$STATUS" == "RUNNING" ]] && break
  [[ "$STATUS" == "CREATE_FAILED" || "$STATUS" == "UPDATE_FAILED" || "$STATUS" == "DELETE_FAILED" ]] && { echo "Primary service ended in state ${STATUS}. The migration completed, but the active workload was not updated successfully." >&2; exit 1; }
  sleep 10
done
[[ "${STATUS:-}" == "RUNNING" ]] || { echo "Timed out waiting for the primary service. Check App Runner events before retrying." >&2; exit 1; }

SERVICE_URL="$(aws apprunner describe-service --region "$REGION" --service-arn "$SERVICE_ARN" --query 'Service.ServiceUrl' --output text)"
curl --fail --silent --show-error --max-time 30 "https://${SERVICE_URL}/health" >/dev/null

echo "Release succeeded. The active service is RUNNING and /health responded successfully. Verify private sign-in plus team and administrator roadmap views before retiring the EC2 fallback."
