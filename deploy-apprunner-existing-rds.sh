#!/usr/bin/env bash
set -Eeuo pipefail

# Creates a clean App Runner service beside the existing EC2 fallback host.
# It reuses the current private RDS database and only adds the App Runner
# resources required for service-to-RDS connectivity. No NAT, VPC, RDS, or EC2
# resource is changed or removed.
REGION="${AWS_REGION:-us-east-1}"
VPC_ID="vpc-0cbb9dbb03493aeaf"
PRIVATE_SUBNET_A="subnet-006f73187d06bc890"
PRIVATE_SUBNET_B="subnet-052a19951bc944bb8"
RDS_SECURITY_GROUP="sg-0a9b2df72e2f664aa"
REPOSITORY="architecture-master-roadmap"
SERVICE_NAME="${SERVICE_NAME:-architecture-master-roadmap-apprunner}"
CONNECTOR_NAME="amr-apprunner-vpc"
CONNECTOR_SECURITY_GROUP_NAME="architecture-master-roadmap-apprunner-egress-sg"
ECR_ACCESS_ROLE_NAME="architecture-master-roadmap-apprunner-ecr-role"
INSTANCE_ROLE_NAME="architecture-master-roadmap-apprunner-instance-role"
DATABASE_SECRET_NAME="architecture-master-roadmap/database-url"
JWT_SECRET_NAME="architecture-master-roadmap/jwt-secret"
BOOTSTRAP_SECRET_NAME="architecture-master-roadmap/local-auth-bootstrap-token"

for command in aws docker mktemp; do
  command -v "$command" >/dev/null 2>&1 || { echo "Required command not found: $command" >&2; exit 1; }
done
aws sts get-caller-identity --region "$REGION" >/dev/null

cat <<'NOTICE'
This creates a new App Runner service and supporting App Runner-only roles,
security group, and VPC connector. It does not change the EC2 fallback host,
RDS instance/data, route tables, NAT configuration, or public EC2 endpoint.
NOTICE
read -r -p "Type CREATE_ARCHITECTURE_MASTER_ROADMAP_APP_RUNNER to continue: " CONFIRMATION
[[ "$CONFIRMATION" == "CREATE_ARCHITECTURE_MASTER_ROADMAP_APP_RUNNER" ]] || { echo "Confirmation did not match. No AWS resources were changed."; exit 1; }

if aws apprunner list-services --region "$REGION" --query "ServiceSummaryList[?ServiceName=='${SERVICE_NAME}'].ServiceArn" --output text | grep -q .; then
  echo "An App Runner service named ${SERVICE_NAME} already exists. Choose a different SERVICE_NAME." >&2
  exit 1
fi

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${REPOSITORY}"
IMAGE_TAG="apprunner-$(date -u +%Y%m%d%H%M%S)"
IMAGE_URI="${ECR_URI}:${IMAGE_TAG}"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

DATABASE_SECRET_ARN="$(aws secretsmanager describe-secret --region "$REGION" --secret-id "$DATABASE_SECRET_NAME" --query ARN --output text)"
JWT_SECRET_ARN="$(aws secretsmanager describe-secret --region "$REGION" --secret-id "$JWT_SECRET_NAME" --query ARN --output text)"
BOOTSTRAP_SECRET_ARN="$(aws secretsmanager describe-secret --region "$REGION" --secret-id "$BOOTSTRAP_SECRET_NAME" --query ARN --output text)"
for value in "$DATABASE_SECRET_ARN" "$JWT_SECRET_ARN" "$BOOTSTRAP_SECRET_ARN"; do
  [[ -n "$value" && "$value" != "None" ]] || { echo "Required runtime secret is missing." >&2; exit 1; }
done

if ! aws ecr describe-repositories --region "$REGION" --repository-names "$REPOSITORY" >/dev/null 2>&1; then
  aws ecr create-repository --region "$REGION" --repository-name "$REPOSITORY" >/dev/null
fi
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
docker build --platform linux/amd64 --tag "$IMAGE_URI" .
docker push "$IMAGE_URI"

cat >"${TEMP_DIR}/ecr-trust.json" <<'EOF'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"build.apprunner.amazonaws.com"},"Action":"sts:AssumeRole"}]}
EOF
cat >"${TEMP_DIR}/instance-trust.json" <<'EOF'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"tasks.apprunner.amazonaws.com"},"Action":"sts:AssumeRole"}]}
EOF
if ! aws iam get-role --role-name "$ECR_ACCESS_ROLE_NAME" >/dev/null 2>&1; then
  aws iam create-role --role-name "$ECR_ACCESS_ROLE_NAME" --assume-role-policy-document "file://${TEMP_DIR}/ecr-trust.json" >/dev/null
  aws iam attach-role-policy --role-name "$ECR_ACCESS_ROLE_NAME" --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess
