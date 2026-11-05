# Architecture Master Roadmap
## AWS Console Deployment Guide: EC2, Private RDS, ALB, and Auto Scaling Group

**Prepared for:** Architecture Master Roadmap development environment  
**Region:** `us-east-1` — US East (N. Virginia)  
**Application access model:** Administrator-created private email/password accounts  
**Network policy:** No NAT Gateway

---

## 1. Purpose and Target Architecture

This guide explains how to host the application securely on EC2, keep MySQL private in Amazon RDS, and add availability and scaling through an Application Load Balancer (ALB) and an EC2 Auto Scaling Group (ASG). The system stores its shared application data and local accounts in RDS, so web instances can be safely replaced by Auto Scaling.

```text
                         ┌─────────────────────────────────────────────┐
                         │                  Internet                   │
                         └───────────────────┬─────────────────────────┘
                                             │ HTTPS 443
                                             ▼
                         ┌─────────────────────────────────────────────┐
                         │     Application Load Balancer (public)      │
                         │        Two public subnets / two AZs         │
                         └───────────────────┬─────────────────────────┘
                                             │ HTTP 8080
                                             ▼
             ┌──────────────────────────────────────────────────────────────┐
             │                  EC2 Auto Scaling Group                      │
             │              Application containers / SSM only                │
             └───────────────────────────────┬──────────────────────────────┘
                                             │ MySQL 3306
                                             ▼
                         ┌─────────────────────────────────────────────┐
                         │         Amazon RDS MySQL (private)          │
                         │          Two private database subnets        │
                         └─────────────────────────────────────────────┘
```

The ALB distributes browser requests only to healthy instances. The target group uses the application’s `GET /health` endpoint, which returns HTTP `200` when the service is running. An ASG can use ALB health status to replace unhealthy instances.[1] [2]

> **Important:** Do not attach an Elastic IP to an ASG instance. ASG instances can be replaced at any time. Use the ALB DNS name or, after you own a domain, a Route 53 **Alias A record** that points to the ALB.[3]

---

## 2. Current Verified Network Baseline

The existing dedicated VPC already has the two public subnets required by an internet-facing ALB and the two private subnets required for a private RDS database. No additional subnets are needed for the development ASG.

| Resource | Identifier | Purpose |
|---|---|---|
| VPC | `vpc-0cbb9dbb03493aeaf` | Dedicated Architecture Master Roadmap VPC |
| VPC CIDR | `10.120.0.0/16` | Address range for the deployment |
| Public subnet A | `subnet-018c1d6e51b06555e` — `10.120.0.0/20` | `us-east-1a`; current EC2 / future ALB and ASG |
| Public subnet B | `subnet-06ae6d70151137d7c` — `10.120.16.0/20` | `us-east-1b`; future ALB and ASG |
| Private database subnet A | `subnet-006f73187d06bc890` — `10.120.32.0/20` | `us-east-1a`; RDS subnet group |
| Private database subnet B | `subnet-052a19951bc944bb8` — `10.120.48.0/20` | `us-east-1b`; RDS subnet group |
| Internet gateway | `igw-0d972fe28e3ced83d` | Enables public-subnet egress and inbound ALB connectivity |
| NAT Gateway | None | Intentionally not used |

The public route table already directs `0.0.0.0/0` traffic to the internet gateway. The database subnets must remain private and must not receive a default internet route.

---

## 3. Before You Begin

### 3.1 Select the Scaling Mode

Use the following values initially. The development setup remains economical while still validating the ASG flow; the production baseline provides multi-instance availability.

| Setting | Development starting point | Production starting point |
|---|---:|---:|
| ASG minimum capacity | 1 | 2 |
| ASG desired capacity | 1 | 2 |
| ASG maximum capacity | 2 | 4 |
| Instance type | `t3.small` or size validated by load test | Start at `t3.small`; right-size from metrics |
| Health-check type | `ELB` | `ELB` |
| Health-check grace period | 300 seconds | 300 seconds |
| Default instance warmup | 300 seconds | 300 seconds |
| Target tracking metric | Average CPU at 60% | Average CPU at 60% |

Target tracking manages CloudWatch alarms for the policy. AWS supports CPU utilization and ALB request count per target as predefined ASG target-tracking metrics.[4]

### 3.2 Protect the Secrets

