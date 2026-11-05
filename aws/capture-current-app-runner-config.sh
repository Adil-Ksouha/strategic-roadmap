#!/usr/bin/env bash
set -Eeuo pipefail

# Read-only capture for a service that will be replaced. It intentionally stores
# only resource ARNs, never secret values.
REGION="${AWS_REGION:-us-east-1}"
CURRENT_SERVICE_ARN="${CURRENT_SERVICE_ARN:-arn:aws:apprunner:us-east-1:026090547003:service/northstar/47926377857b4937b86ccc8982dcd89a}"
SNAPSHOT_FILE="${CONFIG_SNAPSHOT:-${HOME}/.northstar-app-runner-replacement.env}"

command -v aws >/dev/null 2>&1 || { echo "Required command not found: aws" >&2; exit 1; }
umask 077
{
  printf 'DATABASE_URL_ARN=%q\n' "$(aws apprunner describe-service --region "$REGION" --service-arn "$CURRENT_SERVICE_ARN" --query 'Service.SourceConfiguration.ImageRepository.ImageConfiguration.RuntimeEnvironmentSecrets.DATABASE_URL' --output text)"
  printf 'JWT_SECRET_ARN=%q\n' "$(aws apprunner describe-service --region "$REGION" --service-arn "$CURRENT_SERVICE_ARN" --query 'Service.SourceConfiguration.ImageRepository.ImageConfiguration.RuntimeEnvironmentSecrets.JWT_SECRET' --output text)"
  printf 'ECR_ACCESS_ROLE_ARN=%q\n' "$(aws apprunner describe-service --region "$REGION" --service-arn "$CURRENT_SERVICE_ARN" --query 'Service.SourceConfiguration.AuthenticationConfiguration.AccessRoleArn' --output text)"
  printf 'VPC_CONNECTOR_ARN=%q\n' "$(aws apprunner describe-service --region "$REGION" --service-arn "$CURRENT_SERVICE_ARN" --query 'Service.NetworkConfiguration.EgressConfiguration.VpcConnectorArn' --output text)"
  printf 'INSTANCE_ROLE_ARN=%q\n' "$(aws apprunner describe-service --region "$REGION" --service-arn "$CURRENT_SERVICE_ARN" --query 'Service.InstanceConfiguration.InstanceRoleArn' --output text)"
  printf 'AUTO_SCALING_ARN=%q\n' "$(aws apprunner describe-service --region "$REGION" --service-arn "$CURRENT_SERVICE_ARN" --query 'Service.AutoScalingConfigurationSummary.AutoScalingConfigurationArn' --output text)"
} > "$SNAPSHOT_FILE"

if grep -Eq '(^|=)(None|)$' "$SNAPSHOT_FILE"; then
  echo "A required configuration value was unavailable. The snapshot was retained for review, but replacement creation should not proceed." >&2
  exit 1
fi
echo "Configuration snapshot saved at ${SNAPSHOT_FILE}. It contains resource ARNs only, not secret values."
