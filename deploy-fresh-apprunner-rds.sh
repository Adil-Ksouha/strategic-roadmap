#!/usr/bin/env bash
set -Eeuo pipefail

# Clean, development-only Architecture Master Roadmap deployment.
# The created App Runner service starts once with the initializer image to migrate
# an empty fresh RDS database, then is updated in place to the normal image.
# It does not create a temporary migration App Runner service.
REGION="${AWS_REGION:-us-east-1}"
VPC_ID="${VPC_ID:-vpc-0cbb9dbb03493aeaf}"
PRIVATE_SUBNET_A="${PRIVATE_SUBNET_A:-subnet-006f73187d06bc890}"
PRIVATE_SUBNET_B="${PRIVATE_SUBNET_B:-subnet-052a19951bc944bb8}"
REPOSITORY="${REPOSITORY:-architecture-master-roadmap}"
SERVICE_NAME="${SERVICE_NAME:-architecture-master-roadmap-fresh}"
DB_INSTANCE_IDENTIFIER="${DB_INSTANCE_IDENTIFIER:-architecture-master-roadmap-db-fresh}"
DB_SUBNET_GROUP_NAME="${DB_SUBNET_GROUP_NAME:-amr-fresh-db-subnets}"
DB_SECURITY_GROUP_NAME="${DB_SECURITY_GROUP_NAME:-amr-fresh-db-sg}"
VPC_CONNECTOR_NAME="${VPC_CONNECTOR_NAME:-amr-apprunner-vpc}"
VPC_CONNECTOR_FALLBACK_NAME="${VPC_CONNECTOR_FALLBACK_NAME:-amr-fresh-vpc}"
CONNECTOR_SECURITY_GROUP_NAME="${CONNECTOR_SECURITY_GROUP_NAME:-amr-fresh-apprunner-egress-sg}"
ECR_ACCESS_ROLE_NAME="${ECR_ACCESS_ROLE_NAME:-amr-fresh-apprunner-ecr-role}"
INSTANCE_ROLE_NAME="${INSTANCE_ROLE_NAME:-amr-fresh-apprunner-instance-role}"
DATABASE_SECRET_NAME="${DATABASE_SECRET_NAME:-architecture-master-roadmap-fresh/database-url}"
JWT_SECRET_NAME="${JWT_SECRET_NAME:-architecture-master-roadmap-fresh/jwt-secret}"
BOOTSTRAP_SECRET_NAME="${BOOTSTRAP_SECRET_NAME:-architecture-master-roadmap-fresh/local-auth-bootstrap-token}"
DB_NAME="${DB_NAME:-architecture_master_roadmap}"
DB_USER="${DB_USER:-amradmin}"
WAIT_ATTEMPTS="${WAIT_ATTEMPTS:-90}"
RESET_BOOTSTRAP_TOKEN="${RESET_BOOTSTRAP_TOKEN:-false}"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Required command not found: $1" >&2
    exit 1
  }
}

wait_for_service() {
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
        echo "${label} ended in state ${status}. It was retained for CloudWatch log inspection." >&2
        return 1
        ;;
      *)
        echo "${label} status: ${status}"
        sleep 10
        ;;
    esac
  done
  echo "Timed out waiting for ${label}. It was retained for inspection." >&2
  return 1
}

secret_arn() {
  aws secretsmanager describe-secret --region "$REGION" --secret-id "$1" --query ARN --output text
}

for command in aws docker curl openssl date mktemp; do
  require_command "$command"
done
[[ -f Dockerfile.migration ]] || { echo "Dockerfile.migration is missing." >&2; exit 1; }
[[ -f drizzle/0006_sloppy_thor_girl.sql ]] || { echo "The direct-SAR migration is missing." >&2; exit 1; }
grep -Fq 'SET `amountUsdM` = 0' drizzle/0006_sloppy_thor_girl.sql || {
  echo "The direct-SAR migration does not contain the approved zero-value baseline." >&2
  exit 1
}
aws sts get-caller-identity --region "$REGION" >/dev/null

