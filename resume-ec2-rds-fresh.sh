#!/usr/bin/env bash
set -Eeuo pipefail

# Resumes the clean EC2/RDS deployment after a failure that occurred after the
# VPC, subnets, security groups, and DB subnet group had already been created.
# It discovers only resources tagged/named by deploy-ec2-rds-fresh.sh.
REGION="${AWS_REGION:-us-east-1}"
STACK="architecture-master-roadmap-dev"
DB_ID="architecture-master-roadmap-db"
DB_NAME="architecture_master_roadmap"
DB_USER="architecture_admin"
ECR_REPOSITORY="architecture-master-roadmap"
EC2_ROLE="architecture-master-roadmap-ec2-role"
EC2_PROFILE="architecture-master-roadmap-ec2-profile"
EC2_INSTANCE_NAME="architecture-master-roadmap-web"
EC2_INSTANCE_TYPE="t3.small"

command -v aws >/dev/null 2>&1 || { echo "Required command not found: aws" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "Required command not found: docker (run this from AWS CloudShell)" >&2; exit 1; }
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"

read -r -p "Type RESUME_ARCHITECTURE_MASTER_ROADMAP_EC2_STACK to continue: " CONFIRMATION
[[ "$CONFIRMATION" == "RESUME_ARCHITECTURE_MASTER_ROADMAP_EC2_STACK" ]] || { echo "Confirmation did not match. No AWS resources were changed."; exit 1; }
read -r -s -p "Enter LOCAL_AUTH_BOOTSTRAP_TOKEN (hidden): " BOOTSTRAP_TOKEN
echo
[[ -n "$BOOTSTRAP_TOKEN" ]] || { echo "Bootstrap token is required." >&2; exit 1; }

not_found() { [[ -z "$1" || "$1" == "None" ]]; }
get_vpc() { aws ec2 describe-vpcs --region "$REGION" --filters "Name=tag:Name,Values=${STACK}-vpc" --query 'Vpcs[0].VpcId' --output text; }
get_subnet() { aws ec2 describe-subnets --region "$REGION" --filters "Name=vpc-id,Values=$1" "Name=tag:Name,Values=$2" --query 'Subnets[0].SubnetId' --output text; }
get_sg() { aws ec2 describe-security-groups --region "$REGION" --filters "Name=vpc-id,Values=$1" "Name=group-name,Values=$2" --query 'SecurityGroups[0].GroupId' --output text; }
role_exists() { aws iam get-role --role-name "$1" >/dev/null 2>&1; }
create_or_replace_secret() {
  local name="$1" value="$2" existing
  existing="$(aws secretsmanager describe-secret --region "$REGION" --secret-id "$name" --query ARN --output text 2>/dev/null || true)"
  if not_found "$existing"; then
    aws secretsmanager create-secret --region "$REGION" --name "$name" --secret-string "$value" --tags Key=Project,Value=architecture-master-roadmap Key=Environment,Value=development --query ARN --output text
  else
    aws secretsmanager put-secret-value --region "$REGION" --secret-id "$existing" --secret-string "$value" >/dev/null
    printf '%s' "$existing"
  fi
}

VPC_ID="$(get_vpc)"
not_found "$VPC_ID" && { echo "No partial ${STACK} VPC was found. Run deploy-ec2-rds-fresh.sh instead." >&2; exit 1; }
PUBLIC_A="$(get_subnet "$VPC_ID" "${STACK}-public-a")"
PRIVATE_A="$(get_subnet "$VPC_ID" "${STACK}-private-db-a")"
PRIVATE_B="$(get_subnet "$VPC_ID" "${STACK}-private-db-b")"
EC2_SG="$(get_sg "$VPC_ID" "${STACK}-web-sg")"
RDS_SG="$(get_sg "$VPC_ID" "${STACK}-rds-sg")"
for item in "$PUBLIC_A" "$PRIVATE_A" "$PRIVATE_B" "$EC2_SG" "$RDS_SG"; do
  not_found "$item" && { echo "Required partial-stack resource was not found; run the fresh deployment script after controlled cleanup." >&2; exit 1; }
done

echo "Resuming private RDS creation..."
if ! aws rds describe-db-subnet-groups --region "$REGION" --db-subnet-group-name "${STACK}-db-subnets" >/dev/null 2>&1; then
  aws rds create-db-subnet-group --region "$REGION" --db-subnet-group-name "${STACK}-db-subnets" --db-subnet-group-description 'Private subnets for Architecture Master Roadmap development RDS' --subnet-ids "$PRIVATE_A" "$PRIVATE_B" --tags Key=Name,Value="${STACK}-db-subnets" Key=Project,Value=architecture-master-roadmap Key=Environment,Value=development >/dev/null
