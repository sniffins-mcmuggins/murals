# E11 — Production Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the Render website to AWS with HTTPS, a staging environment, CI/CD via GitHub Actions, a pre-launch password gate, CloudWatch alarms, and legal/GDPR pages.

**Architecture:** Terraform modules provision all AWS resources (VPC, ECS Fargate, RDS Postgres, S3/CloudFront, ALB, Route 53, ACM, Secrets Manager). GitHub Actions builds Docker images, pushes to ECR, runs DB migrations as a one-off ECS task, then performs a rolling service update. Next.js middleware handles the pre-launch gate — a single `LAUNCH_PASSWORD` env var; remove it at launch.

**Tech Stack:** Terraform ~> 1.9, AWS provider ~> 5.0, GitHub Actions (aws-actions/configure-aws-credentials OIDC), Next.js 15 middleware

**Spec:** `docs/superpowers/specs/2026-05-27-production-readiness-design.md` — E11 section

---

## Prerequisites (manual, do once before Task 1)

1. **Domain** — buy/transfer domain, note the registrar. Route 53 hosted zone will be created in Task 9, then you update your registrar NS records to point to it.
2. **AWS account** — confirm `aws sts get-caller-identity` works locally with admin credentials.
3. **Bootstrap S3 + DynamoDB for Terraform state** — run once:
   ```bash
   aws s3api create-bucket --bucket render-terraform-state --region eu-west-2 \
     --create-bucket-configuration LocationConstraint=eu-west-2
   aws s3api put-bucket-versioning --bucket render-terraform-state \
     --versioning-configuration Status=Enabled
   aws s3api put-bucket-encryption --bucket render-terraform-state \
     --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
   aws dynamodb create-table --table-name render-terraform-locks \
     --attribute-definitions AttributeName=LockID,AttributeType=S \
     --key-schema AttributeName=LockID,KeyType=HASH \
     --billing-mode PAY_PER_REQUEST --region eu-west-2
   ```
4. **GitHub Secrets** — after Task 10 creates the OIDC IAM role, add `AWS_ROLE_ARN` and `AWS_REGION` to GitHub repo secrets.

---

## File Structure

```
infra/
  terraform/
    modules/
      networking/
        main.tf          # VPC, subnets, IGW, route tables, SGs
        variables.tf
        outputs.tf
      ecr/
        main.tf          # ECR repos for api + web
        variables.tf
        outputs.tf
      rds/
        main.tf          # RDS Postgres 16
        variables.tf
        outputs.tf
      ecs/
        main.tf          # ECS cluster + task defs + services
        variables.tf
        outputs.tf
      alb/
        main.tf          # ALB, target groups, HTTPS listener
        variables.tf
        outputs.tf
      cdn/
        main.tf          # S3 image bucket + CloudFront
        variables.tf
        outputs.tf
      secrets/
        main.tf          # Secrets Manager secrets
        variables.tf
        outputs.tf
      dns/
        main.tf          # Route 53 hosted zone + A records + ACM cert
        variables.tf
        outputs.tf
      github_oidc/
        main.tf          # IAM OIDC provider + deploy role
        variables.tf
        outputs.tf
    environments/
      staging.tfvars
      production.tfvars
    main.tf              # root: wires all modules
    variables.tf
    outputs.tf
    versions.tf
  docker-compose.yml     # unchanged
docs/
  runbooks/
    rollback.md
.github/
  workflows/
    deploy.yml           # new (deploy to staging + production)
web/
  src/
    middleware.ts        # update: add pre-launch gate
    app/
      coming-soon/
        page.tsx         # new: password form
        route.ts         # new: POST handler sets cookie
      privacy/
        page.tsx         # new
      terms/
        page.tsx         # new
    components/
      CookieNotice.tsx   # new: GDPR banner
    app/layout.tsx       # update: mount CookieNotice
```

---

## Task 1: Terraform project structure + versions + backend

**Files:**
- Create: `infra/terraform/versions.tf`
- Create: `infra/terraform/variables.tf`
- Create: `infra/terraform/outputs.tf`

- [ ] **Step 1: Create versions.tf**

```hcl
# infra/terraform/versions.tf
terraform {
  required_version = "~> 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket         = "render-terraform-state"
    key            = "environments/production/terraform.tfstate"
    region         = "eu-west-2"
    dynamodb_table = "render-terraform-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region
}
```

- [ ] **Step 2: Create variables.tf**

```hcl
# infra/terraform/variables.tf
variable "aws_region" {
  type    = string
  default = "eu-west-2"
}

variable "environment" {
  type        = string
  description = "staging | production"
}

variable "domain_name" {
  type        = string
  description = "e.g. renderltd.com"
}

variable "db_password" {
  type      = string
  sensitive = true
}

variable "jwt_secret" {
  type      = string
  sensitive = true
}

variable "api_image_tag" {
  type    = string
  default = "latest"
}

variable "web_image_tag" {
  type    = string
  default = "latest"
}
```

- [ ] **Step 3: Create environments/staging.tfvars**

```hcl
# infra/terraform/environments/staging.tfvars
environment = "staging"
domain_name = "renderltd.com"
```

- [ ] **Step 4: Create environments/production.tfvars**

```hcl
# infra/terraform/environments/production.tfvars
environment = "production"
domain_name = "renderltd.com"
```

- [ ] **Step 5: Initialise Terraform (production workspace)**

```bash
cd infra/terraform
terraform init
terraform workspace new production
terraform workspace select production
```

Expected: "Terraform has been successfully initialized" and "Switched to workspace production"

- [ ] **Step 6: Create staging workspace**

```bash
terraform workspace new staging
terraform workspace select production
```

---

## Task 2: Networking module

**Files:**
- Create: `infra/terraform/modules/networking/main.tf`
- Create: `infra/terraform/modules/networking/variables.tf`
- Create: `infra/terraform/modules/networking/outputs.tf`

- [ ] **Step 1: Write networking/variables.tf**

```hcl
variable "environment" { type = string }
variable "vpc_cidr"    { type = string; default = "10.0.0.0/16" }
```

- [ ] **Step 2: Write networking/main.tf**

