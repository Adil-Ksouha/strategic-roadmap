#!/usr/bin/env bash
set -euo pipefail

# Creates a secure, managed Northstar deployment in the selected AWS Region.
# Resources: ECR, App Runner, RDS MySQL, Secrets Manager, S3 artwork, a dedicated
# VPC with private subnets, an Internet gateway, and one NAT gateway for Google OAuth.

APP_NAME="northstar"
REGION="${AWS_REGION:-us-east-1}"
DB_IDENTIFIER="${APP_NAME}-db"
DB_NAME="northstar"
DB_USER="northstar_admin"
VPC_CIDR="10.88.0.0/16"

require_command() { command -v "$1" >/dev/null || { echo "Required command not found: $1" >&2; exit 1; }; }
for command in aws docker openssl; do require_command "$command"; done

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
ECR_REPOSITORY="$APP_NAME"
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${ECR_REPOSITORY}"
ASSET_BUCKET="${APP_NAME}-assets-${ACCOUNT_ID}-${REGION}"

read -r -p "Google OAuth Client ID: " GOOGLE_CLIENT_ID
read -r -s -p "Google OAuth Client Secret: " GOOGLE_CLIENT_SECRET
printf "\n"
[[ -n "$GOOGLE_CLIENT_ID" && -n "$GOOGLE_CLIENT_SECRET" ]] || { echo "Google OAuth credentials are required." >&2; exit 1; }
read -r -p "Northstar executive administrator Gmail: " PLATFORM_ADMIN_EMAIL
PLATFORM_ADMIN_EMAIL="$(printf '%s' "$PLATFORM_ADMIN_EMAIL" | tr '[:upper:]' '[:lower:]' | xargs)"
[[ "$PLATFORM_ADMIN_EMAIL" == *"@"* ]] || { echo "A valid executive administrator Gmail is required." >&2; exit 1; }

put_secret() {
  local name="$1" value="$2"
  if aws secretsmanager describe-secret --secret-id "$name" --region "$REGION" >/dev/null 2>&1; then
    aws secretsmanager put-secret-value --secret-id "$name" --secret-string "$value" --region "$REGION" >/dev/null
  else
    aws secretsmanager create-secret --name "$name" --secret-string "$value" --region "$REGION" >/dev/null
  fi
  aws secretsmanager describe-secret --secret-id "$name" --region "$REGION" --query ARN --output text
}

find_by_name() {
  local command="$1" name="$2" query="$3"
  aws "$command" --filters "Name=tag:Name,Values=${name}" --query "$query" --output text --region "$REGION" 2>/dev/null || true
}

echo "Preparing AWS network for a private database and secure Google OAuth egress..."
VPC_ID="$(aws ec2 describe-vpcs --filters "Name=tag:Name,Values=${APP_NAME}-vpc" --query 'Vpcs[0].VpcId' --output text --region "$REGION")"
if [[ "$VPC_ID" == "None" || -z "$VPC_ID" ]]; then
  VPC_ID="$(aws ec2 create-vpc --cidr-block "$VPC_CIDR" --query 'Vpc.VpcId' --output text --region "$REGION")"
  aws ec2 create-tags --resources "$VPC_ID" --tags "Key=Name,Value=${APP_NAME}-vpc" --region "$REGION"
  aws ec2 modify-vpc-attribute --vpc-id "$VPC_ID" --enable-dns-support '{"Value":true}' --region "$REGION"
  aws ec2 modify-vpc-attribute --vpc-id "$VPC_ID" --enable-dns-hostnames '{"Value":true}' --region "$REGION"