fi
if ! aws iam get-role --role-name "$INSTANCE_ROLE_NAME" >/dev/null 2>&1; then
  aws iam create-role --role-name "$INSTANCE_ROLE_NAME" --assume-role-policy-document "file://${TEMP_DIR}/instance-trust.json" >/dev/null
fi
cat >"${TEMP_DIR}/runtime-secrets-policy.json" <<EOF
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["secretsmanager:GetSecretValue"],"Resource":["${DATABASE_SECRET_ARN}","${JWT_SECRET_ARN}","${BOOTSTRAP_SECRET_ARN}"]}]}
EOF
aws iam put-role-policy --role-name "$INSTANCE_ROLE_NAME" --policy-name ReadArchitectureMasterRoadmapRuntimeSecrets --policy-document "file://${TEMP_DIR}/runtime-secrets-policy.json"
ECR_ACCESS_ROLE_ARN="$(aws iam get-role --role-name "$ECR_ACCESS_ROLE_NAME" --query 'Role.Arn' --output text)"
INSTANCE_ROLE_ARN="$(aws iam get-role --role-name "$INSTANCE_ROLE_NAME" --query 'Role.Arn' --output text)"

CONNECTOR_SECURITY_GROUP_ID="$(aws ec2 describe-security-groups --region "$REGION" --filters "Name=vpc-id,Values=${VPC_ID}" "Name=group-name,Values=${CONNECTOR_SECURITY_GROUP_NAME}" --query 'SecurityGroups[0].GroupId' --output text)"
if [[ -z "$CONNECTOR_SECURITY_GROUP_ID" || "$CONNECTOR_SECURITY_GROUP_ID" == "None" ]]; then
  CONNECTOR_SECURITY_GROUP_ID="$(aws ec2 create-security-group --region "$REGION" --group-name "$CONNECTOR_SECURITY_GROUP_NAME" --description 'App Runner private egress to Architecture Master Roadmap RDS' --vpc-id "$VPC_ID" --query GroupId --output text)"
fi
aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$RDS_SECURITY_GROUP" --protocol tcp --port 3306 --source-group "$CONNECTOR_SECURITY_GROUP_ID" 2>/dev/null || true

VPC_CONNECTOR_ARN="$(aws apprunner list-vpc-connectors --region "$REGION" --query "VpcConnectors[?VpcConnectorName=='${CONNECTOR_NAME}'].VpcConnectorArn | [0]" --output text)"
if [[ -z "$VPC_CONNECTOR_ARN" || "$VPC_CONNECTOR_ARN" == "None" ]]; then
  VPC_CONNECTOR_ARN="$(aws apprunner create-vpc-connector --region "$REGION" --vpc-connector-name "$CONNECTOR_NAME" --subnets "$PRIVATE_SUBNET_A" "$PRIVATE_SUBNET_B" --security-groups "$CONNECTOR_SECURITY_GROUP_ID" --query 'VpcConnector.VpcConnectorArn' --output text)"
fi
for _ in $(seq 1 90); do
  CONNECTOR_STATUS="$(aws apprunner describe-vpc-connector --region "$REGION" --vpc-connector-arn "$VPC_CONNECTOR_ARN" --query 'VpcConnector.Status' --output text)"
  [[ "$CONNECTOR_STATUS" == "ACTIVE" ]] && break
  [[ "$CONNECTOR_STATUS" == "FAILED" || "$CONNECTOR_STATUS" == "DELETED" ]] && { echo "VPC connector ended in state ${CONNECTOR_STATUS}." >&2; exit 1; }
  sleep 10
done
[[ "${CONNECTOR_STATUS:-}" == "ACTIVE" ]] || { echo "Timed out waiting for VPC connector activation." >&2; exit 1; }

sleep 10
cat >"${TEMP_DIR}/source-configuration.json" <<EOF
{
  "AuthenticationConfiguration": { "AccessRoleArn": "${ECR_ACCESS_ROLE_ARN}" },
  "AutoDeploymentsEnabled": false,
  "ImageRepository": {
    "ImageIdentifier": "${IMAGE_URI}",
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

aws apprunner create-service \
  --region "$REGION" \
  --service-name "$SERVICE_NAME" \
  --source-configuration "file://${TEMP_DIR}/source-configuration.json" \
  --instance-configuration "file://${TEMP_DIR}/instance-configuration.json" \
  --network-configuration "file://${TEMP_DIR}/network-configuration.json" \
  --health-check-configuration "file://${TEMP_DIR}/health-check-configuration.json" \
  --query 'Service.{ServiceArn:ServiceArn,ServiceUrl:ServiceUrl,Status:Status}' \
  --output table

echo "App Runner creation requested. Keep EC2 running until this service is RUNNING and /health, local sign-in, and Relationship Map management have been verified."