```hcl
resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags = { Name = "render-${var.environment}" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "render-${var.environment}" }
}

resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index)
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true
  tags = { Name = "render-${var.environment}-public-${count.index}" }
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 10)
  availability_zone = data.aws_availability_zones.available.names[count.index]
  tags = { Name = "render-${var.environment}-private-${count.index}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = { Name = "render-${var.environment}-public" }
}

resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

data "aws_availability_zones" "available" { state = "available" }

resource "aws_security_group" "alb" {
  name   = "render-${var.environment}-alb"
  vpc_id = aws_vpc.main.id
  ingress { from_port = 80;  to_port = 80;  protocol = "tcp"; cidr_blocks = ["0.0.0.0/0"] }
  ingress { from_port = 443; to_port = 443; protocol = "tcp"; cidr_blocks = ["0.0.0.0/0"] }
  egress  { from_port = 0;   to_port = 0;   protocol = "-1";  cidr_blocks = ["0.0.0.0/0"] }
  tags = { Name = "render-${var.environment}-alb" }
}

resource "aws_security_group" "ecs" {
  name   = "render-${var.environment}-ecs"
  vpc_id = aws_vpc.main.id
  ingress {
    from_port       = 0
    to_port         = 65535
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  egress { from_port = 0; to_port = 0; protocol = "-1"; cidr_blocks = ["0.0.0.0/0"] }
  tags = { Name = "render-${var.environment}-ecs" }
}

resource "aws_security_group" "rds" {
  name   = "render-${var.environment}-rds"
  vpc_id = aws_vpc.main.id
  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
  }
  tags = { Name = "render-${var.environment}-rds" }
}
```

- [ ] **Step 3: Write networking/outputs.tf**

```hcl
output "vpc_id"              { value = aws_vpc.main.id }
output "public_subnet_ids"   { value = aws_subnet.public[*].id }
output "private_subnet_ids"  { value = aws_subnet.private[*].id }
output "alb_sg_id"           { value = aws_security_group.alb.id }
output "ecs_sg_id"           { value = aws_security_group.ecs.id }
output "rds_sg_id"           { value = aws_security_group.rds.id }
```

---

## Task 3: ECR module

**Files:**
- Create: `infra/terraform/modules/ecr/main.tf`
- Create: `infra/terraform/modules/ecr/variables.tf`
- Create: `infra/terraform/modules/ecr/outputs.tf`

- [ ] **Step 1: Write ecr/variables.tf**

```hcl
variable "environment" { type = string }
```

- [ ] **Step 2: Write ecr/main.tf**

```hcl
resource "aws_ecr_repository" "api" {
  name                 = "render-${var.environment}-api"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration { scan_on_push = true }
  tags = { Name = "render-${var.environment}-api" }
}

resource "aws_ecr_repository" "web" {
  name                 = "render-${var.environment}-web"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration { scan_on_push = true }
  tags = { Name = "render-${var.environment}-web" }
}

resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 10 images"
      selection    = { tagStatus = "any"; countType = "imageCountMoreThan"; countNumber = 10 }
      action       = { type = "expire" }
    }]
  })
}

resource "aws_ecr_lifecycle_policy" "web" {
  repository = aws_ecr_repository.web.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 10 images"
      selection    = { tagStatus = "any"; countType = "imageCountMoreThan"; countNumber = 10 }
      action       = { type = "expire" }
    }]
  })
}
```

- [ ] **Step 3: Write ecr/outputs.tf**

```hcl
output "api_repo_url" { value = aws_ecr_repository.api.repository_url }
output "web_repo_url" { value = aws_ecr_repository.web.repository_url }
```

---

## Task 4: RDS module

**Files:**
- Create: `infra/terraform/modules/rds/main.tf`
- Create: `infra/terraform/modules/rds/variables.tf`
- Create: `infra/terraform/modules/rds/outputs.tf`

- [ ] **Step 1: Write rds/variables.tf**

```hcl
variable "environment"       { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "rds_sg_id"          { type = string }
variable "db_password"        { type = string; sensitive = true }
variable "instance_class"     { type = string; default = "db.t4g.micro" }
```

- [ ] **Step 2: Write rds/main.tf**

```hcl
resource "aws_db_subnet_group" "main" {
  name       = "render-${var.environment}"
  subnet_ids = var.private_subnet_ids
  tags = { Name = "render-${var.environment}" }
}

resource "aws_db_instance" "main" {
  identifier              = "render-${var.environment}"
  engine                  = "postgres"
  engine_version          = "16"
  instance_class          = var.instance_class
  allocated_storage       = 20
  max_allocated_storage   = 100
  db_name                 = "render"
  username                = "render"
  password                = var.db_password
  db_subnet_group_name    = aws_db_subnet_group.main.name
  vpc_security_group_ids  = [var.rds_sg_id]
  publicly_accessible     = false
  skip_final_snapshot     = var.environment == "staging"
  backup_retention_period = var.environment == "production" ? 14 : 1
  storage_encrypted       = true
  deletion_protection     = var.environment == "production"
  tags = { Name = "render-${var.environment}" }
}
```

- [ ] **Step 3: Write rds/outputs.tf**

```hcl
output "endpoint" { value = aws_db_instance.main.endpoint }
output "db_name"  { value = aws_db_instance.main.db_name }
```

---

## Task 5: Secrets Manager module

**Files:**
- Create: `infra/terraform/modules/secrets/main.tf`
- Create: `infra/terraform/modules/secrets/variables.tf`
- Create: `infra/terraform/modules/secrets/outputs.tf`

- [ ] **Step 1: Write secrets/variables.tf**

```hcl
variable "environment"  { type = string }
variable "db_url"        { type = string; sensitive = true }
variable "jwt_secret"    { type = string; sensitive = true }
```

- [ ] **Step 2: Write secrets/main.tf**

```hcl
resource "aws_secretsmanager_secret" "db_url" {
  name = "render/${var.environment}/db-url"
}
resource "aws_secretsmanager_secret_version" "db_url" {
  secret_id     = aws_secretsmanager_secret.db_url.id
  secret_string = var.db_url
}

resource "aws_secretsmanager_secret" "jwt_secret" {
  name = "render/${var.environment}/jwt-secret"
}
resource "aws_secretsmanager_secret_version" "jwt_secret" {
  secret_id     = aws_secretsmanager_secret.jwt_secret.id
  secret_string = var.jwt_secret
}
```

- [ ] **Step 3: Write secrets/outputs.tf**

```hcl
output "db_url_arn"     { value = aws_secretsmanager_secret.db_url.arn }
output "jwt_secret_arn" { value = aws_secretsmanager_secret.jwt_secret.arn }
```

Note: E12 and E13 will add more secrets (SES, OAuth, Stripe) by extending this module with additional `aws_secretsmanager_secret` resources.