fi
mapfile -t AZS < <(aws ec2 describe-availability-zones --filters Name=state,Values=available --query 'AvailabilityZones[0:2].ZoneName' --output text --region "$REGION" | tr '\t' '\n')
[[ ${#AZS[@]} -eq 2 ]] || { echo "Two Availability Zones are required." >&2; exit 1; }

create_subnet() {
  local name="$1" cidr="$2" az="$3" subnet
  subnet="$(aws ec2 describe-subnets --filters "Name=tag:Name,Values=${name}" "Name=vpc-id,Values=${VPC_ID}" --query 'Subnets[0].SubnetId' --output text --region "$REGION")"
  if [[ "$subnet" == "None" || -z "$subnet" ]]; then
    subnet="$(aws ec2 create-subnet --vpc-id "$VPC_ID" --cidr-block "$cidr" --availability-zone "$az" --query 'Subnet.SubnetId' --output text --region "$REGION")"
    aws ec2 create-tags --resources "$subnet" --tags "Key=Name,Value=${name}" --region "$REGION"
  fi
  echo "$subnet"
}

PUBLIC_SUBNET_A="$(create_subnet "${APP_NAME}-public-a" "10.88.0.0/20" "${AZS[0]}")"
PUBLIC_SUBNET_B="$(create_subnet "${APP_NAME}-public-b" "10.88.16.0/20" "${AZS[1]}")"
PRIVATE_SUBNET_A="$(create_subnet "${APP_NAME}-private-a" "10.88.32.0/20" "${AZS[0]}")"
PRIVATE_SUBNET_B="$(create_subnet "${APP_NAME}-private-b" "10.88.48.0/20" "${AZS[1]}")"

IGW_ID="$(aws ec2 describe-internet-gateways --filters "Name=attachment.vpc-id,Values=${VPC_ID}" --query 'InternetGateways[0].InternetGatewayId' --output text --region "$REGION")"
if [[ "$IGW_ID" == "None" || -z "$IGW_ID" ]]; then
  IGW_ID="$(aws ec2 create-internet-gateway --query 'InternetGateway.InternetGatewayId' --output text --region "$REGION")"
  aws ec2 create-tags --resources "$IGW_ID" --tags "Key=Name,Value=${APP_NAME}-igw" --region "$REGION"
  aws ec2 attach-internet-gateway --internet-gateway-id "$IGW_ID" --vpc-id "$VPC_ID" --region "$REGION"
fi
PUBLIC_ROUTE_TABLE="$(aws ec2 describe-route-tables --filters "Name=tag:Name,Values=${APP_NAME}-public-rt" "Name=vpc-id,Values=${VPC_ID}" --query 'RouteTables[0].RouteTableId' --output text --region "$REGION")"
if [[ "$PUBLIC_ROUTE_TABLE" == "None" || -z "$PUBLIC_ROUTE_TABLE" ]]; then
  PUBLIC_ROUTE_TABLE="$(aws ec2 create-route-table --vpc-id "$VPC_ID" --query 'RouteTable.RouteTableId' --output text --region "$REGION")"
  aws ec2 create-tags --resources "$PUBLIC_ROUTE_TABLE" --tags "Key=Name,Value=${APP_NAME}-public-rt" --region "$REGION"
fi
aws ec2 create-route --route-table-id "$PUBLIC_ROUTE_TABLE" --destination-cidr-block 0.0.0.0/0 --gateway-id "$IGW_ID" --region "$REGION" 2>/dev/null || true
for subnet in "$PUBLIC_SUBNET_A" "$PUBLIC_SUBNET_B"; do aws ec2 associate-route-table --route-table-id "$PUBLIC_ROUTE_TABLE" --subnet-id "$subnet" --region "$REGION" >/dev/null 2>&1 || true; done

NAT_ID="$(aws ec2 describe-nat-gateways --filter "Name=tag:Name,Values=${APP_NAME}-nat" --query 'NatGateways[?State!=`deleted`]|[0].NatGatewayId' --output text --region "$REGION")"
if [[ "$NAT_ID" == "None" || -z "$NAT_ID" ]]; then
  ALLOCATION_ID="$(aws ec2 allocate-address --domain vpc --query 'AllocationId' --output text --region "$REGION")"
  NAT_ID="$(aws ec2 create-nat-gateway --subnet-id "$PUBLIC_SUBNET_A" --allocation-id "$ALLOCATION_ID" --tag-specifications "ResourceType=natgateway,Tags=[{Key=Name,Value=${APP_NAME}-nat}]" --query 'NatGateway.NatGatewayId' --output text --region "$REGION")"
  aws ec2 wait nat-gateway-available --nat-gateway-ids "$NAT_ID" --region "$REGION"
fi
PRIVATE_ROUTE_TABLE="$(aws ec2 describe-route-tables --filters "Name=tag:Name,Values=${APP_NAME}-private-rt" "Name=vpc-id,Values=${VPC_ID}" --query 'RouteTables[0].RouteTableId' --output text --region "$REGION")"
if [[ "$PRIVATE_ROUTE_TABLE" == "None" || -z "$PRIVATE_ROUTE_TABLE" ]]; then
  PRIVATE_ROUTE_TABLE="$(aws ec2 create-route-table --vpc-id "$VPC_ID" --query 'RouteTable.RouteTableId' --output text --region "$REGION")"
  aws ec2 create-tags --resources "$PRIVATE_ROUTE_TABLE" --tags "Key=Name,Value=${APP_NAME}-private-rt" --region "$REGION"
fi
aws ec2 create-route --route-table-id "$PRIVATE_ROUTE_TABLE" --destination-cidr-block 0.0.0.0/0 --nat-gateway-id "$NAT_ID" --region "$REGION" 2>/dev/null || true
for subnet in "$PRIVATE_SUBNET_A" "$PRIVATE_SUBNET_B"; do aws ec2 associate-route-table --route-table-id "$PRIVATE_ROUTE_TABLE" --subnet-id "$subnet" --region "$REGION" >/dev/null 2>&1 || true; done

get_or_create_sg() {
  local name="$1" description="$2" group
  group="$(aws ec2 describe-security-groups --filters "Name=group-name,Values=${name}" "Name=vpc-id,Values=${VPC_ID}" --query 'SecurityGroups[0].GroupId' --output text --region "$REGION")"
  if [[ "$group" == "None" || -z "$group" ]]; then
    group="$(aws ec2 create-security-group --group-name "$name" --description "$description" --vpc-id "$VPC_ID" --query GroupId --output text --region "$REGION")"
  fi
  echo "$group"
}
APP_SG="$(get_or_create_sg "${APP_NAME}-apprunner-sg" "Northstar App Runner egress")"
DB_SG="$(get_or_create_sg "${APP_NAME}-rds-sg" "Northstar RDS access")"
aws ec2 authorize-security-group-ingress --group-id "$DB_SG" --protocol tcp --port 3306 --source-group "$APP_SG" --region "$REGION" 2>/dev/null || true

CONNECTOR_NAME="${APP_NAME}-vpc-connector"
CONNECTOR_ARN="$(aws apprunner list-vpc-connectors --query "VpcConnectors[?VpcConnectorName=='${CONNECTOR_NAME}'].VpcConnectorArn | [0]" --output text --region "$REGION")"
if [[ "$CONNECTOR_ARN" == "None" || -z "$CONNECTOR_ARN" ]]; then
  CONNECTOR_ARN="$(aws apprunner create-vpc-connector --vpc-connector-name "$CONNECTOR_NAME" --subnets "$PRIVATE_SUBNET_A" "$PRIVATE_SUBNET_B" --security-groups "$APP_SG" --query 'VpcConnector.VpcConnectorArn' --output text --region "$REGION")"
fi
until [[ "$(aws apprunner describe-vpc-connector --vpc-connector-arn "$CONNECTOR_ARN" --query 'VpcConnector.Status' --output text --region "$REGION")" == "ACTIVE" ]]; do sleep 10; done

echo "Creating secure asset storage and publishing the non-sensitive sign-in artwork..."
if ! aws s3api head-bucket --bucket "$ASSET_BUCKET" 2>/dev/null; then
  aws s3api create-bucket --bucket "$ASSET_BUCKET" --region "$REGION" >/dev/null
  aws s3api put-public-access-block --bucket "$ASSET_BUCKET" --public-access-block-configuration BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false
  cat > /tmp/${APP_NAME}-asset-policy.json <<EOF
{"Version":"2012-10-17","Statement":[{"Sid":"PublicReadOnlyArtwork","Effect":"Allow","Principal":"*","Action":"s3:GetObject","Resource":"arn:aws:s3:::${ASSET_BUCKET}/telecom-cloud-network.jpg"}]}
EOF
  aws s3api put-bucket-policy --bucket "$ASSET_BUCKET" --policy "file:///tmp/${APP_NAME}-asset-policy.json"
fi
aws s3 cp assets/telecom-cloud-network.jpg "s3://${ASSET_BUCKET}/telecom-cloud-network.jpg" --region "$REGION" >/dev/null
ASSET_URL="https://${ASSET_BUCKET}.s3.${REGION}.amazonaws.com/telecom-cloud-network.jpg"

echo "Building and publishing the Northstar application image..."
aws ecr describe-repositories --repository-names "$ECR_REPOSITORY" --region "$REGION" >/dev/null 2>&1 || aws ecr create-repository --repository-name "$ECR_REPOSITORY" --image-scanning-configuration scanOnPush=true --region "$REGION" >/dev/null
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
IMAGE_TAG="$(date +%Y%m%d%H%M%S)"
docker build --build-arg "VITE_NETWORK_ARTWORK_URL=${ASSET_URL}" -t "${ECR_URI}:${IMAGE_TAG}" -t "${ECR_URI}:latest" .
docker push "${ECR_URI}:${IMAGE_TAG}"
docker push "${ECR_URI}:latest"

SUBNET_GROUP="${APP_NAME}-db-subnets"
aws rds describe-db-subnet-groups --db-subnet-group-name "$SUBNET_GROUP" --region "$REGION" >/dev/null 2>&1 || aws rds create-db-subnet-group --db-subnet-group-name "$SUBNET_GROUP" --db-subnet-group-description "Northstar database subnets" --subnet-ids "$PRIVATE_SUBNET_A" "$PRIVATE_SUBNET_B" --region "$REGION" >/dev/null
if ! aws rds describe-db-instances --db-instance-identifier "$DB_IDENTIFIER" --region "$REGION" >/dev/null 2>&1; then
  DB_PASSWORD="$(openssl rand -base64 42 | tr -dc 'A-Za-z0-9' | head -c 32)"
  echo "Creating the private RDS MySQL instance; this usually takes several minutes..."
  aws rds create-db-instance --db-instance-identifier "$DB_IDENTIFIER" --db-instance-class db.t3.micro --engine mysql --allocated-storage 20 --storage-type gp3 --db-name "$DB_NAME" --master-username "$DB_USER" --master-user-password "$DB_PASSWORD" --vpc-security-group-ids "$DB_SG" --db-subnet-group-name "$SUBNET_GROUP" --no-publicly-accessible --backup-retention-period 7 --region "$REGION" >/dev/null
  aws rds wait db-instance-available --db-instance-identifier "$DB_IDENTIFIER" --region "$REGION"
  DB_ENDPOINT="$(aws rds describe-db-instances --db-instance-identifier "$DB_IDENTIFIER" --query 'DBInstances[0].Endpoint.Address' --output text --region "$REGION")"
  DATABASE_URL="mysql://${DB_USER}:${DB_PASSWORD}@${DB_ENDPOINT}:3306/${DB_NAME}"
else
  DATABASE_URL="$(aws secretsmanager get-secret-value --secret-id "${APP_NAME}/database-url" --query SecretString --output text --region "$REGION")"
  [[ -n "$DATABASE_URL" && "$DATABASE_URL" != "None" ]] || { echo "Existing RDS requires ${APP_NAME}/database-url in Secrets Manager." >&2; exit 1; }
fi

cat > /tmp/${APP_NAME}-ecr-trust.json <<'EOF'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"build.apprunner.amazonaws.com"},"Action":"sts:AssumeRole"}]}
EOF
cat > /tmp/${APP_NAME}-instance-trust.json <<'EOF'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"tasks.apprunner.amazonaws.com"},"Action":"sts:AssumeRole"}]}
EOF
ECR_ROLE="${APP_NAME}-apprunner-ecr-role"
INSTANCE_ROLE="${APP_NAME}-apprunner-instance-role"
aws iam get-role --role-name "$ECR_ROLE" >/dev/null 2>&1 || aws iam create-role --role-name "$ECR_ROLE" --assume-role-policy-document file:///tmp/${APP_NAME}-ecr-trust.json >/dev/null
aws iam attach-role-policy --role-name "$ECR_ROLE" --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess
aws iam get-role --role-name "$INSTANCE_ROLE" >/dev/null 2>&1 || aws iam create-role --role-name "$INSTANCE_ROLE" --assume-role-policy-document file:///tmp/${APP_NAME}-instance-trust.json >/dev/null
cat > /tmp/${APP_NAME}-secrets-policy.json <<EOF
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["secretsmanager:GetSecretValue"],"Resource":"arn:aws:secretsmanager:${REGION}:${ACCOUNT_ID}:secret:${APP_NAME}/*"}]}
EOF
aws iam put-role-policy --role-name "$INSTANCE_ROLE" --policy-name "NorthstarReadRuntimeSecrets" --policy-document file:///tmp/${APP_NAME}-secrets-policy.json
sleep 10
ECR_ROLE_ARN="$(aws iam get-role --role-name "$ECR_ROLE" --query 'Role.Arn' --output text)"
INSTANCE_ROLE_ARN="$(aws iam get-role --role-name "$INSTANCE_ROLE" --query 'Role.Arn' --output text)"

