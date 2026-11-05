#!/usr/bin/env bash
set -Eeuo pipefail

# Rebuild and restart an existing Architecture Master Roadmap EC2 deployment
# after its initial user-data migration failed. The VPC, private RDS instance,
# EC2 host, and Secrets Manager references are reused; no network resources
# are created or modified.
REGION="${AWS_REGION:-us-east-1}"
ECR_REPOSITORY="architecture-master-roadmap"
INSTANCE_NAME="architecture-master-roadmap-web"

command -v aws >/dev/null 2>&1 || { echo "Required command not found: aws" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "Required command not found: docker (run this from AWS CloudShell)" >&2; exit 1; }

read -r -p "Type RECOVER_ARCHITECTURE_MASTER_ROADMAP_EC2 to continue: " CONFIRMATION
[[ "$CONFIRMATION" == "RECOVER_ARCHITECTURE_MASTER_ROADMAP_EC2" ]] || { echo "Confirmation did not match. No AWS resources were changed."; exit 1; }

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
INSTANCE_ID="$(aws ec2 describe-instances --region "$REGION" --filters "Name=tag:Name,Values=${INSTANCE_NAME}" Name=instance-state-name,Values=running --query 'Reservations[].Instances[0].InstanceId' --output text)"
[[ -n "$INSTANCE_ID" && "$INSTANCE_ID" != "None" ]] || { echo "Running EC2 instance ${INSTANCE_NAME} was not found." >&2; exit 1; }

EIP_PUBLIC_IP="$(aws ec2 describe-addresses --region "$REGION" --filters "Name=tag:Name,Values=architecture-master-roadmap-dev-eip" --query 'Addresses[0].PublicIp' --output text)"
[[ -n "$EIP_PUBLIC_IP" && "$EIP_PUBLIC_IP" != "None" ]] || { echo "Architecture Master Roadmap Elastic IP was not found." >&2; exit 1; }
PUBLIC_DOMAIN="${EIP_PUBLIC_IP//./-}.nip.io"

ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${ECR_REPOSITORY}"
IMAGE_TAG="ec2-rds-migration-fix-$(date +%Y%m%d%H%M%S)"
aws ecr describe-repositories --region "$REGION" --repository-names "$ECR_REPOSITORY" >/dev/null
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
docker build --platform linux/amd64 -t "${ECR_URI}:${IMAGE_TAG}" .
docker push "${ECR_URI}:${IMAGE_TAG}"
IMAGE_URI="${ECR_URI}:${IMAGE_TAG}"

REMOTE_SCRIPT="$(cat <<EOF
set -Eeuo pipefail
IMAGE_URI='${IMAGE_URI}'
aws ecr get-login-password --region '${REGION}' | sudo docker login --username AWS --password-stdin '${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com'
sudo docker pull "\$IMAGE_URI"
sudo docker run --rm --env-file /opt/architecture-master-roadmap/app.env "\$IMAGE_URI" sh -c 'corepack pnpm exec drizzle-kit migrate'
sudo docker rm -f architecture-master-roadmap 2>/dev/null || true
sudo docker run -d --name architecture-master-roadmap --restart unless-stopped --env-file /opt/architecture-master-roadmap/app.env -p 127.0.0.1:8080:8080 "\$IMAGE_URI"
sudo docker rm -f architecture-master-roadmap-proxy 2>/dev/null || true
sudo tee /opt/architecture-master-roadmap/Caddyfile >/dev/null <<'CADDY'
${PUBLIC_DOMAIN} {
  encode zstd gzip
  reverse_proxy 127.0.0.1:8080
}
CADDY
sudo docker run -d --name architecture-master-roadmap-proxy --restart unless-stopped --network host -v /opt/architecture-master-roadmap/Caddyfile:/etc/caddy/Caddyfile:ro caddy:2-alpine
sleep 10
curl --fail --silent --show-error http://127.0.0.1:8080/health
EOF
)"
REMOTE_SCRIPT_B64="$(printf '%s' "$REMOTE_SCRIPT" | base64 -w 0)"
COMMAND_ID="$(aws ssm send-command --region "$REGION" --document-name AWS-RunShellScript --instance-ids "$INSTANCE_ID" --comment 'Recover Architecture Master Roadmap after corrected private-account migration' --parameters "commands=[\"echo ${REMOTE_SCRIPT_B64} | base64 -d | sudo bash\"]" --query 'Command.CommandId' --output text)"

echo "Recovery command submitted: ${COMMAND_ID}"
echo "Instance: ${INSTANCE_ID}"
echo "Expected HTTPS URL: https://${PUBLIC_DOMAIN}"
echo "Check status with: aws ssm get-command-invocation --region ${REGION} --command-id ${COMMAND_ID} --instance-id ${INSTANCE_ID} --output json"
