#!/usr/bin/env bash
set -Eeuo pipefail

# Creates a clean, development-only Architecture Master Roadmap environment:
# public EC2 application host + private RDS MySQL database inside a new VPC.
# It does not create a NAT Gateway or open SSH. Database traffic is limited to
# the EC2 security group, while SSM provides host administration.

REGION="${AWS_REGION:-us-east-1}"
STACK="architecture-master-roadmap-dev"
VPC_CIDR="10.120.0.0/16"
PUBLIC_A_CIDR="10.120.0.0/20"
PUBLIC_B_CIDR="10.120.16.0/20"
PRIVATE_A_CIDR="10.120.32.0/20"
PRIVATE_B_CIDR="10.120.48.0/20"
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

cat <<'WARNING'
This script creates a new development stack in us-east-1:
  * a dedicated VPC with two public EC2 subnets and two private RDS subnets;
  * an internet gateway but NO NAT Gateway;
  * a private MySQL RDS instance reachable only from the EC2 security group;
  * an EC2 t3.small host without SSH access, administered through AWS Systems Manager;
  * an ECR repository and three Secrets Manager secrets;
  * a TLS-terminating Caddy proxy and the private-account application container.

The application will be exposed on a temporary HTTPS nip.io hostname based on
its Elastic IP. The database will not be publicly accessible.
WARNING
read -r -p "Type CREATE_ARCHITECTURE_MASTER_ROADMAP_EC2_STACK to continue: " CONFIRMATION
[[ "$CONFIRMATION" == "CREATE_ARCHITECTURE_MASTER_ROADMAP_EC2_STACK" ]] || { echo "Confirmation did not match. No AWS resources were created."; exit 1; }
read -r -s -p "Enter LOCAL_AUTH_BOOTSTRAP_TOKEN (hidden): " BOOTSTRAP_TOKEN
echo
[[ -n "$BOOTSTRAP_TOKEN" ]] || { echo "Bootstrap token is required." >&2; exit 1; }

cleanup_on_error() {
  echo "The deployment stopped. Resource IDs printed above can be used for controlled cleanup." >&2
}
trap cleanup_on_error ERR

tag_resource() {
  aws ec2 create-tags --region "$REGION" --resources "$1" --tags "Key=Name,Value=$2" "Key=Project,Value=architecture-master-roadmap" "Key=Environment,Value=development"
}
create_secret() {
  local name="$1" value="$2"
  aws secretsmanager create-secret --region "$REGION" --name "$name" --secret-string "$value" --tags Key=Project,Value=architecture-master-roadmap Key=Environment,Value=development --query ARN --output text
}
role_exists() { aws iam get-role --role-name "$1" >/dev/null 2>&1; }

