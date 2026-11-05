# Deployment and Integration Notes

## AWS Deployment Direction

Northstar is a Node.js application with an Express server, a MySQL-compatible Drizzle data layer, Google OAuth secrets, and a static visual asset currently served through the managed project storage path. A portable AWS deployment should use a managed web runtime, a MySQL-compatible managed database, and a dedicated secret store. AWS App Runner supports Node.js web services and can consume secrets from AWS Secrets Manager. The recommended production topology is App Runner, Amazon RDS for MySQL, Amazon S3 or CloudFront for static media, and AWS Secrets Manager for database and Google OAuth credentials.

The user authorized resource creation in AWS Region `us-east-1` (US East, N. Virginia). AWS Console access was verified through the user-controlled browser, and CloudShell was opened to support the approved deployment workflow.

## Current App Runner Service State

The existing `northstar` service is running in `us-east-1` under ARN `arn:aws:apprunner:us-east-1:026090547003:service/northstar/47926377857b4937b86ccc8982dcd89a`. It exposes `https://pv2wet98bu.us-east-1.awsapprunner.com` publicly and currently references ECR image `026090547003.dkr.ecr.us-east-1.amazonaws.com/northstar:20260829185338`.

The next deployment must replace the prior Google-federated image with the validated administrator-managed private account build. It must preserve the existing App Runner service and current VPC/RDS topology; no NAT Gateway or route change is part of this deployment.

The service uses manual ECR deployments on port `8080`, the `northstar-apprunner-ecr-role` for image access, and the `northstar-apprunner-instance-role` at runtime. It already receives `DATABASE_URL` and `JWT_SECRET` from AWS Secrets Manager and runs with `APP_BASE_URL=https://pv2wet98bu.us-east-1.awsapprunner.com`. The private-account release requires adding an AWS Secrets Manager runtime variable named `LOCAL_AUTH_BOOTSTRAP_TOKEN`; the existing Google client and platform-admin-email variables are obsolete after this cutover.

An authenticated AWS CloudShell drawer is available in the owner’s AWS Console session. The deployment should build and push a new ECR image, add the existing project bootstrap token to AWS Secrets Manager without revealing it in terminal history, update the App Runner runtime secret mapping, and initiate a manual deployment. The browser automation cannot safely type an undisclosed bootstrap secret into CloudShell.

The App Runner configuration confirms outbound traffic uses the `northstar-vpc-connector` on private subnets `subnet-0541f4b8d6424a15a` and `subnet-0f4035151606acf86`. The AWS VPC Console did not return route-table or NAT resource data through browser extraction, so the final NAT dependency inventory must be performed with AWS CLI commands in the authenticated CloudShell session before any route or gateway deletion is considered.

CloudShell inventory confirmed `nat-0f55bf77e3e765039` is available in the same VPC. Route table `rtb-04f3f4513cb98c73e` is associated with both App Runner connector subnets and has its `0.0.0.0/0` route directed to that NAT Gateway. This route must not be removed until the private-authentication build is live and its database connection has been validated using the connector’s local VPC route.

## NAT-Free Cutover Requirements

AWS documents that an App Runner service configured with Custom VPC egress routes all application outbound traffic according to the selected VPC’s networking rules. A NAT Gateway is only needed for public-internet egress; private VPC resources such as the existing RDS database remain reachable through the VPC-local route. App Runner-managed image pulls, log delivery, and secret retrieval do not use the service VPC connector.[1]

The safe cutover is therefore: first deploy and validate the private-account application while the NAT route remains; then remove only the `0.0.0.0/0` route from `rtb-04f3f4513cb98c73e`; verify private-account sign-in and database-backed portfolio reads/writes; and only then, after a separate confirmation, delete `nat-0f55bf77e3e765039` and release its Elastic IP. Keeping the NAT resource alive during route validation provides an immediate rollback path by restoring the deleted default route.

The NAT Gateway uses Elastic IP allocation `eipalloc-02c90732168088597` (`18.206.50.227`) in `subnet-07aaeb2db068b31d8`. If the reversible route test shows an unexpected private-RDS connectivity issue, restore `0.0.0.0/0` in `rtb-04f3f4513cb98c73e` with target `nat-0f55bf77e3e765039`. The gateway and Elastic IP will remain untouched during that test.