if aws apprunner list-services --region "$REGION" --query "ServiceSummaryList[?ServiceName=='${SERVICE_NAME}'].ServiceArn | [0]" --output text | grep -qv '^None$'; then
  echo "App Runner service ${SERVICE_NAME} already exists. Choose another SERVICE_NAME or remove the incomplete test service before rerunning." >&2
  exit 1
fi

cat <<'NOTICE'
This script creates or resumes a fresh development-only deployment:
  * a private RDS MySQL database and fresh runtime secrets, when absent;
  * one new public App Runner service using existing private VPC egress; and
  * one-time database initialization inside that new service only.

After the schema is initialized, the same service is immediately updated to the
normal migration-free application image. It does not create a second migration
service, a NAT Gateway, or a public RDS endpoint. Existing fresh resources from
the prior attempt are reused; existing former services and databases are untouched.
NOTICE
read -r -p "Type CREATE_FRESH_ARCHITECTURE_MASTER_ROADMAP to continue: " CONFIRMATION
[[ "$CONFIRMATION" == "CREATE_FRESH_ARCHITECTURE_MASTER_ROADMAP" ]] || {
  echo "Confirmation did not match. No AWS resources were changed."
  exit 1
}

ACCOUNT_ID="$(aws sts get-caller-identity --region "$REGION" --query Account --output text)"
ECR_REGISTRY="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
ECR_URI="${ECR_REGISTRY}/${REPOSITORY}"
IMAGE_TAG="fresh-$(date -u +%Y%m%d%H%M%S)"
INITIALIZER_IMAGE_URI="${ECR_URI}:${IMAGE_TAG}-initialize"
APPLICATION_IMAGE_URI="${ECR_URI}:${IMAGE_TAG}"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"; unset BOOTSTRAP_TOKEN DB_PASSWORD' EXIT

if ! aws rds describe-db-subnet-groups --region "$REGION" --db-subnet-group-name "$DB_SUBNET_GROUP_NAME" >/dev/null 2>&1; then
  echo "Creating private database subnet group..."
  aws rds create-db-subnet-group \
    --region "$REGION" \
    --db-subnet-group-name "$DB_SUBNET_GROUP_NAME" \
    --db-subnet-group-description "Private subnets for ${DB_INSTANCE_IDENTIFIER}" \
    --subnet-ids "$PRIVATE_SUBNET_A" "$PRIVATE_SUBNET_B" \
    --tags Key=Project,Value=architecture-master-roadmap Key=Environment,Value=development Key=Purpose,Value=fresh-apprunner-rds >/dev/null
fi

DB_SECURITY_GROUP_ID="$(aws ec2 describe-security-groups --region "$REGION" --filters "Name=vpc-id,Values=${VPC_ID}" "Name=group-name,Values=${DB_SECURITY_GROUP_NAME}" --query 'SecurityGroups[0].GroupId' --output text)"
if [[ -z "$DB_SECURITY_GROUP_ID" || "$DB_SECURITY_GROUP_ID" == "None" ]]; then
  echo "Creating private RDS security group..."
  DB_SECURITY_GROUP_ID="$(aws ec2 create-security-group \
    --region "$REGION" \
    --vpc-id "$VPC_ID" \
    --group-name "$DB_SECURITY_GROUP_NAME" \
    --description "Private MySQL access for ${SERVICE_NAME}" \
    --tag-specifications "ResourceType=security-group,Tags=[{Key=Project,Value=architecture-master-roadmap},{Key=Environment,Value=development},{Key=Purpose,Value=fresh-apprunner-rds}]" \
    --query GroupId --output text)"
fi