The launch template and AMI must **never** contain database passwords, JWT secrets, the local bootstrap token, or administrator passwords. Store runtime values in Secrets Manager and give the EC2 instance profile only the permissions it needs to read the designated secrets.

| Runtime value | Recommended secret name | Who may read it |
|---|---|---|
| MySQL connection URL | `architecture-master-roadmap/database-url` | EC2 application instance role only |
| JWT signing secret | `architecture-master-roadmap/jwt-secret` | EC2 application instance role only |
| First-admin bootstrap token | `architecture-master-roadmap/local-auth-bootstrap-token` | EC2 application instance role only |

---

## 4. Console Procedure A — Security Groups

### 4.1 Create the ALB Security Group

In **AWS Console → EC2 → Security Groups → Create security group**, create the following group in `vpc-0cbb9dbb03493aeaf`.

| Field | Value |
|---|---|
| Name | `architecture-master-roadmap-alb-sg` |
| Description | `Public HTTPS access to Architecture Master Roadmap ALB` |
| Inbound 1 | HTTP / TCP / `80` / `0.0.0.0/0` |
| Inbound 2 | HTTPS / TCP / `443` / `0.0.0.0/0` |
| Outbound | Custom TCP / `8080` / **application ASG security group** (add this after creating it) |

### 4.2 Create the Application ASG Security Group

Create a second group in the same VPC.

| Field | Value |
|---|---|
| Name | `architecture-master-roadmap-asg-app-sg` |
| Description | `Application instances reachable only from the ALB` |
| Inbound | Custom TCP / `8080` / **ALB security group** |
| Outbound 1 | MySQL/Aurora / TCP / `3306` / **RDS security group** |
| Outbound 2 | HTTPS / TCP / `443` / `0.0.0.0/0` |

This prevents direct internet access to application instances. AWS recommends limiting target instances to traffic sourced from the ALB security group.[5]

### 4.3 Update the RDS Security Group

In **RDS → Databases → [Architecture Master Roadmap database] → Connectivity & security**, select its VPC security group, then choose **Edit inbound rules** in the EC2 Security Groups console.

Add the following rule, then remove any temporary rule that names the current singleton EC2 security group after ASG validation is complete.

| Type | Protocol | Port | Source |
|---|---|---:|---|
| MySQL/Aurora | TCP | 3306 | `architecture-master-roadmap-asg-app-sg` |

RDS security groups can use the application security group itself as the source, avoiding public IP or broad CIDR access.[6]

---

## 5. Console Procedure B — IAM Instance Profile

In **AWS Console → IAM → Roles → Create role**, choose **AWS service → EC2** and create `architecture-master-roadmap-asg-instance-role`.

Attach the following managed policies:

| Policy | Reason |
|---|---|
| `AmazonSSMManagedInstanceCore` | Enables Session Manager administration without SSH. |
| `AmazonEC2ContainerRegistryReadOnly` | Lets each new instance pull the signed application image from ECR. |

Add a custom inline policy named `ReadArchitectureMasterRoadmapRuntimeSecrets`. It should allow only `secretsmanager:GetSecretValue` on the three designated secret ARNs. Do not attach broad administrator, RDS-write, or IAM-write permissions to application instances.

---

## 6. Console Procedure C — Application Load Balancer and Target Group

### 6.1 Create the Target Group

1. Open **EC2 → Target Groups → Create target group**.
2. Select **Instances** as the target type.
3. Enter `architecture-master-roadmap-web-tg` as the target group name.
4. Select **HTTP** and port `8080`.
5. Select VPC `vpc-0cbb9dbb03493aeaf`.
6. Under **Health checks**, set:

| Field | Value |
|---|---|
| Protocol | HTTP |
| Path | `/health` |
| Healthy threshold | 2 |
| Unhealthy threshold | 2 |
| Timeout | 5 seconds |
| Interval | 30 seconds |
| Success codes | `200` |

7. Choose **Next**, do not manually register the singleton EC2 instance, then choose **Create target group**. The ASG registers its own instances automatically.

### 6.2 Create the ALB

1. Open **EC2 → Load Balancers → Create load balancer → Application Load Balancer**.
2. Use these values:

| Field | Value |
|---|---|
| Name | `architecture-master-roadmap-alb` |
| Scheme | Internet-facing |
| IP address type | IPv4 |
| VPC | `vpc-0cbb9dbb03493aeaf` |
| Mappings | `subnet-018c1d6e51b06555e` and `subnet-06ae6d70151137d7c` |
| Security group | `architecture-master-roadmap-alb-sg` |