---

## Task 6: ALB module

**Files:**
- Create: `infra/terraform/modules/alb/main.tf`
- Create: `infra/terraform/modules/alb/variables.tf`
- Create: `infra/terraform/modules/alb/outputs.tf`

- [ ] **Step 1: Write alb/variables.tf**

```hcl
variable "environment"       { type = string }
variable "vpc_id"             { type = string }
variable "public_subnet_ids"  { type = list(string) }
variable "alb_sg_id"          { type = string }
variable "acm_cert_arn"       { type = string }
```

- [ ] **Step 2: Write alb/main.tf**

```hcl
resource "aws_lb" "main" {
  name               = "render-${var.environment}"
  load_balancer_type = "application"
  security_groups    = [var.alb_sg_id]
  subnets            = var.public_subnet_ids
  tags = { Name = "render-${var.environment}" }
}

resource "aws_lb_target_group" "api" {
  name        = "render-${var.environment}-api"
  port        = 8080
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"
  health_check { path = "/healthz"; healthy_threshold = 2; unhealthy_threshold = 3 }
}

resource "aws_lb_target_group" "web" {
  name        = "render-${var.environment}-web"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"
  health_check { path = "/"; healthy_threshold = 2; unhealthy_threshold = 3 }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "redirect"
    redirect { port = "443"; protocol = "HTTPS"; status_code = "HTTP_301" }
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_cert_arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

resource "aws_lb_listener_rule" "api" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 10
  action       { type = "forward"; target_group_arn = aws_lb_target_group.api.arn }
  condition    { path_pattern { values = ["/api/*", "/healthz", "/metrics"] } }
}
```

- [ ] **Step 3: Write alb/outputs.tf**

```hcl
output "alb_arn"           { value = aws_lb.main.arn }
output "alb_dns_name"      { value = aws_lb.main.dns_name }
output "alb_zone_id"       { value = aws_lb.main.zone_id }
output "api_tg_arn"        { value = aws_lb_target_group.api.arn }
output "web_tg_arn"        { value = aws_lb_target_group.web.arn }
output "https_listener_arn" { value = aws_lb_listener.https.arn }
```

---

## Task 7: S3 + CloudFront module

**Files:**
- Create: `infra/terraform/modules/cdn/main.tf`
- Create: `infra/terraform/modules/cdn/variables.tf`
- Create: `infra/terraform/modules/cdn/outputs.tf`

- [ ] **Step 1: Write cdn/variables.tf**

```hcl
variable "environment" { type = string }
```

- [ ] **Step 2: Write cdn/main.tf**

```hcl
resource "aws_s3_bucket" "images" {
  bucket = "render-${var.environment}-images"
  tags   = { Name = "render-${var.environment}-images" }
}

resource "aws_s3_bucket_public_access_block" "images" {
  bucket                  = aws_s3_bucket.images.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "images" {
  name                              = "render-${var.environment}-images"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "images" {
  enabled             = true
  default_root_object = ""

  origin {
    domain_name              = aws_s3_bucket.images.bucket_regional_domain_name
    origin_id                = "s3-images"
    origin_access_control_id = aws_cloudfront_origin_access_control.images.id
  }

  default_cache_behavior {
    target_origin_id       = "s3-images"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = "658327ea-f89d-4fab-a63d-7e88639e58f6" # CachingOptimized
  }

  restrictions { geo_restriction { restriction_type = "none" } }
  viewer_certificate { cloudfront_default_certificate = true }

  tags = { Name = "render-${var.environment}-images" }
}

resource "aws_s3_bucket_policy" "images" {
  bucket = aws_s3_bucket.images.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.images.arn}/*"
      Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.images.arn } }
    }]
  })
}
```

- [ ] **Step 3: Write cdn/outputs.tf**

```hcl
output "bucket_name"     { value = aws_s3_bucket.images.bucket }
output "cdn_domain_name" { value = aws_cloudfront_distribution.images.domain_name }
```

---

## Task 8: DNS + ACM module

**Files:**
- Create: `infra/terraform/modules/dns/main.tf`
- Create: `infra/terraform/modules/dns/variables.tf`
- Create: `infra/terraform/modules/dns/outputs.tf`

- [ ] **Step 1: Write dns/variables.tf**

```hcl
variable "environment"  { type = string }
variable "domain_name"  { type = string }
variable "alb_dns_name" { type = string }
variable "alb_zone_id"  { type = string }
```

- [ ] **Step 2: Write dns/main.tf**

```hcl
resource "aws_route53_zone" "main" {
  name = var.domain_name
  tags = { Name = var.domain_name }
}

locals {
  fqdn = var.environment == "production" ? var.domain_name : "${var.environment}.${var.domain_name}"
}

resource "aws_acm_certificate" "main" {
  domain_name       = local.fqdn
  validation_method = "DNS"
  lifecycle { create_before_destroy = true }
  tags = { Name = local.fqdn }
}

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.main.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }
  zone_id = aws_route53_zone.main.zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 60
  records = [each.value.record]
}

resource "aws_acm_certificate_validation" "main" {
  certificate_arn         = aws_acm_certificate.main.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

resource "aws_route53_record" "main" {
  zone_id = aws_route53_zone.main.zone_id
  name    = local.fqdn
  type    = "A"
  alias {
    name                   = var.alb_dns_name
    zone_id                = var.alb_zone_id
    evaluate_target_health = true
  }
}
```

- [ ] **Step 3: Write dns/outputs.tf**

```hcl
output "hosted_zone_id"  { value = aws_route53_zone.main.zone_id }
output "name_servers"    { value = aws_route53_zone.main.name_servers }
output "acm_cert_arn"    { value = aws_acm_certificate_validation.main.certificate_arn }
output "fqdn"            { value = local.fqdn }
```

- [ ] **Step 4: Update domain registrar NS records**

After first apply of this module, output the name servers:
```bash
terraform output -module=dns name_servers
```
Log in to your domain registrar and replace the NS records with the four AWS name servers shown. DNS propagation takes up to 48 hours. ACM cert validation will complete automatically once DNS propagates.

---

## Task 9: ECS module

**Files:**
- Create: `infra/terraform/modules/ecs/main.tf`
- Create: `infra/terraform/modules/ecs/variables.tf`
- Create: `infra/terraform/modules/ecs/outputs.tf`

- [ ] **Step 1: Write ecs/variables.tf**

