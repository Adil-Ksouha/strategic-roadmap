#!/usr/bin/env bash
set -Eeuo pipefail

# Rebuilds the existing failed App Runner service. The CLI requires a complete
# configuration payload even when the intended configuration is unchanged.
REGION="${AWS_REGION:-us-east-1}"
SERVICE_ARN="${SERVICE_ARN:-arn:aws:apprunner:us-east-1:026090547003:service/northstar-private-auth/86f18a0a63d94e8db60ee19593421998}"
CONFIG_SNAPSHOT="${CONFIG_SNAPSHOT:-${HOME}/.northstar-app-runner-replacement.env}"
BOOTSTRAP_SECRET_NAME="${BOOTSTRAP_SECRET_NAME:-northstar/local-auth-bootstrap-token}"

command -v aws >/dev/null 2>&1 || { echo "Required command not found: aws" >&2; exit 1; }
[[ -r "$CONFIG_SNAPSHOT" ]] || { echo "Missing configuration snapshot: $CONFIG_SNAPSHOT" >&2; exit 1; }
# shellcheck source=/dev/null
source "$CONFIG_SNAPSHOT"

for value_name in DATABASE_URL_ARN JWT_SECRET_ARN ECR_ACCESS_ROLE_ARN VPC_CONNECTOR_ARN; do
  value="${!value_name:-}"
  [[ -n "$value" && "$value" != "None" ]] || { echo "Missing ${value_name} in snapshot." >&2; exit 1; }
done

IMAGE_URI="$(aws apprunner describe-service --region "$REGION" --service-arn "$SERVICE_ARN" --query 'Service.SourceConfiguration.ImageRepository.ImageIdentifier' --output text)"
BOOTSTRAP_SECRET_ARN="$(aws secretsmanager describe-secret --region "$REGION" --secret-id "$BOOTSTRAP_SECRET_NAME" --query ARN --output text)"
TEMP_DIR="$(mktemp -d)"
SOURCE_CONFIG_FILE="${TEMP_DIR}/source-configuration.json"
INSTANCE_CONFIG_FILE="${TEMP_DIR}/instance-configuration.json"
NETWORK_CONFIG_FILE="${TEMP_DIR}/network-configuration.json"
HEALTH_CONFIG_FILE="${TEMP_DIR}/health-check-configuration.json"
trap 'rm -rf "$TEMP_DIR"' EXIT

cat > "$SOURCE_CONFIG_FILE" <<EOF
{
  "AuthenticationConfiguration": { "AccessRoleArn": "${ECR_ACCESS_ROLE_ARN}" },
  "AutoDeploymentsEnabled": false,
  "ImageRepository": {
    "ImageIdentifier": "${IMAGE_URI}",
    "ImageRepositoryType": "ECR",
    "ImageConfiguration": {
      "Port": "8080",
      "RuntimeEnvironmentVariables": { "NODE_ENV": "production", "VITE_APP_ID": "northstar" },
      "RuntimeEnvironmentSecrets": {
        "DATABASE_URL": "${DATABASE_URL_ARN}",
        "JWT_SECRET": "${JWT_SECRET_ARN}",
        "LOCAL_AUTH_BOOTSTRAP_TOKEN": "${BOOTSTRAP_SECRET_ARN}"
      }
    }
  }
}
EOF
cat > "$INSTANCE_CONFIG_FILE" <<EOF
{ "Cpu": "1 vCPU", "Memory": "2 GB", "InstanceRoleArn": "${INSTANCE_ROLE_ARN}" }
EOF
cat > "$NETWORK_CONFIG_FILE" <<EOF
{
  "EgressConfiguration": { "EgressType": "VPC", "VpcConnectorArn": "${VPC_CONNECTOR_ARN}" },
  "IngressConfiguration": { "IsPubliclyAccessible": true },
  "IpAddressType": "IPV4"
}
EOF
cat > "$HEALTH_CONFIG_FILE" <<'EOF'
{ "Protocol": "TCP", "Interval": 5, "Timeout": 2, "HealthyThreshold": 1, "UnhealthyThreshold": 5 }
EOF

ARGS=(
  --region "$REGION"
  --service-arn "$SERVICE_ARN"
  --source-configuration "file://${SOURCE_CONFIG_FILE}"
  --instance-configuration "file://${INSTANCE_CONFIG_FILE}"
  --network-configuration "file://${NETWORK_CONFIG_FILE}"
  --health-check-configuration "file://${HEALTH_CONFIG_FILE}"
)
if [[ -n "${AUTO_SCALING_ARN:-}" && "$AUTO_SCALING_ARN" != "None" ]]; then
  ARGS+=(--auto-scaling-configuration-arn "$AUTO_SCALING_ARN")
fi

aws apprunner update-service "${ARGS[@]}" --query 'Operation.{Id:Id,Status:Status,Type:Type}' --output table
echo "Rebuild requested. Monitor with: aws apprunner describe-service --region ${REGION} --service-arn ${SERVICE_ARN} --query Service.Status --output text"