The `0.0.0.0/0` NAT route removal was completed in the no-traffic development environment. The public App Runner endpoint remained reachable and loaded the database-backed portfolio successfully, demonstrating that the App Runner-to-RDS path continues over the VPC-local route without the NAT default route. The NAT Gateway and Elastic IP remain present but are no longer used by the App Runner connector subnets.

The follow-up AWS CLI query returned an empty result for the connector route table’s `0.0.0.0/0` route. This confirms `rtb-04f3f4513cb98c73e` no longer points default outbound traffic to `nat-0f55bf77e3e765039`. The route test is complete and the remaining action is deletion of the unused NAT Gateway followed by release of `eipalloc-02c90732168088597`.

## Confirmed Full Development Reset Scope

The owner confirmed that `northstar-db` contains only dummy data and authorized a full reset. The resource inventory identified the failed `northstar-private-auth` App Runner service, `northstar-vpc-connector`, `northstar-db` and `northstar-db-subnets`, ECR repository `northstar`, six `northstar/*` Secrets Manager entries, VPC `vpc-015ab626943e9ea38`, four Northstar subnets, two non-main route tables, internet gateway `igw-0cd8e4e569cbdda46`, and two named Northstar security groups. The NAT Gateway no longer appeared in this inventory; its former default route has already been removed. The cleanup script is deliberately limited to this recorded resource set and does not discover or delete unrelated account resources.

## EC2 and Private RDS Replacement Design

The owner confirmed that the prior partial development stack has been removed and selected a new dedicated VPC with a public EC2 application host and non-public RDS MySQL database. The replacement is intentionally NAT-free: the EC2 instance receives public web traffic only on ports 80 and 443 and uses an internet gateway for operating-system, ECR, and TLS certificate access. The RDS instance sits in two private database subnets with public access disabled; its security group allows TCP/3306 only from the EC2 application security group.

The EC2 bootstrap uses an Amazon Linux 2023 AMI, an instance profile limited to SSM, ECR read, and the three runtime Secrets Manager values, a one-off `drizzle-kit migrate` container, and then starts the application and Caddy containers. The public health path is `/health`; application authentication stays administrator-managed local email/password. The RDS MySQL master password generator was reduced to a random 32-character hexadecimal value after the initial 48-character value exceeded the RDS parameter limit. The corrected fresh and idempotent-resume scripts were syntax-checked and the application passed type checking, all 27 unit tests, and a production build.

The initial EC2 bootstrap then exposed a MySQL syntax incompatibility in the conditional private-account migration. The migration was changed to standard `ALTER TABLE ... ADD COLUMN` syntax for the fresh RDS instance, the EC2 image was rebuilt, and the Session Manager recovery command completed successfully. It applied all migrations, restarted the `architecture-master-roadmap` and `architecture-master-roadmap-proxy` containers, and returned `{"status":"ok"}` from `http://127.0.0.1:8080/health` on the host. Public HTTPS and first-administrator dashboard behavior remain the final validation steps.

## EC2 to App Runner Migration Prerequisites

The current EC2/RDS environment is in VPC `vpc-0cbb9dbb03493aeaf`. RDS instance `architecture-master-roadmap-db` is available at `architecture-master-roadmap-db.cxosco8u4zb7.us-east-1.rds.amazonaws.com:3306` and is protected by `sg-0a9b2df72e2f664aa` (`architecture-master-roadmap-dev-rds-sg`). The current EC2 host uses `sg-026f9d48945e2356b` (`architecture-master-roadmap-dev-web-sg`). There is no active App Runner service in this environment. The remaining `northstar-vpc-connector` is bound to a different older subnet/security-group set and must not be reused. The migration will create a dedicated connector in the current VPC’s two private RDS subnets and add a least-privilege inbound MySQL rule from that connector’s new security group to the current RDS security group. Runtime secret references are already present under `architecture-master-roadmap/database-url`, `architecture-master-roadmap/jwt-secret`, and `architecture-master-roadmap/local-auth-bootstrap-token`.