VPC_CONNECTOR_ARN="$(aws apprunner list-vpc-connectors --region "$REGION" --query "VpcConnectors[?VpcConnectorName=='${VPC_CONNECTOR_NAME}'].VpcConnectorArn | [0]" --output text)"
if [[ -z "$VPC_CONNECTOR_ARN" || "$VPC_CONNECTOR_ARN" == "None" ]]; then
  echo "Creating App Runner VPC connector without NAT..."
  CONNECTOR_SECURITY_GROUP_ID="$(aws ec2 describe-security-groups --region "$REGION" --filters "Name=vpc-id,Values=${VPC_ID}" "Name=group-name,Values=${CONNECTOR_SECURITY_GROUP_NAME}" --query 'SecurityGroups[0].GroupId' --output text)"
  if [[ -z "$CONNECTOR_SECURITY_GROUP_ID" || "$CONNECTOR_SECURITY_GROUP_ID" == "None" ]]; then
    CONNECTOR_SECURITY_GROUP_ID="$(aws ec2 create-security-group \
      --region "$REGION" \
      --vpc-id "$VPC_ID" \
      --group-name "$CONNECTOR_SECURITY_GROUP_NAME" \
      --description "Private egress for ${SERVICE_NAME}" \
      --tag-specifications "ResourceType=security-group,Tags=[{Key=Project,Value=architecture-master-roadmap},{Key=Environment,Value=development},{Key=Purpose,Value=fresh-apprunner-rds}]" \
      --query GroupId --output text)"
  fi
  VPC_CONNECTOR_ARN="$(aws apprunner create-vpc-connector \
    --region "$REGION" \
    --vpc-connector-name "$VPC_CONNECTOR_FALLBACK_NAME" \
    --subnets "$PRIVATE_SUBNET_A" "$PRIVATE_SUBNET_B" \
    --security-groups "$CONNECTOR_SECURITY_GROUP_ID" \
    --query 'VpcConnector.VpcConnectorArn' --output text)"
fi
for _ in $(seq 1 "$WAIT_ATTEMPTS"); do
  CONNECTOR_STATUS="$(aws apprunner describe-vpc-connector --region "$REGION" --vpc-connector-arn "$VPC_CONNECTOR_ARN" --query 'VpcConnector.Status' --output text)"
  [[ "$CONNECTOR_STATUS" == "ACTIVE" ]] && break
  [[ "$CONNECTOR_STATUS" == "FAILED" || "$CONNECTOR_STATUS" == "DELETED" ]] && { echo "VPC connector ended in state ${CONNECTOR_STATUS}." >&2; exit 1; }
  sleep 10
done
[[ "${CONNECTOR_STATUS:-}" == "ACTIVE" ]] || { echo "Timed out waiting for VPC connector activation." >&2; exit 1; }

mapfile -t CONNECTOR_SECURITY_GROUP_IDS < <(aws apprunner describe-vpc-connector --region "$REGION" --vpc-connector-arn "$VPC_CONNECTOR_ARN" --query 'VpcConnector.SecurityGroups[]' --output text | tr '\t' '\n')
for connector_security_group_id in "${CONNECTOR_SECURITY_GROUP_IDS[@]}"; do
  aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$DB_SECURITY_GROUP_ID" --protocol tcp --port 3306 --source-group "$connector_security_group_id" >/dev/null 2>&1 || true
done

if ! aws rds describe-db-instances --region "$REGION" --db-instance-identifier "$DB_INSTANCE_IDENTIFIER" >/dev/null 2>&1; then
  echo "Creating fresh private RDS MySQL database..."
  DB_PASSWORD="AMR$(openssl rand -hex 16)z9"
  aws rds create-db-instance \
    --region "$REGION" \
    --db-instance-identifier "$DB_INSTANCE_IDENTIFIER" \
    --db-instance-class db.t3.micro \
    --engine mysql \
    --allocated-storage 20 \
    --storage-type gp3 \
    --db-name "$DB_NAME" \
    --master-username "$DB_USER" \
    --master-user-password "$DB_PASSWORD" \
    --db-subnet-group-name "$DB_SUBNET_GROUP_NAME" \
    --vpc-security-group-ids "$DB_SECURITY_GROUP_ID" \
    --no-publicly-accessible \
    --no-multi-az \
    --backup-retention-period 1 \
    --no-deletion-protection \
    --tags Key=Project,Value=architecture-master-roadmap Key=Environment,Value=development Key=Purpose,Value=fresh-apprunner-rds >/dev/null
  aws rds wait db-instance-available --region "$REGION" --db-instance-identifier "$DB_INSTANCE_IDENTIFIER"
