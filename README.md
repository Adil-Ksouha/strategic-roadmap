# Northstar AWS Deployment

The `deploy-northstar.sh` script provisions the approved AWS App Runner, Amazon RDS for MySQL, Amazon ECR, AWS Secrets Manager, Amazon S3, IAM roles, security groups, a dedicated VPC, private subnets, and a NAT gateway. The NAT gateway allows the private App Runner workload to reach Google’s OAuth endpoints while the database remains private. It is designed to be executed in AWS CloudShell from an unpacked deployment bundle.

The script asks only for the Google OAuth Client ID and Client Secret. It sends them directly to AWS Secrets Manager and does not print their values. It creates a new private RDS instance when `northstar-db` does not yet exist; reruns reuse the service and database, but a reused database must have a valid `northstar/database-url` secret.

After the script prints the App Runner URL, the Google OAuth Web Client must include the corresponding redirect URI: `https://<app-runner-service-url>/api/auth/google/callback`. This is mandatory before Google sign-in can work from the AWS-hosted application.

For later application updates, run `aws/redeploy-northstar.sh` from a freshly unpacked deployment bundle. It builds a new ECR image and updates the existing App Runner service without recreating the private network, database, assets, or secrets.