```hcl
variable "environment"       { type = string }
variable "aws_region"        { type = string }
variable "vpc_id"             { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "ecs_sg_id"          { type = string }
variable "api_tg_arn"         { type = string }
variable "web_tg_arn"         { type = string }
variable "api_repo_url"       { type = string }
variable "web_repo_url"       { type = string }
variable "api_image_tag"      { type = string }
variable "web_image_tag"      { type = string }
variable "db_url_secret_arn"  { type = string }
variable "jwt_secret_arn"     { type = string }
variable "cdn_base_url"       { type = string }
variable "api_base_url"       { type = string }
```

- [ ] **Step 2: Write ecs/main.tf**

```hcl
resource "aws_ecs_cluster" "main" {
  name = "render-${var.environment}"
  setting { name = "containerInsights"; value = "enabled" }
  tags = { Name = "render-${var.environment}" }
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/render-${var.environment}-api"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "web" {
  name              = "/ecs/render-${var.environment}-web"
  retention_in_days = 30
}

resource "aws_iam_role" "ecs_task_execution" {
  name = "render-${var.environment}-ecs-exec"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Effect = "Allow"; Principal = { Service = "ecs-tasks.amazonaws.com" }; Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "secrets" {
  name = "render-${var.environment}-secrets"
  role = aws_iam_role.ecs_task_execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [var.db_url_secret_arn, var.jwt_secret_arn]
    }]
  })
}

resource "aws_ecs_task_definition" "api" {
  family                   = "render-${var.environment}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  container_definitions = jsonencode([{
    name  = "api"
    image = "${var.api_repo_url}:${var.api_image_tag}"
    portMappings = [{ containerPort = 8080 }]
    secrets = [
      { name = "DATABASE_URL"; valueFrom = var.db_url_secret_arn },
      { name = "JWT_SECRET";   valueFrom = var.jwt_secret_arn }
    ]
    environment = [
      { name = "PORT";         value = "8080" },
      { name = "CDN_BASE_URL"; value = var.cdn_base_url },
      { name = "MINIO_USE_SSL"; value = "true" }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options   = { "awslogs-group" = aws_cloudwatch_log_group.api.name; "awslogs-region" = var.aws_region; "awslogs-stream-prefix" = "api" }
    }
  }])
}

resource "aws_ecs_task_definition" "web" {
  family                   = "render-${var.environment}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  container_definitions = jsonencode([{
    name  = "web"
    image = "${var.web_repo_url}:${var.web_image_tag}"
    portMappings = [{ containerPort = 3000 }]
    environment = [
      { name = "NEXT_PUBLIC_API_URL"; value = var.api_base_url },
      { name = "PORT"; value = "3000" }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options   = { "awslogs-group" = aws_cloudwatch_log_group.web.name; "awslogs-region" = var.aws_region; "awslogs-stream-prefix" = "web" }
    }
  }])
}

resource "aws_ecs_service" "api" {
  name            = "render-${var.environment}-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = 1
  launch_type     = "FARGATE"
  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.ecs_sg_id]
    assign_public_ip = false
  }
  load_balancer {
    target_group_arn = var.api_tg_arn
    container_name   = "api"
    container_port   = 8080
  }
  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200
  lifecycle { ignore_changes = [task_definition] }
}

resource "aws_ecs_service" "web" {
  name            = "render-${var.environment}-web"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.web.arn
  desired_count   = 1
  launch_type     = "FARGATE"
  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.ecs_sg_id]
    assign_public_ip = false
  }
  load_balancer {
    target_group_arn = var.web_tg_arn
    container_name   = "web"
    container_port   = 3000
  }
  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200
  lifecycle { ignore_changes = [task_definition] }
}
```

- [ ] **Step 3: Write ecs/outputs.tf**

```hcl
output "cluster_name"    { value = aws_ecs_cluster.main.name }
output "cluster_arn"     { value = aws_ecs_cluster.main.arn }
output "api_log_group"   { value = aws_cloudwatch_log_group.api.name }
output "web_log_group"   { value = aws_cloudwatch_log_group.web.name }
output "task_exec_role_arn" { value = aws_iam_role.ecs_task_execution.arn }
```

---

## Task 10: GitHub OIDC module + root main.tf

**Files:**
- Create: `infra/terraform/modules/github_oidc/main.tf`
- Create: `infra/terraform/modules/github_oidc/variables.tf`
- Create: `infra/terraform/modules/github_oidc/outputs.tf`
- Create: `infra/terraform/main.tf`
- Create: `infra/terraform/outputs.tf`

- [ ] **Step 1: Write github_oidc/variables.tf**

```hcl
variable "github_org"  { type = string }
variable "github_repo" { type = string }
variable "environment" { type = string }
variable "ecr_repo_arns" { type = list(string) }
variable "ecs_cluster_arn" { type = string }
variable "ecs_service_api_name" { type = string }
variable "ecs_service_web_name" { type = string }
```

- [ ] **Step 2: Write github_oidc/main.tf**

```hcl
data "aws_caller_identity" "current" {}

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

resource "aws_iam_role" "deploy" {
  name = "render-${var.environment}-github-deploy"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringLike = {
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_org}/${var.github_repo}:*"
        }
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "deploy" {
  name = "render-${var.environment}-deploy"
  role = aws_iam_role.deploy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow"; Action = ["ecr:GetAuthorizationToken"]; Resource = "*" },
      { Effect = "Allow"; Action = ["ecr:BatchCheckLayerAvailability","ecr:PutImage","ecr:InitiateLayerUpload","ecr:UploadLayerPart","ecr:CompleteLayerUpload","ecr:BatchGetImage","ecr:GetDownloadUrlForLayer"]; Resource = var.ecr_repo_arns },
      { Effect = "Allow"; Action = ["ecs:UpdateService","ecs:DescribeServices","ecs:RegisterTaskDefinition","ecs:DescribeTaskDefinition","ecs:RunTask","ecs:DescribeTasks","ecs:ListTasks"]; Resource = "*" },
      { Effect = "Allow"; Action = ["iam:PassRole"]; Resource = "*" },
      { Effect = "Allow"; Action = ["secretsmanager:GetSecretValue"]; Resource = "*" }
    ]
  })
}
```

- [ ] **Step 3: Write github_oidc/outputs.tf**

```hcl
output "deploy_role_arn" { value = aws_iam_role.deploy.arn }
```

- [ ] **Step 4: Write root main.tf**

