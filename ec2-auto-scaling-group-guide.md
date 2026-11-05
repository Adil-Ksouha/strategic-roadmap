# Architecture Master Roadmap — EC2 Auto Scaling Group Guide

## Recommended Design

For the current development environment, place an **internet-facing Application Load Balancer (ALB)** in two public subnets and run the application in an **EC2 Auto Scaling Group (ASG)**. The RDS MySQL instance remains private. The ALB routes traffic only to healthy instances through the existing `/health` endpoint. AWS recommends an Application Load Balancer for this pattern and supports attaching its target group and health checks to the ASG.[1]

```text
Internet / Route 53
        │
        ▼
Application Load Balancer (two public subnets)
        │  HTTPS 443 → HTTP 8080
        ▼
Auto Scaling Group (one or more EC2 application instances)
        │  MySQL 3306 only
        ▼
Private RDS MySQL database (two private database subnets)
```

| Component | Recommended configuration | Security purpose |
|---|---|---|
| ALB | Internet-facing; two public subnets; listeners 80 redirecting to 443 and 443 forwarding to target group | Provides one stable endpoint and distributes traffic only to healthy hosts. |
| ALB security group | Inbound TCP 80/443 from `0.0.0.0/0`; outbound TCP 8080 only to the application security group | Limits public exposure to the load balancer. |
| Target group | Instance targets; HTTP port 8080; health path `/health`; success code `200`; deregistration delay 60 seconds | Uses the app’s lightweight health response for replacement decisions. |
| ASG launch template | Immutable ECR image tag, IAM instance profile, application security group, no SSH key, IMDSv2 required, detailed monitoring enabled | Makes every replacement instance identical and manageable through Session Manager. |
| Application security group | Inbound TCP 8080 **only from the ALB security group**; no public SSH; outbound TCP 3306 to the RDS security group | Prevents direct internet access to the application instances. |
| RDS security group | Inbound TCP 3306 **only from the application security group** | Keeps the database private and permits only ASG instances to connect. |

AWS specifically recommends limiting target security groups to traffic from the load balancer security group, and RDS supports using the application security group—not an IP range—as the MySQL ingress source.[2] [3]

## No-NAT Choice

There are two valid designs. For your current dev/test use, **Option A** is the simplest. For long-term production, choose **Option B**.

| Option | ASG instance placement | NAT Gateway | Additional components | Recommendation |
|---|---|---:|---|---|
| **A. Simpler dev/test** | Public subnets with public IP assignment | Not required | Internet gateway; strict application security group | Use now if low operational complexity matters most. Instances receive no inbound traffic except from the ALB. |
| **B. Stronger production isolation** | Private subnets with no public IPs | Not required | VPC endpoints for ECR API, ECR DKR, S3, Secrets Manager, SSM, SSMMessages, EC2Messages, and CloudWatch Logs | Use for production. It prevents direct public egress while preserving ECR image pulls and secret/SSM access. |

Even with Option A, the application security group must **not** allow `0.0.0.0/0` inbound traffic. Only the ALB can reach the instances. The database remains in private database subnets under both options.

## Capacity and Scaling Policy

Begin with the following baseline, then adjust from CloudWatch data:

| Setting | Dev/test starting value | Production availability starting value |
|---|---:|---:|
| Minimum capacity | 1 | 2 |
| Desired capacity | 1 | 2 |
| Maximum capacity | 2 | 4 |
| Health check type | `ELB` | `ELB` |
| Health check grace period | 300 seconds | 300 seconds |
| Default instance warmup | 300 seconds | 300 seconds |
| CPU target tracking | 60% average CPU | 60% average CPU |
| Scale-in stabilization | 300 seconds | 300 seconds |

Enable **Elastic Load Balancing health checks** on the ASG. This causes the ASG to replace an instance that the ALB reports as unhealthy, rather than only reacting to EC2 host status.[4] A target-tracking policy can automatically adjust capacity around a CPU target or ALB request count per target; AWS recommends target tracking for common utilization and throughput metrics.[5]

## Build It in the AWS Console

1. **Prepare a reusable launch configuration.** Do not clone the current EC2 host manually. Use a launch template that pulls one immutable ECR image tag, reads `DATABASE_URL` and `JWT_SECRET` from Secrets Manager through an instance profile, and starts the application container on port 8080. Run Drizzle migrations once as a controlled release step before instances are scaled out—do not run migrations on every boot.

2. **Create the target group.** In **EC2 → Target Groups**, create an `instance` target group on HTTP port `8080`. Set the health-check path to `/health` and success code to `200`.

3. **Create the ALB.** In **EC2 → Load Balancers**, create an internet-facing Application Load Balancer in two public subnets. Attach the ALB security group. Create HTTP 80 redirecting to HTTPS 443. For HTTPS, attach an ACM certificate after you own a domain; until then, use the ALB DNS name for a temporary HTTP validation only.

4. **Create the launch template.** In **EC2 → Launch Templates**, select Amazon Linux 2023, an appropriate instance type, the application security group, the IAM instance profile, detailed monitoring, and user data. The user data installs Docker, authenticates to ECR using its IAM role, fetches runtime secrets, and runs the exact image tag.

5. **Create the ASG.** In **EC2 → Auto Scaling Groups**, select the launch template and both application subnets. Attach the ALB target group, enable `ELB` health checks, and apply the capacity and warmup values above. New instances register automatically with the target group.[1]

6. **Add target tracking.** In the ASG’s **Automatic scaling** section, add a target-tracking policy using `ASGAverageCPUUtilization` with a 60% target. Add `ALBRequestCountPerTarget` later only after observing real traffic.[5]

7. **Validate before retiring the singleton host.** Wait for every target to become `healthy`, test the ALB DNS endpoint and `/health`, then force one instance unhealthy or terminate it to prove the ASG replaces it. Keep the current EC2 host until this test passes.

8. **Add DNS after you own a domain.** In Route 53, create an **Alias A/AAAA record** pointing to the ALB, not the EC2 Elastic IP. The ALB retains the stable public endpoint while ASG instances are replaced. Request an ACM certificate in the same Region and use the validated domain on the ALB HTTPS listener.

## Application Requirements Already Satisfied

The current application is suitable for an ASG after the EC2 sign-in recovery is fully applied because local-account sessions are signed JWT cookies and account/portfolio state is stored centrally in RDS. No user data needs to be kept on the EC2 root volume. The application already has a lightweight `/health` endpoint that returns HTTP 200.

Do not store administrator passwords, bootstrap tokens, the MySQL password, or JWT secret in launch-template user data, AMIs, or Docker image layers. Read them at instance start through an IAM instance profile and Secrets Manager.

## Before Enabling It

The current no-domain state is adequate for technical validation but not for a production HTTPS ALB endpoint. A trusted ALB certificate requires control of a domain. Until then, retain the current `nip.io` address only for temporary testing and do not redirect business users to it.

## References

[1]: https://docs.aws.amazon.com/autoscaling/ec2/userguide/tutorial-ec2-auto-scaling-load-balancer.html "AWS: Set up a scaled and load-balanced application"
[2]: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-update-security-groups.html "AWS: Security groups for your Application Load Balancer"
[3]: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Overview.RDSSecurityGroups.html "AWS: Controlling access with security groups for Amazon RDS"
[4]: https://docs.aws.amazon.com/autoscaling/ec2/userguide/health-checks-overview.html "AWS: About the health checks for your Auto Scaling group"
[5]: https://docs.aws.amazon.com/autoscaling/ec2/userguide/as-scaling-target-tracking.html "AWS: Target tracking scaling policies for Amazon EC2 Auto Scaling"
