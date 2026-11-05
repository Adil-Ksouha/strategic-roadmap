#!/usr/bin/env bash
set -Eeuo pipefail

# IRREVERSIBLE PARTIAL CLEANUP: Deletes approved Northstar development data
# resources while preserving all App Runner services and their VPC/IAM dependencies.
REGION="${AWS_REGION:-us-east-1}"
DB_ID="northstar-db"
DB_SUBNET_GROUP="northstar-db-subnets"
RDS_SECURITY_GROUP="sg-04b5ae8f2e027552d"
ECR_REPOSITORY="northstar"
SECRETS=(
  "northstar/database-url"
  "northstar/jwt-secret"
  "northstar/google-client-id"
  "northstar/google-client-secret"
  "northstar/platform-admin-email"
  "northstar/local-auth-bootstrap-token"
)

command -v aws >/dev/null 2>&1 || { echo "Required command not found: aws" >&2; exit 1; }
aws sts get-caller-identity --region "$REGION" >/dev/null

cat <<'WARNING'
This permanently deletes only the approved Northstar non-App-Runner development resources:
  * RDS instance northstar-db and its dummy data (without final snapshot)
  * RDS subnet group northstar-db-subnets
  * RDS security group northstar-rds-sg, after database deletion
  * ECR repository northstar and all images
  * six northstar/* Secrets Manager entries
  * App Runner CloudWatch log groups

It explicitly preserves all App Runner services, the VPC connector, VPC, subnets,
route tables, internet gateway, App Runner security group, and IAM roles. Those
resources cannot be removed safely until the user manually deletes App Runner.
WARNING
read -r -p "Type DELETE_NORTHSTAR_NON_APPRUNNER_RESOURCES to continue: " CONFIRMATION
[[ "$CONFIRMATION" == "DELETE_NORTHSTAR_NON_APPRUNNER_RESOURCES" ]] || { echo "Confirmation did not match. No resources were deleted."; exit 1; }

exists() { "$@" >/dev/null 2>&1; }

echo "Deleting dummy RDS instance without a final snapshot..."
if exists aws rds describe-db-instances --region "$REGION" --db-instance-identifier "$DB_ID"; then
  aws rds delete-db-instance --region "$REGION" --db-instance-identifier "$DB_ID" --skip-final-snapshot --delete-automated-backups >/dev/null
  aws rds wait db-instance-deleted --region "$REGION" --db-instance-identifier "$DB_ID"
fi

echo "Deleting RDS subnet group and dedicated RDS security group..."
if exists aws rds describe-db-subnet-groups --region "$REGION" --db-subnet-group-name "$DB_SUBNET_GROUP"; then
  aws rds delete-db-subnet-group --region "$REGION" --db-subnet-group-name "$DB_SUBNET_GROUP"
fi
if exists aws ec2 describe-security-groups --region "$REGION" --group-ids "$RDS_SECURITY_GROUP"; then
  aws ec2 delete-security-group --region "$REGION" --group-id "$RDS_SECURITY_GROUP"
fi

echo "Deleting Northstar ECR repository and images..."
if exists aws ecr describe-repositories --region "$REGION" --repository-names "$ECR_REPOSITORY"; then
  aws ecr delete-repository --region "$REGION" --repository-name "$ECR_REPOSITORY" --force >/dev/null
fi

echo "Deleting Northstar secrets without recovery..."
for secret in "${SECRETS[@]}"; do
  if exists aws secretsmanager describe-secret --region "$REGION" --secret-id "$secret"; then
    aws secretsmanager delete-secret --region "$REGION" --secret-id "$secret" --force-delete-without-recovery >/dev/null
  fi
done

echo "Deleting App Runner log groups..."
while IFS= read -r log_group; do
  [[ -n "$log_group" ]] && aws logs delete-log-group --region "$REGION" --log-group-name "$log_group"
done < <(aws logs describe-log-groups --region "$REGION" --log-group-name-prefix '/aws/apprunner/northstar' --query 'logGroups[].logGroupName' --output text)

echo "Partial cleanup complete. After you manually delete the remaining App Runner service(s), run the full cleanup script to remove the VPC connector, VPC, route tables, subnets, App Runner security group, internet gateway, and IAM roles."