fi
if ! aws rds describe-db-instances --region "$REGION" --db-instance-identifier "$DB_ID" >/dev/null 2>&1; then
  DB_PASSWORD="$(openssl rand -hex 16)"
  aws rds create-db-instance --region "$REGION" --db-instance-identifier "$DB_ID" --db-instance-class db.t3.micro --engine mysql --engine-version 8.4.9 --allocated-storage 20 --storage-type gp3 --db-name "$DB_NAME" --master-username "$DB_USER" --master-user-password "$DB_PASSWORD" --db-subnet-group-name "${STACK}-db-subnets" --vpc-security-group-ids "$RDS_SG" --no-publicly-accessible --no-multi-az --backup-retention-period 1 --no-deletion-protection --tags Key=Name,Value="$DB_ID" Key=Project,Value=architecture-master-roadmap Key=Environment,Value=development >/dev/null
else
  echo "RDS instance already exists; retrieve its database password from the deployment record before continuing." >&2
  exit 1
fi
aws rds wait db-instance-available --region "$REGION" --db-instance-identifier "$DB_ID"
DB_ENDPOINT="$(aws rds describe-db-instances --region "$REGION" --db-instance-identifier "$DB_ID" --query 'DBInstances[0].Endpoint.Address' --output text)"

echo "Creating runtime secrets..."
DATABASE_URL_ARN="$(create_or_replace_secret 'architecture-master-roadmap/database-url' "mysql://${DB_USER}:${DB_PASSWORD}@${DB_ENDPOINT}:3306/${DB_NAME}")"
JWT_SECRET_ARN="$(create_or_replace_secret 'architecture-master-roadmap/jwt-secret' "$(openssl rand -hex 32)")"
BOOTSTRAP_SECRET_ARN="$(create_or_replace_secret 'architecture-master-roadmap/local-auth-bootstrap-token' "$BOOTSTRAP_TOKEN")"
unset BOOTSTRAP_TOKEN DB_PASSWORD

echo "Building and pushing the private-authentication image..."
if ! aws ecr describe-repositories --region "$REGION" --repository-names "$ECR_REPOSITORY" >/dev/null 2>&1; then
  aws ecr create-repository --region "$REGION" --repository-name "$ECR_REPOSITORY" --image-scanning-configuration scanOnPush=true --tags Key=Project,Value=architecture-master-roadmap Key=Environment,Value=development >/dev/null
fi
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${ECR_REPOSITORY}"
IMAGE_TAG="ec2-rds-$(date +%Y%m%d%H%M%S)"
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
docker build --platform linux/amd64 -t "${ECR_URI}:${IMAGE_TAG}" .
docker push "${ECR_URI}:${IMAGE_TAG}"
IMAGE_URI="${ECR_URI}:${IMAGE_TAG}"

echo "Creating EC2 runtime role and instance profile..."
if ! role_exists "$EC2_ROLE"; then
  aws iam create-role --role-name "$EC2_ROLE" --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  aws iam attach-role-policy --role-name "$EC2_ROLE" --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
  aws iam attach-role-policy --role-name "$EC2_ROLE" --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly
fi
aws iam put-role-policy --role-name "$EC2_ROLE" --policy-name ArchitectureMasterRoadmapReadRuntimeSecrets --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"secretsmanager:GetSecretValue\"],\"Resource\":[\"${DATABASE_URL_ARN}\",\"${JWT_SECRET_ARN}\",\"${BOOTSTRAP_SECRET_ARN}\"]}]}"
if ! aws iam get-instance-profile --instance-profile-name "$EC2_PROFILE" >/dev/null 2>&1; then
  aws iam create-instance-profile --instance-profile-name "$EC2_PROFILE" >/dev/null
  aws iam add-role-to-instance-profile --instance-profile-name "$EC2_PROFILE" --role-name "$EC2_ROLE"
  sleep 15
fi