```hcl
# infra/terraform/main.tf
locals { env = var.environment }

module "networking" {
  source      = "./modules/networking"
  environment = local.env
}

module "ecr" {
  source      = "./modules/ecr"
  environment = local.env
}

module "secrets" {
  source      = "./modules/secrets"
  environment = local.env
  db_url      = "postgres://render:${var.db_password}@${module.rds.endpoint}/render?sslmode=require"
  jwt_secret  = var.jwt_secret
}

module "rds" {
  source             = "./modules/rds"
  environment        = local.env
  private_subnet_ids = module.networking.private_subnet_ids
  rds_sg_id          = module.networking.rds_sg_id
  db_password        = var.db_password
  instance_class     = local.env == "production" ? "db.t4g.micro" : "db.t3.micro"
}

module "alb" {
  source             = "./modules/alb"
  environment        = local.env
  vpc_id             = module.networking.vpc_id
  public_subnet_ids  = module.networking.public_subnet_ids
  alb_sg_id          = module.networking.alb_sg_id
  acm_cert_arn       = module.dns.acm_cert_arn
}

module "dns" {
  source       = "./modules/dns"
  environment  = local.env
  domain_name  = var.domain_name
  alb_dns_name = module.alb.alb_dns_name
  alb_zone_id  = module.alb.alb_zone_id
}

module "cdn" {
  source      = "./modules/cdn"
  environment = local.env
}

module "ecs" {
  source             = "./modules/ecs"
  environment        = local.env
  aws_region         = var.aws_region
  vpc_id             = module.networking.vpc_id
  private_subnet_ids = module.networking.private_subnet_ids
  ecs_sg_id          = module.networking.ecs_sg_id
  api_tg_arn         = module.alb.api_tg_arn
  web_tg_arn         = module.alb.web_tg_arn
  api_repo_url       = module.ecr.api_repo_url
  web_repo_url       = module.ecr.web_repo_url
  api_image_tag      = var.api_image_tag
  web_image_tag      = var.web_image_tag
  db_url_secret_arn  = module.secrets.db_url_arn
  jwt_secret_arn     = module.secrets.jwt_secret_arn
  cdn_base_url       = "https://${module.cdn.cdn_domain_name}"
  api_base_url       = "https://${module.dns.fqdn}/api"
}

module "github_oidc" {
  source                = "./modules/github_oidc"
  github_org            = "sniffins-mcmuggins"
  github_repo           = "murals"
  environment           = local.env
  ecr_repo_arns         = [module.ecr.api_repo_url, module.ecr.web_repo_url]
  ecs_cluster_arn       = module.ecs.cluster_arn
  ecs_service_api_name  = "render-${local.env}-api"
  ecs_service_web_name  = "render-${local.env}-web"
}
```

- [ ] **Step 5: Write root outputs.tf**

```hcl
output "deploy_role_arn"  { value = module.github_oidc.deploy_role_arn }
output "ecr_api_url"      { value = module.ecr.api_repo_url }
output "ecr_web_url"      { value = module.ecr.web_repo_url }
output "site_url"         { value = "https://${module.dns.fqdn}" }
output "name_servers"     { value = module.dns.name_servers }
output "rds_endpoint"     { value = module.rds.endpoint }
```

- [ ] **Step 6: First apply (production workspace)**

```bash
cd infra/terraform
terraform workspace select production
terraform plan -var-file=environments/production.tfvars \
  -var="db_password=<strong-random-password>" \
  -var="jwt_secret=<strong-random-secret>"
terraform apply -var-file=environments/production.tfvars \
  -var="db_password=<strong-random-password>" \
  -var="jwt_secret=<strong-random-secret>"
```

Expected: ~50 resources created. Note the `deploy_role_arn` output — add it to GitHub repo secrets as `AWS_ROLE_ARN_PRODUCTION`.

- [ ] **Step 7: Apply staging workspace**

```bash
terraform workspace select staging
terraform apply -var-file=environments/staging.tfvars \
  -var="db_password=<staging-password>" \
  -var="jwt_secret=<staging-secret>"
```

Note the staging `deploy_role_arn` — add as `AWS_ROLE_ARN_STAGING`.

---

## Task 11: GitHub Actions deploy workflow

**Files:**
- Create: `.github/workflows/deploy.yml`

- [ ] **Step 1: Write deploy.yml**

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]
    tags: ['v*']

permissions:
  id-token: write
  contents: read