3. Create an HTTP listener on port `80`, forwarding to `architecture-master-roadmap-web-tg` for the initial technical validation.
4. Choose **Create load balancer**.
5. Wait for its state to become **Active**. Copy its generated DNS name for testing.

Do not use the EC2 Elastic IP address as the scaled application endpoint. The ALB DNS name is the stable endpoint while ASG instances are replaced.[3]

---

## 7. Console Procedure D — Build the Launch Template

The AWS Console can create the launch template, but the application image must first exist in ECR. Build and push the validated Architecture Master Roadmap image through the supplied deployment automation or AWS CloudShell, then reference its immutable image tag in the bootstrap configuration.

In **EC2 → Launch Templates → Create launch template**, enter:

| Field | Value |
|---|---|
| Launch template name | `architecture-master-roadmap-web-lt` |
| Template version description | `Initial ASG application host` |
| AMI | Amazon Linux 2023, current x86_64 |
| Instance type | `t3.small` initially |
| Key pair | **Do not include one**; use Session Manager |
| Network | Do not choose a subnet here; ASG chooses both subnets |
| Security group | `architecture-master-roadmap-asg-app-sg` |
| Auto-assign public IP | Enable for the development no-NAT model |
| IAM instance profile | `architecture-master-roadmap-asg-instance-role` |
| Detailed CloudWatch monitoring | Enable |
| Metadata version | Require IMDSv2 |

### Required Launch Template User Data

Use user data that does the following at every instance launch:

1. Installs and starts Docker.
2. Uses the EC2 instance role to log in to ECR.
3. Reads the three runtime values from Secrets Manager into a root-readable environment file.
4. Pulls the **immutable ECR image tag**.
5. Starts the app container on `127.0.0.1:8080` or `0.0.0.0:8080` as appropriate for the ALB target group.
6. Starts a local reverse proxy only if the target group uses port 80. In the recommended configuration, the ALB terminates TLS and forwards HTTP directly to port 8080, so Caddy is not required on ASG instances.
7. Does **not** run database migrations on every boot. Run migrations once before increasing ASG capacity.

> **Do not copy `/opt/architecture-master-roadmap/runtime.env` into an AMI.** It contains values fetched at runtime. New instances should fetch secrets from Secrets Manager using the instance role.

---

## 8. Console Procedure E — Create the Auto Scaling Group

1. Open **EC2 → Auto Scaling Groups → Create Auto Scaling group**.
2. Use name `architecture-master-roadmap-web-asg`.
3. Select launch template `architecture-master-roadmap-web-lt`, latest version.
4. Select VPC `vpc-0cbb9dbb03493aeaf`.
5. Select both public subnets:

```text
subnet-018c1d6e51b06555e  (us-east-1a)
subnet-06ae6d70151137d7c  (us-east-1b)
```

6. Under **Load balancing**, choose **Attach to an existing load balancer**, then select target group `architecture-master-roadmap-web-tg`.
7. Turn on **Elastic Load Balancing health checks** and set a **300-second health check grace period**.
8. Set capacity values from the table in Section 3.1.
9. Enable default instance warmup at 300 seconds.
10. Create the group.

AWS registers new ASG instances with the attached target group. The ALB sends traffic only after health checks pass, and the ASG can replace instances that the ALB reports unhealthy when ELB health checks are enabled.[1] [2]

---

## 9. Console Procedure F — Add Automatic Scaling

After the first ASG instance is **InService** and the target group shows it as **Healthy**:

1. Open **EC2 → Auto Scaling Groups** and select `architecture-master-roadmap-web-asg`.
2. Open the **Automatic scaling** tab.
3. Select **Create dynamic scaling policy**.
4. Choose **Target tracking scaling policy**.
5. Use these values:

| Field | Value |
|---|---|
| Policy name | `architecture-master-roadmap-cpu-60` |
| Metric type | Average CPU utilization |
| Target value | `60` |
| Instance warmup | `300` seconds |
| Scale-in | Enabled |

6. Choose **Create**.

Do not manually edit the CloudWatch alarms created for target tracking; AWS manages them for the policy.[4]

---

## 10. Console Procedure G — Validate Before Cutover

Complete each item before changing DNS, retiring the singleton EC2 instance, or reducing capacity.

