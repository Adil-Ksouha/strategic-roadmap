#!/usr/bin/env bash
set -Eeuo pipefail

# IRREVERSIBLE: Deletes only the approved Northstar DEVELOPMENT stack and its
# dummy RDS data in us-east-1. It never discovers or deletes non-Northstar
# resources. Run only after the owner confirms the exact phrase at the prompt.
REGION="${AWS_REGION:-us-east-1}"
VPC_ID="vpc-015ab626943e9ea38"
DB_ID="northstar-db"
DB_SUBNET_GROUP="northstar-db-subnets"
VPC_CONNECTOR_ARN="arn:aws:apprunner:us-east-1:026090547003:vpcconnector/northstar-vpc-connector/1/a146551ff5de40d2a76703ca424a524d"
FAILED_SERVICE_ARN="arn:aws:apprunner:us-east-1:026090547003:service/northstar-private-auth/86f18a0a63d94e8db60ee19593421998"
SUBNETS=("subnet-07aaeb2db068b31d8" "subnet-039bac1e42bc2226f" "subnet-0541f4b8d6424a15a" "subnet-0f4035151606acf86")
ROUTE_TABLES=("rtb-04f3f4513cb98c73e" "rtb-006650e67f46d800e")
SECURITY_GROUPS=("sg-04b5ae8f2e027552d" "sg-06058c00bc6da6f41")
INTERNET_GATEWAY="igw-0cd8e4e569cbdda46"
FORMER_NAT_EIP="eipalloc-02c90732168088597"
ROLES=("northstar-apprunner-ecr-role" "northstar-apprunner-instance-role")
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
This permanently deletes only the approved Northstar DEVELOPMENT resources:
  * failed App Runner service northstar-private-auth
  * VPC connector northstar-vpc-connector
  * RDS instance northstar-db (without final snapshot) and dummy data
  * ECR repository northstar and its images
  * six northstar/* Secrets Manager entries
  * Northstar VPC, subnets, route tables, internet gateway, and named security groups
  * named Northstar IAM roles and the former NAT Elastic IP if it remains allocated

No unrelated AWS resources are selected by this script.
WARNING
read -r -p "Type DELETE_NORTHSTAR_DEVELOPMENT_STACK to continue: " CONFIRMATION
[[ "$CONFIRMATION" == "DELETE_NORTHSTAR_DEVELOPMENT_STACK" ]] || { echo "Confirmation did not match. No resources were deleted."; exit 1; }

exists() { "$@" >/dev/null 2>&1; }
wait_until_absent() {
  local label="$1"; shift
  for _ in $(seq 1 90); do
    if ! "$@" >/dev/null 2>&1; then
      echo "${label} is deleted."
      return 0
    fi
    sleep 10
  done
  echo "Timed out waiting for ${label} deletion." >&2
  return 1
}

echo "Deleting failed App Runner service, if it remains..."
if exists aws apprunner describe-service --region "$REGION" --service-arn "$FAILED_SERVICE_ARN"; then
  aws apprunner delete-service --region "$REGION" --service-arn "$FAILED_SERVICE_ARN" >/dev/null
  wait_until_absent "App Runner service" aws apprunner describe-service --region "$REGION" --service-arn "$FAILED_SERVICE_ARN"
fi

echo "Deleting App Runner VPC connector, if it remains..."
if exists aws apprunner describe-vpc-connector --region "$REGION" --vpc-connector-arn "$VPC_CONNECTOR_ARN"; then
  aws apprunner delete-vpc-connector --region "$REGION" --vpc-connector-arn "$VPC_CONNECTOR_ARN" >/dev/null
  wait_until_absent "VPC connector" aws apprunner describe-vpc-connector --region "$REGION" --vpc-connector-arn "$VPC_CONNECTOR_ARN"
fi

echo "Deleting dummy RDS instance without a final snapshot..."
if exists aws rds describe-db-instances --region "$REGION" --db-instance-identifier "$DB_ID"; then
  aws rds delete-db-instance --region "$REGION" --db-instance-identifier "$DB_ID" --skip-final-snapshot --delete-automated-backups >/dev/null
  aws rds wait db-instance-deleted --region "$REGION" --db-instance-identifier "$DB_ID"
fi
if exists aws rds describe-db-subnet-groups --region "$REGION" --db-subnet-group-name "$DB_SUBNET_GROUP"; then
  aws rds delete-db-subnet-group --region "$REGION" --db-subnet-group-name "$DB_SUBNET_GROUP"
fi

echo "Deleting Northstar ECR repository and images..."
if exists aws ecr describe-repositories --region "$REGION" --repository-names northstar; then
  aws ecr delete-repository --region "$REGION" --repository-name northstar --force >/dev/null
fi

echo "Deleting Northstar runtime secrets without recovery..."
for secret in "${SECRETS[@]}"; do
  if exists aws secretsmanager describe-secret --region "$REGION" --secret-id "$secret"; then
    aws secretsmanager delete-secret --region "$REGION" --secret-id "$secret" --force-delete-without-recovery >/dev/null
  fi
done

echo "Deleting App Runner log groups..."
while IFS= read -r log_group; do
  [[ -n "$log_group" ]] && aws logs delete-log-group --region "$REGION" --log-group-name "$log_group"
done < <(aws logs describe-log-groups --region "$REGION" --log-group-name-prefix '/aws/apprunner/northstar' --query 'logGroups[].logGroupName' --output text)

echo "Deleting Northstar security groups..."
for security_group in "${SECURITY_GROUPS[@]}"; do
  if exists aws ec2 describe-security-groups --region "$REGION" --group-ids "$security_group"; then
    aws ec2 delete-security-group --region "$REGION" --group-id "$security_group"
  fi
done

echo "Deleting Northstar network resources..."
for subnet in "${SUBNETS[@]}"; do
  if exists aws ec2 describe-subnets --region "$REGION" --subnet-ids "$subnet"; then
    aws ec2 delete-subnet --region "$REGION" --subnet-id "$subnet"
  fi
done
for route_table in "${ROUTE_TABLES[@]}"; do
  if exists aws ec2 describe-route-tables --region "$REGION" --route-table-ids "$route_table"; then
    aws ec2 delete-route-table --region "$REGION" --route-table-id "$route_table"
  fi
done
if exists aws ec2 describe-internet-gateways --region "$REGION" --internet-gateway-ids "$INTERNET_GATEWAY"; then
  aws ec2 detach-internet-gateway --region "$REGION" --internet-gateway-id "$INTERNET_GATEWAY" --vpc-id "$VPC_ID"
  aws ec2 delete-internet-gateway --region "$REGION" --internet-gateway-id "$INTERNET_GATEWAY"
fi
if exists aws ec2 describe-vpcs --region "$REGION" --vpc-ids "$VPC_ID"; then
  aws ec2 delete-vpc --region "$REGION" --vpc-id "$VPC_ID"
fi

echo "Releasing the former NAT Elastic IP if it is still allocated..."
if exists aws ec2 describe-addresses --region "$REGION" --allocation-ids "$FORMER_NAT_EIP"; then
  aws ec2 release-address --region "$REGION" --allocation-id "$FORMER_NAT_EIP"
fi

echo "Deleting Northstar IAM roles..."
for role in "${ROLES[@]}"; do
  if exists aws iam get-role --role-name "$role"; then
    while IFS= read -r policy; do
      [[ -n "$policy" ]] && aws iam detach-role-policy --role-name "$role" --policy-arn "$policy"
    done < <(aws iam list-attached-role-policies --role-name "$role" --query 'AttachedPolicies[].PolicyArn' --output text)
    while IFS= read -r policy; do
      [[ -n "$policy" ]] && aws iam delete-role-policy --role-name "$role" --policy-name "$policy"
    done < <(aws iam list-role-policies --role-name "$role" --query 'PolicyNames[]' --output text)
    aws iam delete-role --role-name "$role"
  fi
done

echo "Northstar development stack deletion completed. Run the inventory script again to confirm no approved resources remain."