DB_SECRET_ARN="$(put_secret "${APP_NAME}/database-url" "$DATABASE_URL")"
JWT_SECRET_ARN="$(put_secret "${APP_NAME}/jwt-secret" "$(openssl rand -base64 48)")"
GOOGLE_CLIENT_ID_ARN="$(put_secret "${APP_NAME}/google-client-id" "$GOOGLE_CLIENT_ID")"
GOOGLE_CLIENT_SECRET_ARN="$(put_secret "${APP_NAME}/google-client-secret" "$GOOGLE_CLIENT_SECRET")"
PLATFORM_ADMIN_EMAIL_ARN="$(put_secret "${APP_NAME}/platform-admin-email" "$PLATFORM_ADMIN_EMAIL")"

write_source_configuration() {
  local base_url="$1"
  cat > /tmp/${APP_NAME}-source.json <<EOF
{"AutoDeploymentsEnabled":false,"AuthenticationConfiguration":{"AccessRoleArn":"${ECR_ROLE_ARN}"},"ImageRepository":{"ImageIdentifier":"${ECR_URI}:${IMAGE_TAG}","ImageRepositoryType":"ECR","ImageConfiguration":{"Port":"8080","RuntimeEnvironmentVariables":{"NODE_ENV":"production","VITE_APP_ID":"northstar","APP_BASE_URL":"${base_url}"},"RuntimeEnvironmentSecrets":{"DATABASE_URL":"${DB_SECRET_ARN}","JWT_SECRET":"${JWT_SECRET_ARN}","GOOGLE_CLIENT_ID":"${GOOGLE_CLIENT_ID_ARN}","GOOGLE_CLIENT_SECRET":"${GOOGLE_CLIENT_SECRET_ARN}","PLATFORM_ADMIN_EMAIL":"${PLATFORM_ADMIN_EMAIL_ARN}"}}}}
EOF
}