| Validation | Console location | Expected result |
|---|---|---|
| ASG instance state | EC2 → Auto Scaling Groups → Instance management | `InService` and `Healthy` |
| Target health | EC2 → Target Groups → Targets | Each ASG instance is `healthy` |
| Application health | Browser: `http://<alb-dns-name>/health` | JSON response `{"status":"ok"}` |
| Login | Browser: `http://<alb-dns-name>/` | Private email/password sign-in page loads |
| First administrator | Browser: `http://<alb-dns-name>/?setup=1` only before the first local admin exists | Bootstrap form works once; do not send the token in chat |
| Replace an instance | EC2 → Auto Scaling Groups → Instance management → select instance → Set instance health → Unhealthy | ASG starts a replacement and target becomes healthy |

Do not mark an instance unhealthy for the test until the first target is confirmed healthy and the test application is not carrying an active maintenance activity.

---

## 11. DNS and HTTPS: Do This Only After You Own a Domain

An ALB has its own AWS-generated DNS name for technical testing. For a trusted branded HTTPS address, you need a domain you own. The free `nip.io` IP-based hostname is useful for short-term single-EC2 testing but cannot provide a durable custom-domain record that follows a scaled ALB.

After acquiring a domain:

1. In **AWS Certificate Manager**, request a public certificate for the exact hostname, such as `roadmap.example.com`, in `us-east-1`.
2. Validate the certificate by DNS. If the DNS zone is in Route 53, choose the option to create the validation record automatically.
3. In **EC2 → Load Balancers → architecture-master-roadmap-alb → Listeners and rules**, add HTTPS listener `443` using the ACM certificate. Forward to `architecture-master-roadmap-web-tg`.
4. Change the HTTP `80` listener to redirect to HTTPS `443`.
5. In **Route 53 → Hosted zones → [your domain] → Create record**, create an **Alias A** record for the required hostname, pointing to the ALB.

Route 53 supports Alias A records for both root domains and subdomains, and ALB HTTPS listeners require a certificate whose domain matches the hostname.[3] [7] [8]

---

## 12. Operational Procedures

### Deploy a New Application Version

Build and push a new immutable ECR image tag. Create a new launch-template version that references that tag, select the new version in the ASG, and perform an **Instance refresh**. Monitor target health and application sign-in before ending the refresh.

### Database Migrations

Run database migrations **once**, with a controlled job or a one-off managed instance, before deploying code that depends on a new schema. Never let every ASG node run migrations at boot; parallel replacements can race or lock the database.

### Troubleshooting

| Symptom | First place to check | Likely cause |
|---|---|---|
| Targets unhealthy | Target Groups → Targets | App not listening on 8080, incorrect `/health` path, or ASG security group missing ALB source rule |
| New instances terminate repeatedly | ASG → Activity | Launch-template user data, IAM instance profile, ECR pull, or Secrets Manager permissions |
| App cannot reach database | RDS → Connectivity & security; application logs in Session Manager | RDS security group missing ASG security-group source or database URL secret incorrect |
| Browser gets TLS warning | ALB listener / ACM | DNS hostname does not match certificate, certificate not issued, or HTTP used before HTTPS listener setup |
| Site works then fails after scaling | Target group and CloudWatch | New template version has a different image tag, missing user-data step, or migration not applied |

---

## References

[1]: https://docs.aws.amazon.com/autoscaling/ec2/userguide/tutorial-ec2-auto-scaling-load-balancer.html "AWS: Set up a scaled and load-balanced application"

[2]: https://docs.aws.amazon.com/autoscaling/ec2/userguide/health-checks-overview.html "AWS: About the health checks for your Auto Scaling group"

[3]: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-to-elb-load-balancer.html "AWS: Routing traffic to an ELB load balancer"

[4]: https://docs.aws.amazon.com/autoscaling/ec2/userguide/as-scaling-target-tracking.html "AWS: Target tracking scaling policies for Amazon EC2 Auto Scaling"

[5]: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-update-security-groups.html "AWS: Security groups for your Application Load Balancer"

[6]: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Overview.RDSSecurityGroups.html "AWS: Controlling access with security groups for Amazon RDS"

[7]: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/create-https-listener.html "AWS: Create an HTTPS listener for your Application Load Balancer"

[8]: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/https-listener-certificates.html "AWS: SSL certificates for your Application Load Balancer"