jobs:
  deploy-staging:
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: staging
    env:
      AWS_REGION: ${{ secrets.AWS_REGION }}
      ECR_API_URL: ${{ secrets.ECR_API_URL_STAGING }}
      ECR_WEB_URL: ${{ secrets.ECR_WEB_URL_STAGING }}
      ECS_CLUSTER: render-staging
    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN_STAGING }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Login to ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build and push API image
        run: |
          docker build -t $ECR_API_URL:${{ github.sha }} ./api
          docker push $ECR_API_URL:${{ github.sha }}

      - name: Build and push Web image
        run: |
          docker build -t $ECR_WEB_URL:${{ github.sha }} ./web
          docker push $ECR_WEB_URL:${{ github.sha }}

      - name: Run DB migrations
        run: |
          aws ecs run-task \
            --cluster $ECS_CLUSTER \
            --task-definition render-staging-api \
            --launch-type FARGATE \
            --network-configuration "awsvpcConfiguration={subnets=[${{ secrets.PRIVATE_SUBNET_IDS_STAGING }}],securityGroups=[${{ secrets.ECS_SG_ID_STAGING }}]}" \
            --overrides '{"containerOverrides":[{"name":"api","command":["./migrate","up"]}]}' \
            --query 'tasks[0].taskArn' --output text | \
          xargs -I{} bash -c 'until aws ecs describe-tasks --cluster $ECS_CLUSTER --tasks {} --query "tasks[0].lastStatus" --output text | grep -q STOPPED; do sleep 5; done'

      - name: Deploy API service
        run: |
          aws ecs update-service \
            --cluster $ECS_CLUSTER \
            --service render-staging-api \
            --force-new-deployment \
            --task-definition $(aws ecs register-task-definition \
              --cli-input-json "$(aws ecs describe-task-definition --task-definition render-staging-api --query 'taskDefinition' | \
                jq '.containerDefinitions[0].image = "'$ECR_API_URL':'${{ github.sha }}'"')" \
              --query 'taskDefinition.taskDefinitionArn' --output text)

      - name: Deploy Web service
        run: |
          aws ecs update-service \
            --cluster $ECS_CLUSTER \
            --service render-staging-web \
            --force-new-deployment \
            --task-definition $(aws ecs register-task-definition \
              --cli-input-json "$(aws ecs describe-task-definition --task-definition render-staging-web --query 'taskDefinition' | \
                jq '.containerDefinitions[0].image = "'$ECR_WEB_URL':'${{ github.sha }}'"')" \
              --query 'taskDefinition.taskDefinitionArn' --output text)

  deploy-production:
    if: startsWith(github.ref, 'refs/tags/v')
    runs-on: ubuntu-latest
    environment: production
    env:
      AWS_REGION: ${{ secrets.AWS_REGION }}
      ECR_API_URL: ${{ secrets.ECR_API_URL_PRODUCTION }}
      ECR_WEB_URL: ${{ secrets.ECR_WEB_URL_PRODUCTION }}
      ECS_CLUSTER: render-production
    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN_PRODUCTION }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Login to ECR
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build and push API image
        run: |
          docker build -t $ECR_API_URL:${{ github.ref_name }} ./api
          docker push $ECR_API_URL:${{ github.ref_name }}

      - name: Build and push Web image
        run: |
          docker build -t $ECR_WEB_URL:${{ github.ref_name }} ./web
          docker push $ECR_WEB_URL:${{ github.ref_name }}

      - name: Run DB migrations
        run: |
          aws ecs run-task \
            --cluster $ECS_CLUSTER \
            --task-definition render-production-api \
            --launch-type FARGATE \
            --network-configuration "awsvpcConfiguration={subnets=[${{ secrets.PRIVATE_SUBNET_IDS_PRODUCTION }}],securityGroups=[${{ secrets.ECS_SG_ID_PRODUCTION }}]}" \
            --overrides '{"containerOverrides":[{"name":"api","command":["./migrate","up"]}]}' \
            --query 'tasks[0].taskArn' --output text | \
          xargs -I{} bash -c 'until aws ecs describe-tasks --cluster $ECS_CLUSTER --tasks {} --query "tasks[0].lastStatus" --output text | grep -q STOPPED; do sleep 5; done'

      - name: Deploy API service
        run: |
          aws ecs update-service --cluster $ECS_CLUSTER --service render-production-api \
            --force-new-deployment \
            --task-definition $(aws ecs register-task-definition \
              --cli-input-json "$(aws ecs describe-task-definition --task-definition render-production-api --query 'taskDefinition' | \
                jq '.containerDefinitions[0].image = "'$ECR_API_URL':'${{ github.ref_name }}'"')" \
              --query 'taskDefinition.taskDefinitionArn' --output text)

      - name: Deploy Web service
        run: |
          aws ecs update-service --cluster $ECS_CLUSTER --service render-production-web \
            --force-new-deployment \
            --task-definition $(aws ecs register-task-definition \
              --cli-input-json "$(aws ecs describe-task-definition --task-definition render-production-web --query 'taskDefinition' | \
                jq '.containerDefinitions[0].image = "'$ECR_WEB_URL':'${{ github.ref_name }}'"')" \
              --query 'taskDefinition.taskDefinitionArn' --output text)
```

- [ ] **Step 2: Add GitHub secrets**

Add these secrets in GitHub → Settings → Secrets → Actions:
- `AWS_REGION` = `eu-west-2`
- `AWS_ROLE_ARN_STAGING` = (from `terraform output deploy_role_arn` in staging workspace)
- `AWS_ROLE_ARN_PRODUCTION` = (from production workspace)
- `ECR_API_URL_STAGING`, `ECR_WEB_URL_STAGING`, `ECR_API_URL_PRODUCTION`, `ECR_WEB_URL_PRODUCTION` = (from `terraform output ecr_*_url`)
- `PRIVATE_SUBNET_IDS_STAGING`, `PRIVATE_SUBNET_IDS_PRODUCTION` = comma-separated private subnet IDs
- `ECS_SG_ID_STAGING`, `ECS_SG_ID_PRODUCTION` = ECS security group IDs

- [ ] **Step 3: Test by pushing to main**

Merge any commit to main. Confirm in GitHub Actions that the staging deploy job runs and completes green. Check the staging URL loads the app.

---

## Task 12: Pre-launch gate (Next.js middleware)

**Files:**
- Modify: `web/src/middleware.ts`
- Create: `web/src/app/coming-soon/page.tsx`
- Create: `web/src/app/coming-soon/route.ts`

- [ ] **Step 1: Update middleware.ts to add launch gate**

```typescript
// web/src/middleware.ts
import { NextRequest, NextResponse } from 'next/server'

