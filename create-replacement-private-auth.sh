#!/usr/bin/env bash
set -Eeuo pipefail

# Creates a replacement App Runner service for the private account release.
# It reads configuration from a pre-deletion snapshot when available, preserving
# private RDS connectivity after the current service has been deleted.
REGION="${AWS_REGION:-us-east-1}"
CURRENT_SERVICE_ARN="${CURRENT_SERVICE_ARN:-arn:aws:apprunner:us-east-1:026090547003:service/northstar/47926377857b4937b86ccc8982dcd89a}"
REPOSITORY="${REPOSITORY:-northstar}"
NEW_SERVICE_NAME="${NEW_SERVICE_NAME:-northstar-private-auth}"
BOOTSTRAP_SECRET_NAME="${BOOTSTRAP_SECRET_NAME:-northstar/local-auth-bootstrap-token}"
CONFIG_SNAPSHOT="${CONFIG_SNAPSHOT:-${HOME}/.northstar-app-runner-replacement.env}"

require_command() {
  command -v "$1" >/dev/null 2>&1 || { echo "Required command not found: $1" >&2; exit 1; }
}

for command in aws docker date mktemp; do require_command "$command"; done
aws sts get-caller-identity --region "$REGION" >/dev/null

if [[ -r "$CONFIG_SNAPSHOT" ]]; then
  # shellcheck source=/dev/null
  source "$CONFIG_SNAPSHOT"
  echo "Using the captured pre-deletion App Runner configuration from ${CONFIG_SNAPSHOT}."
else
  DATABASE_URL_ARN="$(aws apprunner describe-service --region "$REGION" --service-arn "$CURRENT_SERVICE_ARN" --query 'Service.SourceConfiguration.ImageRepository.ImageConfiguration.RuntimeEnvironmentSecrets.DATABASE_URL' --output text)"
  JWT_SECRET_ARN="$(aws apprunner describe-service --region "$REGION" --service-arn "$CURRENT_SERVICE_ARN" --query 'Service.SourceConfiguration.ImageRepository.ImageConfiguration.RuntimeEnvironmentSecrets.JWT_SECRET' --output text)"
  ECR_ACCESS_ROLE_ARN="$(aws apprunner describe-service --region "$REGION" --service-arn "$CURRENT_SERVICE_ARN" --query 'Service.SourceConfiguration.AuthenticationConfiguration.AccessRoleArn' --output text)"
  VPC_CONNECTOR_ARN="$(aws apprunner describe-service --region "$REGION" --service-arn "$CURRENT_SERVICE_ARN" --query 'Service.NetworkConfiguration.EgressConfiguration.VpcConnectorArn' --output text)"
  INSTANCE_ROLE_ARN="$(aws apprunner describe-service --region "$REGION" --service-arn "$CURRENT_SERVICE_ARN" --query 'Service.InstanceConfiguration.InstanceRoleArn' --output text)"
  AUTO_SCALING_ARN="$(aws apprunner describe-service --region "$REGION" --service-arn "$CURRENT_SERVICE_ARN" --query 'Service.AutoScalingConfigurationSummary.AutoScalingConfigurationArn' --output text)"
fi

if aws apprunner list-services --region "$REGION" --query "ServiceSummaryList[?ServiceName=='${NEW_SERVICE_NAME}'].ServiceArn" --output text | grep -q .; then
  echo "An App Runner service named ${NEW_SERVICE_NAME} already exists. Choose a unique NEW_SERVICE_NAME before running this script." >&2
  exit 1
fi

TEMP_DIR="$(mktemp -d)"
TOKEN_FILE="${TEMP_DIR}/bootstrap-token"
SOURCE_CONFIG_FILE="${TEMP_DIR}/source-configuration.json"
INSTANCE_CONFIG_FILE="${TEMP_DIR}/instance-configuration.json"
NETWORK_CONFIG_FILE="${TEMP_DIR}/network-configuration.json"
HEALTH_CONFIG_FILE="${TEMP_DIR}/health-check-configuration.json"
trap 'rm -rf "$TEMP_DIR"' EXIT

echo "The replacement will reuse the existing private VPC connector and has no NAT route."
read -r -s -p "Enter the existing LOCAL_AUTH_BOOTSTRAP_TOKEN (input is hidden): " BOOTSTRAP_TOKEN
echo
if [[ -z "$BOOTSTRAP_TOKEN" ]]; then
  echo "No bootstrap token was entered. Replacement creation stopped." >&2
  exit 1
fi
umask 077
printf '%s' "$BOOTSTRAP_TOKEN" > "$TOKEN_FILE"
unset BOOTSTRAP_TOKEN

if aws secretsmanager describe-secret --region "$REGION" --secret-id "$BOOTSTRAP_SECRET_NAME" >/dev/null 2>&1; then
  aws secretsmanager put-secret-value --region "$REGION" --secret-id "$BOOTSTRAP_SECRET_NAME" --secret-string "file://${TOKEN_FILE}" >/dev/null
else
  aws secretsmanager create-secret --region "$REGION" --name "$BOOTSTRAP_SECRET_NAME" --secret-string "file://${TOKEN_FILE}" >/dev/null
fi

ACCOUNT_ID="$(aws sts get-caller-identity --region "$REGION" --query Account --output text)"
IMAGE_TAG="private-auth-replacement-$(date -u +%Y%m%d%H%M%S)"
IMAGE_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${REPOSITORY}:${IMAGE_TAG}"
BOOTSTRAP_SECRET_ARN="$(aws secretsmanager describe-secret --region "$REGION" --secret-id "$BOOTSTRAP_SECRET_NAME" --query ARN --output text)"

for value_name in DATABASE_URL_ARN JWT_SECRET_ARN ECR_ACCESS_ROLE_ARN VPC_CONNECTOR_ARN; do
  value="${!value_name}"
  if [[ -z "$value" || "$value" == "None" ]]; then
    echo "Could not read required ${value_name} from the current service. Replacement creation stopped." >&2
    exit 1
  fi
done

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
docker build --platform linux/amd64 --tag "$IMAGE_URI" .
docker push "$IMAGE_URI"

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

CREATE_ARGS=(
  --region "$REGION"
  --service-name "$NEW_SERVICE_NAME"
  --source-configuration "file://${SOURCE_CONFIG_FILE}"
  --instance-configuration "file://${INSTANCE_CONFIG_FILE}"
  --network-configuration "file://${NETWORK_CONFIG_FILE}"
  --health-check-configuration "file://${HEALTH_CONFIG_FILE}"
)
if [[ -n "$AUTO_SCALING_ARN" && "$AUTO_SCALING_ARN" != "None" ]]; then
  CREATE_ARGS+=(--auto-scaling-configuration-arn "$AUTO_SCALING_ARN")
fi

aws apprunner create-service "${CREATE_ARGS[@]}" --query 'Service.{ServiceArn:ServiceArn,ServiceUrl:ServiceUrl,Status:Status}' --output table
echo "Replacement requested. Wait for status RUNNING, then open the new ServiceUrl with /?setup=1 to create the first local administrator."