else
  echo "Reusing existing fresh RDS database ${DB_INSTANCE_IDENTIFIER}."
  aws rds wait db-instance-available --region "$REGION" --db-instance-identifier "$DB_INSTANCE_IDENTIFIER"
fi
DB_ENDPOINT="$(aws rds describe-db-instances --region "$REGION" --db-instance-identifier "$DB_INSTANCE_IDENTIFIER" --query 'DBInstances[0].Endpoint.Address' --output text)"

if aws secretsmanager describe-secret --region "$REGION" --secret-id "$DATABASE_SECRET_NAME" >/dev/null 2>&1; then
  DATABASE_URL_ARN="$(secret_arn "$DATABASE_SECRET_NAME")"
else
  [[ -n "${DB_PASSWORD:-}" ]] || { echo "Database exists but ${DATABASE_SECRET_NAME} is missing; create it from the original private database credentials before rerunning." >&2; exit 1; }
  DATABASE_URL_ARN="$(aws secretsmanager create-secret --region "$REGION" --name "$DATABASE_SECRET_NAME" --secret-string "mysql://${DB_USER}:${DB_PASSWORD}@${DB_ENDPOINT}:3306/${DB_NAME}" --tags Key=Project,Value=architecture-master-roadmap Key=Environment,Value=development Key=Purpose,Value=fresh-apprunner-rds --query ARN --output text)"
fi
if aws secretsmanager describe-secret --region "$REGION" --secret-id "$JWT_SECRET_NAME" >/dev/null 2>&1; then
  JWT_SECRET_ARN="$(secret_arn "$JWT_SECRET_NAME")"
else
  JWT_SECRET_ARN="$(aws secretsmanager create-secret --region "$REGION" --name "$JWT_SECRET_NAME" --secret-string "$(openssl rand -hex 48)" --tags Key=Project,Value=architecture-master-roadmap Key=Environment,Value=development Key=Purpose,Value=fresh-apprunner-rds --query ARN --output text)"
fi
if aws secretsmanager describe-secret --region "$REGION" --secret-id "$BOOTSTRAP_SECRET_NAME" >/dev/null 2>&1; then
  if [[ "$RESET_BOOTSTRAP_TOKEN" == "true" ]]; then
    read -r -s -p "Choose a replacement LOCAL_AUTH_BOOTSTRAP_TOKEN (input is hidden): " BOOTSTRAP_TOKEN
    echo
    [[ -n "$BOOTSTRAP_TOKEN" ]] || { echo "A bootstrap token is required." >&2; exit 1; }
    aws secretsmanager put-secret-value --region "$REGION" --secret-id "$BOOTSTRAP_SECRET_NAME" --secret-string "$BOOTSTRAP_TOKEN" >/dev/null
  fi
  BOOTSTRAP_SECRET_ARN="$(secret_arn "$BOOTSTRAP_SECRET_NAME")"
else
  read -r -s -p "Choose a new LOCAL_AUTH_BOOTSTRAP_TOKEN (input is hidden): " BOOTSTRAP_TOKEN
  echo
  [[ -n "$BOOTSTRAP_TOKEN" ]] || { echo "A bootstrap token is required." >&2; exit 1; }
  BOOTSTRAP_SECRET_ARN="$(aws secretsmanager create-secret --region "$REGION" --name "$BOOTSTRAP_SECRET_NAME" --secret-string "$BOOTSTRAP_TOKEN" --tags Key=Project,Value=architecture-master-roadmap Key=Environment,Value=development Key=Purpose,Value=fresh-apprunner-rds --query ARN --output text)"