const PROTECTED_PATHS = ['/dashboard', '/profile', '/collections', '/applications', '/organiser']
const LAUNCH_BYPASS_PATHS = ['/coming-soon', '/_next', '/favicon.ico', '/api']

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Pre-launch gate: only active when LAUNCH_PASSWORD env var is set
  const launchPassword = process.env.LAUNCH_PASSWORD
  if (launchPassword) {
    const isBypassPath = LAUNCH_BYPASS_PATHS.some(
      (p) => pathname === p || pathname.startsWith(`${p}/`) || pathname.match(/\.\w+$/)
    )
    if (!isBypassPath) {
      const token = request.cookies.get('launch_token')
      if (token?.value !== launchPassword) {
        return NextResponse.redirect(new URL('/coming-soon', request.url))
      }
    }
  }

  // Existing auth gate
  const isProtected = PROTECTED_PATHS.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
  if (!isProtected) return NextResponse.next()

  const sessionCookie = request.cookies.get('session')
  if (!sessionCookie?.value) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!$|login|signup|artists|festivals|_next|api|favicon\\.ico|.*\\..*).*)', '/'],
}
```

- [ ] **Step 2: Create coming-soon/page.tsx**

```tsx
// web/src/app/coming-soon/page.tsx
export default function ComingSoonPage({
  searchParams,
}: {
  searchParams: { error?: string }
}) {
  return (
    <main style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'DM Sans, sans-serif', background: '#FAF7F2' }}>
      <h1 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '3rem', color: '#1A1A2E', marginBottom: '0.5rem' }}>Render</h1>
      <p style={{ color: '#8A8896', marginBottom: '2rem' }}>Coming soon — enter the preview password to continue.</p>
      <form action="/coming-soon" method="POST" style={{ display: 'flex', gap: '0.5rem' }}>
        <input
          type="password"
          name="password"
          placeholder="Preview password"
          required
          style={{ padding: '0.75rem 1rem', border: '1px solid #E2DDD6', borderRadius: '6px', fontSize: '1rem', width: '240px' }}
        />
        <button type="submit" style={{ padding: '0.75rem 1.5rem', background: '#E8A838', color: '#1A1A2E', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}>
          Enter
        </button>
      </form>
      {searchParams.error && (
        <p style={{ color: '#C45C3A', marginTop: '1rem' }}>Incorrect password.</p>
      )}
    </main>
  )
}
```

- [ ] **Step 3: Create coming-soon/route.ts (POST handler)**

```typescript
// web/src/app/coming-soon/route.ts
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const data = await request.formData()
  const password = data.get('password')?.toString() ?? ''
  const launchPassword = process.env.LAUNCH_PASSWORD ?? ''

  if (!launchPassword || password !== launchPassword) {
    return NextResponse.redirect(new URL('/coming-soon?error=1', request.url), 303)
  }

  const response = NextResponse.redirect(new URL('/', request.url), 303)
  response.cookies.set('launch_token', launchPassword, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    secure: process.env.NODE_ENV === 'production',
  })
  return response
}
```

- [ ] **Step 4: Add LAUNCH_PASSWORD to ECS web task definition via Secrets Manager**

In `infra/terraform/modules/secrets/main.tf`, add:

```hcl
resource "aws_secretsmanager_secret" "launch_password" {
  name = "render/${var.environment}/launch-password"
}
resource "aws_secretsmanager_secret_version" "launch_password" {
  secret_id     = aws_secretsmanager_secret.launch_password.id
  secret_string = var.launch_password
}
```

Add `variable "launch_password"` to secrets module variables, add its ARN to secrets outputs, and reference it in the web task definition environment in `modules/ecs/main.tf`. When you want to go public, set `launch_password = ""` and redeploy.

- [ ] **Step 5: Test locally**

```bash
cd web
LAUNCH_PASSWORD=test123 npx next dev
```

Open `http://localhost:3000` — expect redirect to `/coming-soon`. Enter `test123` — expect redirect back to `/`. Verify `launch_token` cookie is set.

---

## Task 13: CloudWatch Alarms + SNS

**Files:**
- Create: `infra/terraform/modules/monitoring/main.tf`
- Create: `infra/terraform/modules/monitoring/variables.tf`
- Modify: `infra/terraform/main.tf` (add monitoring module)

- [ ] **Step 1: Write monitoring/variables.tf**

```hcl
variable "environment"     { type = string }
variable "alert_email"     { type = string }
variable "api_log_group"   { type = string }
variable "web_log_group"   { type = string }
variable "ecs_cluster_name" { type = string }
variable "alb_arn_suffix"  { type = string }
variable "api_tg_arn_suffix" { type = string }
```

- [ ] **Step 2: Write monitoring/main.tf**

```hcl
resource "aws_sns_topic" "alerts" {
  name = "render-${var.environment}-alerts"
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "render-${var.environment}-api-5xx"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "HTTPCode_Target_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Sum"
  threshold           = 10
  dimensions = {
    LoadBalancer = var.alb_arn_suffix
    TargetGroup  = var.api_tg_arn_suffix
  }
  alarm_actions = [aws_sns_topic.alerts.arn]
  alarm_description = "API 5xx errors > 10 in 1 min"
}

resource "aws_cloudwatch_metric_alarm" "ecs_api_stopped" {
  alarm_name          = "render-${var.environment}-ecs-api-stopped"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "RunningTaskCount"
  namespace           = "ECS/ContainerInsights"
  period              = 60
  statistic           = "Average"
  threshold           = 1
  dimensions = {
    ClusterName = var.ecs_cluster_name
    ServiceName = "render-${var.environment}-api"
  }
  alarm_actions     = [aws_sns_topic.alerts.arn]
  treat_missing_data = "breaching"
  alarm_description = "API ECS task count < 1"
}

resource "aws_cloudwatch_metric_alarm" "ecs_web_stopped" {
  alarm_name          = "render-${var.environment}-ecs-web-stopped"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "RunningTaskCount"
  namespace           = "ECS/ContainerInsights"
  period              = 60
  statistic           = "Average"
  threshold           = 1
  dimensions = {
    ClusterName = var.ecs_cluster_name
    ServiceName = "render-${var.environment}-web"
  }
  alarm_actions     = [aws_sns_topic.alerts.arn]
  treat_missing_data = "breaching"
  alarm_description = "Web ECS task count < 1"
}
```

- [ ] **Step 3: Add monitoring module to root main.tf**

```hcl
module "monitoring" {
  source            = "./modules/monitoring"
  environment       = local.env
  alert_email       = "ops@renderltd.com"
  api_log_group     = module.ecs.api_log_group
  web_log_group     = module.ecs.web_log_group
  ecs_cluster_name  = module.ecs.cluster_name
  alb_arn_suffix    = module.alb.alb_arn
  api_tg_arn_suffix = module.alb.api_tg_arn
}
```

- [ ] **Step 4: Apply and confirm SNS subscription email**

```bash
terraform apply -var-file=environments/production.tfvars ...
```

Check inbox for SNS confirmation email — click "Confirm subscription".

---

## Task 14: Legal pages

**Files:**
- Create: `web/src/app/privacy/page.tsx`
- Create: `web/src/app/terms/page.tsx`

- [ ] **Step 1: Create privacy/page.tsx**

```tsx
// web/src/app/privacy/page.tsx
export const metadata = { title: 'Privacy Policy — Render' }

export default function PrivacyPage() {
  return (
    <main className="max-w-2xl mx-auto px-6 py-16" style={{ fontFamily: 'DM Sans, sans-serif' }}>
      <h1 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '2.5rem', color: '#1A1A2E', marginBottom: '2rem' }}>
        Privacy Policy
      </h1>
      <p style={{ color: '#8A8896', marginBottom: '2rem' }}>Last updated: May 2026</p>

      <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.75rem' }}>What we collect</h2>
      <p style={{ marginBottom: '1.5rem', lineHeight: 1.7 }}>
        We collect your email address and account details when you sign up. If you connect a Google or Apple account, we receive your name and email from that provider. We do not store payment card details — these are handled by Stripe.
      </p>

      <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.75rem' }}>How we use it</h2>
      <p style={{ marginBottom: '1.5rem', lineHeight: 1.7 }}>
        Your data is used to provide the Render platform: publishing your artist profile, managing festival applications, and processing subscription payments. We do not sell your data or use it for advertising.
      </p>

      <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.75rem' }}>Cookies</h2>
      <p style={{ marginBottom: '1.5rem', lineHeight: 1.7 }}>
        We set one secure, HTTP-only cookie to keep you logged in. We do not use tracking or advertising cookies.
      </p>

      <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.75rem' }}>Your rights (UK GDPR)</h2>
      <p style={{ marginBottom: '1.5rem', lineHeight: 1.7 }}>
        You have the right to access, correct, or delete your personal data at any time. Email <a href="mailto:privacy@renderltd.com" style={{ color: '#E8A838' }}>privacy@renderltd.com</a> to make a request.
      </p>

      <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.75rem' }}>Data retention</h2>
      <p style={{ lineHeight: 1.7 }}>
        We retain account data for as long as your account is active. Deleted accounts are purged within 30 days.
      </p>
    </main>
  )
}
```