The App Runner replacement must build from the current validated application source and must not run migrations at container startup. The RDS schema is already current from the EC2 recovery. The guarded deployment script creates separate App Runner ECR-access and runtime roles, a connector security group, a dedicated VPC connector in `subnet-006f73187d06bc890` and `subnet-052a19951bc944bb8`, and a narrowly scoped MySQL ingress rule from that connector security group to `architecture-master-roadmap-dev-rds-sg`. The existing EC2 application host remains unchanged until the new App Runner URL passes public health, local account sign-in, and Relationship Map validation.

Public HTTPS health was verified at `https://54-156-192-70.nip.io/health`, returning `{"status":"ok"}`. The application root serves the private sign-in interface, and the browser retained the administrator email/password autofill data after the host recovery. The next validation is a successful local-account sign-in and redirect to the dashboard with the proxy-aware session-cookie update.

After the cookie update, the public sign-in screen remained available and the administrator credentials were present in browser autofill. A programmatic sign-in submission did not transition the browser to the dashboard or display a visible error. The next diagnostic is a direct same-origin `auth.me` request to distinguish a missing session cookie from a local-account session verification failure.

### Deployment References

[2]: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-work.html "Resources created by Amazon ECS Express Mode services"
[3]: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html "Pass Secrets Manager secrets through Amazon ECS environment variables"

The original App Runner service was removed during the no-traffic development recovery. The replacement service `northstar-private-auth` was created with the saved ECR, RDS secret, JWT secret, IAM role, autoscaling, and VPC connector references. Its first creation attempt failed after ECR image pull without producing a container log. An explicit configuration rebuild then pulled the same image, provisioned public-service instances, and reached the TCP health-check stage. A browser endpoint probe could not complete because the attached browser connection became unavailable, so an independent HTTPS status check remains required.

## References

[1]: https://docs.aws.amazon.com/apprunner/latest/dg/network-vpc.html "AWS App Runner: Enabling VPC access for outgoing traffic"

The deployment bundle completed the container build and successfully pushed the Northstar image to Amazon ECR. The current blocker occurs when the App Runner command parses its JSON `source-configuration`; the CloudShell output reports an invalid JSON delimiter near the generated runtime configuration. The deployment script must be corrected before creating or updating the App Runner service.

The corrected deployment completed and made Northstar publicly available through AWS App Runner at `https://pv2wet98bu.us-east-1.awsapprunner.com`. The HTTPS sign-in screen and Gmail input render correctly from the AWS endpoint. Google OAuth end-to-end validation remains pending because the Google OAuth Web Client must be updated with `https://pv2wet98bu.us-east-1.awsapprunner.com/api/auth/google/callback` as an authorized redirect URI.

The user’s Google Cloud project contains the expected OAuth 2.0 Web Client, named `Strategy App`. Updating that credential with the AWS callback URL is the remaining configuration step before end-to-end Google sign-in can be validated.

The AWS callback URL was saved to the `Strategy App` OAuth client. The deployed Northstar entry endpoint now redirects successfully to Google’s account chooser with the AWS callback URL, expected Google OIDC scopes, and the requested Gmail address as a login hint. The final account selection and consent step requires the user to interact with Google directly.

The latest release bundle contains the STC visual system, visible logout control, editable execution roadmap, Planning Items removal, and team-scoped access controls. It was staged in the active AWS CloudShell terminal for the existing App Runner service; the terminal requires a final interactive command submission before deployment can begin.

## Google Federation Requirements

The Google sign-in implementation uses the OpenID Connect authorization-code flow. It sends users to Google with `openid email profile` scopes, a trusted-origin callback, anti-forgery state, a Google account email hint, and a server-side token exchange. The callback verifies the Google ID token and uses Google’s immutable `sub` identifier to establish the Northstar session. The AWS deployment must update the Google OAuth Web Client’s authorized redirect URI to the final HTTPS AWS application URL followed by `/api/auth/google/callback`.

## References

- [AWS App Runner Node.js service documentation](https://docs.aws.amazon.com/apprunner/latest/dg/service-source-code-nodejs.html)
- [AWS App Runner and AWS Secrets Manager](https://docs.aws.amazon.com/secretsmanager/latest/userguide/integrating_how-services-use-secrets_ARlong.html)
- [Google OpenID Connect documentation](https://developers.google.com/identity/openid-connect/openid-connect)
- [Google ID token verification guidance](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)