write_source_configuration ""
SERVICE_ARN="$(aws apprunner list-services --query "ServiceSummaryList[?ServiceName=='${APP_NAME}'].ServiceArn | [0]" --output text --region "$REGION")"
NETWORK_CONFIGURATION="IngressConfiguration={IsPubliclyAccessible=true},EgressConfiguration={EgressType=VPC,VpcConnectorArn=${CONNECTOR_ARN}}"
if [[ "$SERVICE_ARN" == "None" || -z "$SERVICE_ARN" ]]; then
  SERVICE_ARN="$(aws apprunner create-service --service-name "$APP_NAME" --source-configuration file:///tmp/${APP_NAME}-source.json --instance-configuration "Cpu=1 vCPU,Memory=2 GB,InstanceRoleArn=${INSTANCE_ROLE_ARN}" --network-configuration "$NETWORK_CONFIGURATION" --query 'Service.ServiceArn' --output text --region "$REGION")"
else
  aws apprunner update-service --service-arn "$SERVICE_ARN" --source-configuration file:///tmp/${APP_NAME}-source.json --instance-configuration "Cpu=1 vCPU,Memory=2 GB,InstanceRoleArn=${INSTANCE_ROLE_ARN}" --region "$REGION" >/dev/null
fi

echo "Waiting for App Runner to deploy the application..."
STATUS=""
until [[ "$STATUS" == "RUNNING" ]]; do
  STATUS="$(aws apprunner describe-service --service-arn "$SERVICE_ARN" --query 'Service.Status' --output text --region "$REGION")"
  [[ "$STATUS" == "CREATE_FAILED" || "$STATUS" == "DELETE_FAILED" ]] && { echo "App Runner deployment failed with status $STATUS" >&2; exit 1; }
  sleep 15
done
SERVICE_URL="$(aws apprunner describe-service --service-arn "$SERVICE_ARN" --query 'Service.ServiceUrl' --output text --region "$REGION")"
APP_BASE_URL="https://${SERVICE_URL}"
write_source_configuration "$APP_BASE_URL"
aws apprunner update-service --service-arn "$SERVICE_ARN" --source-configuration file:///tmp/${APP_NAME}-source.json --region "$REGION" >/dev/null

echo
echo "Northstar is deployed at: ${APP_BASE_URL}"
echo "Add this Google OAuth redirect URI before testing Google sign-in:"
echo "${APP_BASE_URL}/api/auth/google/callback"
echo "The final App Runner revision is deploying with its production origin."
