#!/usr/bin/env bash
set -Eeuo pipefail

# Read-only inventory of the approved Architecture Master Roadmap development stack.
# It identifies only known Northstar-named resources and the dedicated development VPC.
REGION="${AWS_REGION:-us-east-1}"
VPC_ID="${VPC_ID:-vpc-015ab626943e9ea38}"

command -v aws >/dev/null 2>&1 || { echo "Required command not found: aws" >&2; exit 1; }

section() { printf '\n===== %s =====\n' "$1"; }

section "App Runner services"
aws apprunner list-services --region "$REGION" --query "ServiceSummaryList[?starts_with(ServiceName, 'northstar')].{Name:ServiceName,Arn:ServiceArn,Status:Status,Url:ServiceUrl}" --output table

section "App Runner VPC connectors"
aws apprunner list-vpc-connectors --region "$REGION" --query "VpcConnectors[?starts_with(VpcConnectorName, 'northstar')].{Name:VpcConnectorName,Arn:VpcConnectorArn,Status:Status,Subnets:Subnets,SecurityGroups:SecurityGroups}" --output table

section "RDS instances"
aws rds describe-db-instances --region "$REGION" --query "DBInstances[?starts_with(DBInstanceIdentifier, 'northstar')].{Identifier:DBInstanceIdentifier,Status:DBInstanceStatus,Engine:Engine,SubnetGroup:DBSubnetGroup.DBSubnetGroupName,SecurityGroups:VpcSecurityGroups[].VpcSecurityGroupId}" --output table

section "RDS subnet groups"
aws rds describe-db-subnet-groups --region "$REGION" --query "DBSubnetGroups[?starts_with(DBSubnetGroupName, 'northstar')].{Name:DBSubnetGroupName,VpcId:VpcId,Subnets:Subnets[].SubnetIdentifier}" --output table

section "ECR repositories"
aws ecr describe-repositories --region "$REGION" --query "repositories[?starts_with(repositoryName, 'northstar')].{Name:repositoryName,Arn:repositoryArn,Uri:repositoryUri}" --output table || true

section "Secrets Manager secrets"
aws secretsmanager list-secrets --region "$REGION" --query "SecretList[?starts_with(Name, 'northstar')].{Name:Name,Arn:ARN,DeletedDate:DeletedDate}" --output table

section "VPC and network resources"
aws ec2 describe-vpcs --region "$REGION" --vpc-ids "$VPC_ID" --query 'Vpcs[].{VpcId:VpcId,Cidr:CidrBlock,State:State,Tags:Tags}' --output table
aws ec2 describe-subnets --region "$REGION" --filters Name=vpc-id,Values="$VPC_ID" --query 'Subnets[].{SubnetId:SubnetId,AvailabilityZone:AvailabilityZone,Cidr:CidrBlock,Tags:Tags}' --output table
aws ec2 describe-route-tables --region "$REGION" --filters Name=vpc-id,Values="$VPC_ID" --query 'RouteTables[].{RouteTableId:RouteTableId,Main:Associations[?Main==`true`]|[0].Main,Routes:Routes[].[DestinationCidrBlock,NatGatewayId,GatewayId]}' --output json
aws ec2 describe-internet-gateways --region "$REGION" --filters Name=attachment.vpc-id,Values="$VPC_ID" --query 'InternetGateways[].{InternetGatewayId:InternetGatewayId,Attachments:Attachments}' --output table
aws ec2 describe-nat-gateways --region "$REGION" --filter Name=vpc-id,Values="$VPC_ID" --query 'NatGateways[].{NatGatewayId:NatGatewayId,State:State,SubnetId:SubnetId,AllocationId:NatGatewayAddresses[0].AllocationId}' --output table
aws ec2 describe-security-groups --region "$REGION" --filters Name=vpc-id,Values="$VPC_ID" --query "SecurityGroups[?starts_with(GroupName, 'northstar')].{Name:GroupName,GroupId:GroupId,Description:Description}" --output table
aws ec2 describe-addresses --region "$REGION" --query "Addresses[?starts_with(Tags[?Key=='Name'].Value | [0], 'northstar') || contains(AssociationId || '', 'nat')].{AllocationId:AllocationId,PublicIp:PublicIp,AssociationId:AssociationId,Tags:Tags}" --output table || true

section "CloudWatch log groups"
aws logs describe-log-groups --region "$REGION" --log-group-name-prefix '/aws/apprunner/northstar' --query 'logGroups[].{Name:logGroupName,StoredBytes:storedBytes}' --output table

section "Northstar IAM roles"
aws iam list-roles --query "Roles[?starts_with(RoleName, 'northstar')].{RoleName:RoleName,Arn:Arn,CreateDate:CreateDate}" --output table

echo
echo "Read-only inventory complete. Review the output before running any deletion command."