- [ ] **Step 2: Create terms/page.tsx**

```tsx
// web/src/app/terms/page.tsx
export const metadata = { title: 'Terms of Service — Render' }

export default function TermsPage() {
  return (
    <main className="max-w-2xl mx-auto px-6 py-16" style={{ fontFamily: 'DM Sans, sans-serif' }}>
      <h1 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '2.5rem', color: '#1A1A2E', marginBottom: '2rem' }}>
        Terms of Service
      </h1>
      <p style={{ color: '#8A8896', marginBottom: '2rem' }}>Last updated: May 2026</p>

      <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.75rem' }}>The service</h2>
      <p style={{ marginBottom: '1.5rem', lineHeight: 1.7 }}>
        Render is a platform for paint festival artists and organisers. By creating an account you agree to these terms.
      </p>

      <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.75rem' }}>Accounts</h2>
      <p style={{ marginBottom: '1.5rem', lineHeight: 1.7 }}>
        You are responsible for keeping your account credentials secure. Artist accounts require an active paid subscription (Basic or Pro). Organiser accounts require payment of the setup fee before publishing festivals.
      </p>

      <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.75rem' }}>Content</h2>
      <p style={{ marginBottom: '1.5rem', lineHeight: 1.7 }}>
        You retain ownership of any artwork, photos, or written content you upload. By uploading, you grant Render a licence to display your content on the platform.
      </p>

      <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.75rem' }}>Payments</h2>
      <p style={{ marginBottom: '1.5rem', lineHeight: 1.7 }}>
        Subscriptions are managed via Stripe. You may cancel at any time. Refunds are handled case by case — contact <a href="mailto:hello@renderltd.com" style={{ color: '#E8A838' }}>hello@renderltd.com</a>.
      </p>

      <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.75rem' }}>Termination</h2>
      <p style={{ lineHeight: 1.7 }}>
        We reserve the right to suspend accounts that violate these terms. You may delete your account at any time from the settings page.
      </p>
    </main>
  )
}
```

- [ ] **Step 3: Verify both pages render**

```bash
cd web && npx next dev
```

Open `http://localhost:3000/privacy` and `http://localhost:3000/terms` — confirm they render without errors.

---

## Task 15: GDPR cookie notice

**Files:**
- Create: `web/src/components/CookieNotice.tsx`
- Modify: `web/src/app/layout.tsx`

- [ ] **Step 1: Write CookieNotice.tsx**

```tsx
'use client'

// web/src/components/CookieNotice.tsx
import { useState, useEffect } from 'react'

export function CookieNotice() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const dismissed = localStorage.getItem('cookie-notice-dismissed')
    if (!dismissed) setVisible(true)
  }, [])

  if (!visible) return null

  const dismiss = () => {
    localStorage.setItem('cookie-notice-dismissed', '1')
    setVisible(false)
  }

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1000,
      background: '#1A1A2E', color: '#FAF7F2', padding: '1rem 1.5rem',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem',
      fontFamily: 'DM Sans, sans-serif', fontSize: '0.875rem',
    }}>
      <span>
        This site uses a secure authentication cookie to keep you logged in.{' '}
        <a href="/privacy" style={{ color: '#E8A838', textDecoration: 'underline' }}>Privacy policy</a>
      </span>
      <button
        onClick={dismiss}
        style={{ background: '#E8A838', color: '#1A1A2E', border: 'none', borderRadius: '4px', padding: '0.5rem 1rem', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}
      >
        OK
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Mount in layout.tsx**

In `web/src/app/layout.tsx`, import and render `<CookieNotice />` inside the `<body>` tag, after the main content:

```tsx
import { CookieNotice } from '@/components/CookieNotice'

// Inside the return, at the end of <body>:
<CookieNotice />
```

- [ ] **Step 3: Test**

Open any page locally. Confirm the banner appears at the bottom. Click OK — confirm it disappears and does not reappear on refresh (localStorage key set).

---

## Task 16: Rollback runbook

**Files:**
- Create: `docs/runbooks/rollback.md`

- [ ] **Step 1: Write rollback.md**

```markdown
# Rollback Runbook

## ECS service rollback (fast — ~2 minutes)

When a bad deploy is live, roll back to the previous task definition revision:

```bash
# Find the previous revision
aws ecs describe-task-definition --task-definition render-production-api \
  --query 'taskDefinition.revision'

# Roll back (replace N with the previous revision number)
aws ecs update-service \
  --cluster render-production \
  --service render-production-api \
  --task-definition render-production-api:N \
  --force-new-deployment

# Same for web if needed
aws ecs update-service \
  --cluster render-production \
  --service render-production-web \
  --task-definition render-production-web:N \
  --force-new-deployment
```

## Database migration rollback policy

Migrations are **forward-only**. If a migration causes issues:
1. Fix the data/schema with a new migration.
2. Never run `migrate down` in production — it risks data loss.

## Terraform rollback

If a Terraform change caused an issue, revert the `.tf` file commit and apply:

```bash
cd infra/terraform
git checkout <previous-commit> -- modules/
terraform apply -var-file=environments/production.tfvars ...
```
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/rollback.md infra/terraform/ .github/workflows/deploy.yml \
  web/src/middleware.ts web/src/app/coming-soon/ web/src/app/privacy/ \
  web/src/app/terms/ web/src/components/CookieNotice.tsx web/src/app/layout.tsx
git commit -m "feat(infra): E11 production infrastructure, CI/CD, pre-launch gate, legal pages"
```
