#!/usr/bin/env bash
set -Eeuo pipefail

# Deploys Architecture Master Roadmap's private email/password release without
# altering the existing VPC connector, RDS instance, subnets, NAT Gateway, or service instance configuration.
REGION="${AWS_REGION:-us-east-1}"
SERVICE_ARN="${SERVICE_ARN:-arn:aws:apprunner:us-east-1:026090547003:service/northstar/47926377857b4937b86ccc8982dcd89a}"
SERVICE_URL="${SERVICE_URL:-https://pv2wet98bu.us-east-1.awsapprunner.com}"
REPOSITORY="${REPOSITORY:-northstar}"
BOOTSTRAP_SECRET_NAME="${BOOTSTRAP_SECRET_NAME:-northstar/local-auth-bootstrap-token}"

require_command() {
  command -v "$1" >/dev/null 2>&1 || { echo "Required command not found: $1" >&2; exit 1; }
}

for command in aws docker date mktemp; do require_command "$command"; done
aws sts get-caller-identity --region "$REGION" >/dev/null

ACCOUNT_ID="$(aws sts get-caller-identity --region "$REGION" --query Account --output text)"
IMAGE_TAG="private-auth-$(date -u +%Y%m%d%H%M%S)"
IMAGE_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${REPOSITORY}:${IMAGE_TAG}"
TEMP_DIR="$(mktemp -d)"
TOKEN_FILE="${TEMP_DIR}/bootstrap-token"
CONFIG_FILE="${TEMP_DIR}/source-configuration.json"
trap 'rm -rf "$TEMP_DIR"' EXIT

echo "This updates the existing App Runner image and runtime secret mapping only."
echo "It does not change the VPC connector, RDS database, subnets, route tables, or NAT Gateway."
read -r -s -p "Enter the existing LOCAL_AUTH_BOOTSTRAP_TOKEN (input is hidden): " BOOTSTRAP_TOKEN
echo
if [[ -z "$BOOTSTRAP_TOKEN" ]]; then
  echo "No bootstrap token was entered. Deployment stopped." >&2
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
BOOTSTRAP_SECRET_ARN="$(aws secretsmanager describe-secret --region "$REGION" --secret-id "$BOOTSTRAP_SECRET_NAME" --query ARN --output text)"

DATABASE_URL_ARN="$(aws apprunner describe-service --region "$REGION" --service-arn "$SERVICE_ARN" --query 'Service.SourceConfiguration.ImageRepository.ImageConfiguration.RuntimeEnvironmentSecrets.DATABASE_URL' --output text)"
JWT_SECRET_ARN="$(aws apprunner describe-service --region "$REGION" --service-arn "$SERVICE_ARN" --query 'Service.SourceConfiguration.ImageRepository.ImageConfiguration.RuntimeEnvironmentSecrets.JWT_SECRET' --output text)"
ECR_ACCESS_ROLE_ARN="$(aws apprunner describe-service --region "$REGION" --service-arn "$SERVICE_ARN" --query 'Service.SourceConfiguration.AuthenticationConfiguration.AccessRoleArn' --output text)"

if [[ -z "$DATABASE_URL_ARN" || "$DATABASE_URL_ARN" == "None" || -z "$JWT_SECRET_ARN" || "$JWT_SECRET_ARN" == "None" || -z "$ECR_ACCESS_ROLE_ARN" || "$ECR_ACCESS_ROLE_ARN" == "None" ]]; then
  echo "Could not read the existing database, JWT, or ECR-access configuration. Deployment stopped." >&2
  exit 1
fi

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
docker build --platform linux/amd64 --tag "$IMAGE_URI" .
docker push "$IMAGE_URI"

cat > "$CONFIG_FILE" <<EOF
{
  "AuthenticationConfiguration": {
    "AccessRoleArn": "${ECR_ACCESS_ROLE_ARN}"
  },
  "AutoDeploymentsEnabled": false,
  "ImageRepository": {
    "ImageIdentifier": "${IMAGE_URI}",
    "ImageRepositoryType": "ECR",
    "ImageConfiguration": {
      "Port": "8080",
      "RuntimeEnvironmentVariables": {
        "APP_BASE_URL": "${SERVICE_URL}",
        "NODE_ENV": "production",
        "VITE_APP_ID": "northstar"
      },
      "RuntimeEnvironmentSecrets": {
        "DATABASE_URL": "${DATABASE_URL_ARN}",
        "JWT_SECRET": "${JWT_SECRET_ARN}",
        "LOCAL_AUTH_BOOTSTRAP_TOKEN": "${BOOTSTRAP_SECRET_ARN}"
      }
    }
  }
}
EOF

aws apprunner update-service --region "$REGION" --service-arn "$SERVICE_ARN" --source-configuration "file://${CONFIG_FILE}" --query 'Operation.Status' --output text
echo "Deployment requested. Monitor progress with:"
echo "aws apprunner describe-service --region ${REGION} --service-arn ${SERVICE_ARN} --query 'Service.Status' --output text"
echo "After status is RUNNING, open ${SERVICE_URL}/?setup=1 to create the first private administrator."