echo "Selecting two availability zones..."
mapfile -t AZS < <(aws ec2 describe-availability-zones --region "$REGION" --filters Name=state,Values=available --query 'AvailabilityZones[].ZoneName' --output text | tr '\t' '\n' | head -2)
[[ ${#AZS[@]} -eq 2 ]] || { echo "Two available zones are required." >&2; exit 1; }

echo "Creating dedicated VPC and subnets..."
VPC_ID="$(aws ec2 create-vpc --region "$REGION" --cidr-block "$VPC_CIDR" --query 'Vpc.VpcId' --output text)"
tag_resource "$VPC_ID" "${STACK}-vpc"
aws ec2 modify-vpc-attribute --region "$REGION" --vpc-id "$VPC_ID" --enable-dns-support '{"Value":true}'
aws ec2 modify-vpc-attribute --region "$REGION" --vpc-id "$VPC_ID" --enable-dns-hostnames '{"Value":true}'

IGW_ID="$(aws ec2 create-internet-gateway --region "$REGION" --query 'InternetGateway.InternetGatewayId' --output text)"
tag_resource "$IGW_ID" "${STACK}-igw"
aws ec2 attach-internet-gateway --region "$REGION" --internet-gateway-id "$IGW_ID" --vpc-id "$VPC_ID"

create_subnet() {
  local cidr="$1" az="$2" name="$3"
  local subnet
  subnet="$(aws ec2 create-subnet --region "$REGION" --vpc-id "$VPC_ID" --cidr-block "$cidr" --availability-zone "$az" --query 'Subnet.SubnetId' --output text)"
  tag_resource "$subnet" "$name"
  printf '%s' "$subnet"
}
PUBLIC_A="$(create_subnet "$PUBLIC_A_CIDR" "${AZS[0]}" "${STACK}-public-a")"
PUBLIC_B="$(create_subnet "$PUBLIC_B_CIDR" "${AZS[1]}" "${STACK}-public-b")"
PRIVATE_A="$(create_subnet "$PRIVATE_A_CIDR" "${AZS[0]}" "${STACK}-private-db-a")"
PRIVATE_B="$(create_subnet "$PRIVATE_B_CIDR" "${AZS[1]}" "${STACK}-private-db-b")"
aws ec2 modify-subnet-attribute --region "$REGION" --subnet-id "$PUBLIC_A" --map-public-ip-on-launch
aws ec2 modify-subnet-attribute --region "$REGION" --subnet-id "$PUBLIC_B" --map-public-ip-on-launch

PUBLIC_RT="$(aws ec2 create-route-table --region "$REGION" --vpc-id "$VPC_ID" --query 'RouteTable.RouteTableId' --output text)"
tag_resource "$PUBLIC_RT" "${STACK}-public-routes"
aws ec2 create-route --region "$REGION" --route-table-id "$PUBLIC_RT" --destination-cidr-block 0.0.0.0/0 --gateway-id "$IGW_ID" >/dev/null
aws ec2 associate-route-table --region "$REGION" --route-table-id "$PUBLIC_RT" --subnet-id "$PUBLIC_A" >/dev/null
aws ec2 associate-route-table --region "$REGION" --route-table-id "$PUBLIC_RT" --subnet-id "$PUBLIC_B" >/dev/null

echo "Creating least-privilege security groups..."
EC2_SG="$(aws ec2 create-security-group --region "$REGION" --vpc-id "$VPC_ID" --group-name "${STACK}-web-sg" --description 'Architecture Master Roadmap web host' --query GroupId --output text)"
tag_resource "$EC2_SG" "${STACK}-web-sg"
aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$EC2_SG" --ip-permissions '[{"IpProtocol":"tcp","FromPort":80,"ToPort":80,"IpRanges":[{"CidrIp":"0.0.0.0/0","Description":"HTTP redirects to HTTPS"}]},{"IpProtocol":"tcp","FromPort":443,"ToPort":443,"IpRanges":[{"CidrIp":"0.0.0.0/0","Description":"HTTPS application access"}]}]'
RDS_SG="$(aws ec2 create-security-group --region "$REGION" --vpc-id "$VPC_ID" --group-name "${STACK}-rds-sg" --description 'Architecture Master Roadmap private RDS access' --query GroupId --output text)"
tag_resource "$RDS_SG" "${STACK}-rds-sg"
aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$RDS_SG" --ip-permissions "[{\"IpProtocol\":\"tcp\",\"FromPort\":3306,\"ToPort\":3306,\"UserIdGroupPairs\":[{\"GroupId\":\"${EC2_SG}\",\"Description\":\"MySQL from the application host only\"}]}]"

echo "Creating the private RDS database..."
DB_SUBNET_GROUP="${STACK}-db-subnets"
aws rds create-db-subnet-group --region "$REGION" --db-subnet-group-name "$DB_SUBNET_GROUP" --db-subnet-group-description 'Private subnets for Architecture Master Roadmap development RDS' --subnet-ids "$PRIVATE_A" "$PRIVATE_B" --tags Key=Name,Value="$DB_SUBNET_GROUP" Key=Project,Value=architecture-master-roadmap Key=Environment,Value=development >/dev/null
DB_PASSWORD="$(openssl rand -hex 16)"
aws rds create-db-instance --region "$REGION" --db-instance-identifier "$DB_ID" --db-instance-class db.t3.micro --engine mysql --engine-version 8.4.9 --allocated-storage 20 --storage-type gp3 --db-name "$DB_NAME" --master-username "$DB_USER" --master-user-password "$DB_PASSWORD" --db-subnet-group-name "$DB_SUBNET_GROUP" --vpc-security-group-ids "$RDS_SG" --no-publicly-accessible --no-multi-az --backup-retention-period 1 --no-deletion-protection --tags Key=Name,Value="$DB_ID" Key=Project,Value=architecture-master-roadmap Key=Environment,Value=development >/dev/null
aws rds wait db-instance-available --region "$REGION" --db-instance-identifier "$DB_ID"
DB_ENDPOINT="$(aws rds describe-db-instances --region "$REGION" --db-instance-identifier "$DB_ID" --query 'DBInstances[0].Endpoint.Address' --output text)"

echo "Creating runtime secrets..."
DATABASE_URL_ARN="$(create_secret 'architecture-master-roadmap/database-url' "mysql://${DB_USER}:${DB_PASSWORD}@${DB_ENDPOINT}:3306/${DB_NAME}")"
JWT_SECRET_ARN="$(create_secret 'architecture-master-roadmap/jwt-secret' "$(openssl rand -hex 48)")"
BOOTSTRAP_SECRET_ARN="$(create_secret 'architecture-master-roadmap/local-auth-bootstrap-token' "$BOOTSTRAP_TOKEN")"
unset BOOTSTRAP_TOKEN DB_PASSWORD

echo "Creating ECR repository and container image..."
if ! aws ecr describe-repositories --region "$REGION" --repository-names "$ECR_REPOSITORY" >/dev/null 2>&1; then
  aws ecr create-repository --region "$REGION" --repository-name "$ECR_REPOSITORY" --image-scanning-configuration scanOnPush=true --tags Key=Project,Value=architecture-master-roadmap Key=Environment,Value=development >/dev/null
fi
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${ECR_REPOSITORY}"
IMAGE_TAG="ec2-rds-$(date +%Y%m%d%H%M%S)"
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
docker build --platform linux/amd64 -t "${ECR_URI}:${IMAGE_TAG}" .
docker push "${ECR_URI}:${IMAGE_TAG}"
IMAGE_URI="${ECR_URI}:${IMAGE_TAG}"

echo "Creating EC2 IAM role and instance profile..."
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

echo "Allocating a stable public address and preparing EC2 bootstrap..."
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
  if docker run --rm --env-file /opt/architecture-master-roadmap/app.env "\$IMAGE_URI" sh -c 'corepack pnpm exec drizzle-kit migrate'; then
    break
  fi
  if [[ "\$attempt" == 12 ]]; then
    echo 'Database migration failed after 12 attempts.' >&2
    exit 1
  fi
  sleep 10
done
docker rm -f architecture-master-roadmap 2>/dev/null || true
docker run -d --name architecture-master-roadmap --restart unless-stopped --env-file /opt/architecture-master-roadmap/app.env -p 127.0.0.1:8080:8080 "\$IMAGE_URI"
docker rm -f architecture-master-roadmap-proxy 2>/dev/null || true
docker run -d --name architecture-master-roadmap-proxy --restart unless-stopped --network host -e DOMAIN="\$DOMAIN" -v /opt/architecture-master-roadmap/Caddyfile:/etc/caddy/Caddyfile:ro caddy:2-alpine
EOF

INSTANCE_ID="$(aws ec2 run-instances --region "$REGION" --image-id "$AMI_ID" --instance-type "$EC2_INSTANCE_TYPE" --iam-instance-profile Name="$EC2_PROFILE" --network-interfaces "DeviceIndex=0,AssociatePublicIpAddress=true,Groups=${EC2_SG},SubnetId=${PUBLIC_A}" --metadata-options 'HttpTokens=required,HttpEndpoint=enabled' --user-data "file://${USER_DATA}" --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${EC2_INSTANCE_NAME}},{Key=Project,Value=architecture-master-roadmap},{Key=Environment,Value=development}]" "ResourceType=volume,Tags=[{Key=Name,Value=${EC2_INSTANCE_NAME}-volume},{Key=Project,Value=architecture-master-roadmap},{Key=Environment,Value=development}]" --query 'Instances[0].InstanceId' --output text)"
rm -f "$USER_DATA"
aws ec2 wait instance-running --region "$REGION" --instance-ids "$INSTANCE_ID"
aws ec2 associate-address --region "$REGION" --instance-id "$INSTANCE_ID" --allocation-id "$EIP_ALLOCATION_ID" >/dev/null

cat <<RESULT

EC2 host created successfully.
  Instance ID: ${INSTANCE_ID}
  Public IP: ${EIP_PUBLIC_IP}
  Expected HTTPS URL: https://${PUBLIC_DOMAIN}
  Bootstrap log (after SSM registration): /var/log/architecture-master-roadmap-bootstrap.log

The first administrator is initialized only at https://${PUBLIC_DOMAIN}/?setup=1
using the same bootstrap token you entered above. Do not share that token.
RESULT