fi
unset DB_PASSWORD BOOTSTRAP_TOKEN

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
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["secretsmanager:GetSecretValue"],"Resource":["${DATABASE_URL_ARN}","${JWT_SECRET_ARN}","${BOOTSTRAP_SECRET_ARN}"]}]}
EOF
aws iam put-role-policy --role-name "$INSTANCE_ROLE_NAME" --policy-name ReadFreshArchitectureMasterRoadmapRuntimeSecrets --policy-document "file://${TEMP_DIR}/runtime-secrets-policy.json"
ECR_ACCESS_ROLE_ARN="$(aws iam get-role --role-name "$ECR_ACCESS_ROLE_NAME" --query 'Role.Arn' --output text)"
INSTANCE_ROLE_ARN="$(aws iam get-role --role-name "$INSTANCE_ROLE_NAME" --query 'Role.Arn' --output text)"
sleep 15

if ! aws ecr describe-repositories --region "$REGION" --repository-names "$REPOSITORY" >/dev/null 2>&1; then
  aws ecr create-repository --region "$REGION" --repository-name "$REPOSITORY" --image-scanning-configuration scanOnPush=true >/dev/null
fi
echo "Building and pushing initializer and normal application images..."
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ECR_REGISTRY"
docker build --platform linux/amd64 --file Dockerfile.migration --tag "$INITIALIZER_IMAGE_URI" .
docker build --platform linux/amd64 --tag "$APPLICATION_IMAGE_URI" .
docker push "$INITIALIZER_IMAGE_URI"
docker push "$APPLICATION_IMAGE_URI"

write_source_configuration() {
  local image_uri="$1"
  local output_file="$2"
  cat >"$output_file" <<EOF
{
  "AuthenticationConfiguration": { "AccessRoleArn": "${ECR_ACCESS_ROLE_ARN}" },
  "AutoDeploymentsEnabled": false,
  "ImageRepository": {
    "ImageIdentifier": "${image_uri}",
    "ImageRepositoryType": "ECR",
    "ImageConfiguration": {
      "Port": "8080",
      "RuntimeEnvironmentVariables": { "NODE_ENV": "production" },
      "RuntimeEnvironmentSecrets": {
        "DATABASE_URL": "${DATABASE_URL_ARN}",
        "JWT_SECRET": "${JWT_SECRET_ARN}",
        "LOCAL_AUTH_BOOTSTRAP_TOKEN": "${BOOTSTRAP_SECRET_ARN}"
      }
    }
  }
}
EOF
}
write_source_configuration "$INITIALIZER_IMAGE_URI" "${TEMP_DIR}/initializer-source-configuration.json"
write_source_configuration "$APPLICATION_IMAGE_URI" "${TEMP_DIR}/application-source-configuration.json"
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

echo "Creating the new service with one-time database initialization..."
APPLICATION_SERVICE_ARN="$(aws apprunner create-service \
  --region "$REGION" \
  --service-name "$SERVICE_NAME" \
  --source-configuration "file://${TEMP_DIR}/initializer-source-configuration.json" \
  --instance-configuration "file://${TEMP_DIR}/instance-configuration.json" \
  --network-configuration "file://${TEMP_DIR}/network-configuration.json" \
  --health-check-configuration "file://${TEMP_DIR}/health-check-configuration.json" \
  --query 'Service.ServiceArn' --output text)"
wait_for_service "$APPLICATION_SERVICE_ARN" "Initialized Architecture Master Roadmap service"

echo "Switching the same service to the normal migration-free application image..."
aws apprunner update-service \
  --region "$REGION" \
  --service-arn "$APPLICATION_SERVICE_ARN" \
  --source-configuration "file://${TEMP_DIR}/application-source-configuration.json" \
  --query 'Operation.{Id:Id,Status:Status,Type:Type}' --output table
wait_for_service "$APPLICATION_SERVICE_ARN" "Normal Architecture Master Roadmap service"
SERVICE_URL="$(aws apprunner describe-service --region "$REGION" --service-arn "$APPLICATION_SERVICE_ARN" --query 'Service.ServiceUrl' --output text)"
curl --fail --silent --show-error --max-time 20 "${SERVICE_URL%/}/health"
echo
cat <<RESULT

Fresh deployment is running: ${SERVICE_URL}
Create the first private administrator once at:
  ${SERVICE_URL}/?setup=1

Use the same bootstrap token entered during this deployment, or the privately reset token if RESET_BOOTSTRAP_TOKEN=true was used. Do not share it.
RESULT