echo "Allocating a stable public address..."
EIP_ALLOCATION_ID="$(aws ec2 allocate-address --region "$REGION" --domain vpc --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=${STACK}-eip},{Key=Project,Value=architecture-master-roadmap},{Key=Environment,Value=development}]" --query AllocationId --output text)"
EIP_PUBLIC_IP="$(aws ec2 describe-addresses --region "$REGION" --allocation-ids "$EIP_ALLOCATION_ID" --query 'Addresses[0].PublicIp' --output text)"
PUBLIC_DOMAIN="${EIP_PUBLIC_IP//./-}.nip.io"
AMI_ID="$(aws ssm get-parameter --region "$REGION" --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 --query 'Parameter.Value' --output text)"
USER_DATA="$(mktemp)"
cat > "$USER_DATA" <<EOF
#!/bin/bash
set -Eeuo pipefail
exec > >(tee -a /var/log/architecture-master-roadmap-bootstrap.log) 2>&1
REGION='${REGION}'
IMAGE_URI='${IMAGE_URI}'
DOMAIN='${PUBLIC_DOMAIN}'
DATABASE_URL_ARN='${DATABASE_URL_ARN}'
JWT_SECRET_ARN='${JWT_SECRET_ARN}'
BOOTSTRAP_SECRET_ARN='${BOOTSTRAP_SECRET_ARN}'
dnf update -y
dnf install -y docker
systemctl enable --now docker
mkdir -p /opt/architecture-master-roadmap
cat > /opt/architecture-master-roadmap/Caddyfile <<'CADDY'
{\$DOMAIN} {
  encode zstd gzip
  reverse_proxy 127.0.0.1:8080
}
CADDY
cat > /opt/architecture-master-roadmap/app.env <<ENVFILE
NODE_ENV=production
PORT=8080
DATABASE_URL=\$(aws secretsmanager get-secret-value --region "\$REGION" --secret-id "\$DATABASE_URL_ARN" --query SecretString --output text)
JWT_SECRET=\$(aws secretsmanager get-secret-value --region "\$REGION" --secret-id "\$JWT_SECRET_ARN" --query SecretString --output text)
LOCAL_AUTH_BOOTSTRAP_TOKEN=\$(aws secretsmanager get-secret-value --region "\$REGION" --secret-id "\$BOOTSTRAP_SECRET_ARN" --query SecretString --output text)
ENVFILE
chmod 600 /opt/architecture-master-roadmap/app.env
aws ecr get-login-password --region "\$REGION" | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
docker pull "\$IMAGE_URI"
for attempt in {1..12}; do
  if docker run --rm --env-file /opt/architecture-master-roadmap/app.env "\$IMAGE_URI" sh -c 'corepack pnpm exec drizzle-kit migrate'; then break; fi
  [[ "\$attempt" == 12 ]] && { echo 'Database migration failed after 12 attempts.' >&2; exit 1; }
  sleep 10
done
docker run -d --name architecture-master-roadmap --restart unless-stopped --env-file /opt/architecture-master-roadmap/app.env -p 127.0.0.1:8080:8080 "\$IMAGE_URI"
docker run -d --name architecture-master-roadmap-proxy --restart unless-stopped --network host -e DOMAIN="\$DOMAIN" -v /opt/architecture-master-roadmap/Caddyfile:/etc/caddy/Caddyfile:ro caddy:2-alpine
EOF

INSTANCE_ID="$(aws ec2 run-instances --region "$REGION" --image-id "$AMI_ID" --instance-type "$EC2_INSTANCE_TYPE" --iam-instance-profile Name="$EC2_PROFILE" --network-interfaces "DeviceIndex=0,AssociatePublicIpAddress=true,Groups=${EC2_SG},SubnetId=${PUBLIC_A}" --metadata-options 'HttpTokens=required,HttpEndpoint=enabled' --user-data "file://${USER_DATA}" --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${EC2_INSTANCE_NAME}},{Key=Project,Value=architecture-master-roadmap},{Key=Environment,Value=development}]" "ResourceType=volume,Tags=[{Key=Name,Value=${EC2_INSTANCE_NAME}-volume},{Key=Project,Value=architecture-master-roadmap},{Key=Environment,Value=development}]" --query 'Instances[0].InstanceId' --output text)"
rm -f "$USER_DATA"
aws ec2 wait instance-running --region "$REGION" --instance-ids "$INSTANCE_ID"
aws ec2 associate-address --region "$REGION" --instance-id "$INSTANCE_ID" --allocation-id "$EIP_ALLOCATION_ID" >/dev/null

echo "EC2 host created. Instance: ${INSTANCE_ID}"
echo "Expected HTTPS URL: https://${PUBLIC_DOMAIN}"
echo "First-admin setup URL: https://${PUBLIC_DOMAIN}/?setup=1"
