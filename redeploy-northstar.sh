#!/usr/bin/env bash
set -euo pipefail

# Rebuilds the current Northstar source and updates the existing App Runner service.
# It reuses the ECR repository, service configuration, VPC connector, RDS instance,
# and secrets that were established during the initial deployment.

APP_NAME="northstar"
REGION="${AWS_REGION:-us-east-1}"

for command in aws docker jq; do command -v "$command" >/dev/null || { echo "Required command not found: $command" >&2; exit 1; }; done

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${APP_NAME}"
SERVICE_ARN="$(aws apprunner list-services --query "ServiceSummaryList[?ServiceName=='${APP_NAME}'].ServiceArn | [0]" --output text --region "$REGION")"
[[ "$SERVICE_ARN" != "None" && -n "$SERVICE_ARN" ]] || { echo "The existing Northstar App Runner service was not found." >&2; exit 1; }

read -r -p "Northstar executive administrator Gmail: " PLATFORM_ADMIN_EMAIL
PLATFORM_ADMIN_EMAIL="$(printf '%s' "$PLATFORM_ADMIN_EMAIL" | tr '[:upper:]' '[:lower:]' | xargs)"
[[ "$PLATFORM_ADMIN_EMAIL" == *"@"* ]] || { echo "A valid executive administrator Gmail is required." >&2; exit 1; }

if aws secretsmanager describe-secret --secret-id "${APP_NAME}/platform-admin-email" --region "$REGION" >/dev/null 2>&1; then
  aws secretsmanager put-secret-value --secret-id "${APP_NAME}/platform-admin-email" --secret-string "$PLATFORM_ADMIN_EMAIL" --region "$REGION" >/dev/null
else
  aws secretsmanager create-secret --name "${APP_NAME}/platform-admin-email" --secret-string "$PLATFORM_ADMIN_EMAIL" --region "$REGION" >/dev/null
fi
PLATFORM_ADMIN_EMAIL_ARN="$(aws secretsmanager describe-secret --secret-id "${APP_NAME}/platform-admin-email" --query ARN --output text --region "$REGION")"

ASSET_URL="https://${APP_NAME}-assets-${ACCOUNT_ID}-${REGION}.s3.${REGION}.amazonaws.com/telecom-cloud-network.jpg"
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
IMAGE_TAG="$(date +%Y%m%d%H%M%S)"
docker build --build-arg "VITE_NETWORK_ARTWORK_URL=${ASSET_URL}" -t "${ECR_URI}:${IMAGE_TAG}" -t "${ECR_URI}:latest" .
docker push "${ECR_URI}:${IMAGE_TAG}"
docker push "${ECR_URI}:latest"

aws apprunner describe-service --service-arn "$SERVICE_ARN" --query 'Service.SourceConfiguration' --output json --region "$REGION" | jq --arg image "${ECR_URI}:${IMAGE_TAG}" --arg adminSecret "$PLATFORM_ADMIN_EMAIL_ARN" '.ImageRepository.ImageIdentifier = $image | .ImageRepository.ImageConfiguration.RuntimeEnvironmentSecrets.PLATFORM_ADMIN_EMAIL = $adminSecret' > /tmp/${APP_NAME}-redeploy-source.json
aws apprunner update-service --service-arn "$SERVICE_ARN" --source-configuration file:///tmp/${APP_NAME}-redeploy-source.json --region "$REGION" >/dev/null

echo "Waiting for the updated Northstar service..."
until [[ "$(aws apprunner describe-service --service-arn "$SERVICE_ARN" --query 'Service.Status' --output text --region "$REGION")" == "RUNNING" ]]; do sleep 15; done
aws apprunner describe-service --service-arn "$SERVICE_ARN" --query 'Service.ServiceUrl' --output text --region "$REGION"
