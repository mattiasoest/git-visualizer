locals {
  is_arm_instance = can(regex("^t4g\\.", var.instance_type)) || can(regex("^m7g\\.", var.instance_type)) || can(regex("^c7g\\.", var.instance_type))
  ami_arch        = local.is_arm_instance ? "arm64" : "x86_64"
  name_prefix     = var.project_name
}

data "aws_caller_identity" "current" {}

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

data "aws_ami" "amazon_linux_2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-kernel-*-${local.ami_arch}"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

resource "aws_s3_bucket" "artifacts" {
  bucket = "${local.name_prefix}-artifacts-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_ssm_parameter" "github_token" {
  name  = "/${local.name_prefix}/github_token"
  type  = "SecureString"
  value = var.github_token != "" ? var.github_token : "unset"

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_iam_role" "backend" {
  name = "${local.name_prefix}-backend-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.backend.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "backend" {
  name = "${local.name_prefix}-backend-policy"
  role = aws_iam_role.backend.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters"
        ]
        Resource = aws_ssm_parameter.github_token.arn
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.artifacts.arn,
          "${aws_s3_bucket.artifacts.arn}/*"
        ]
      }
    ]
  })
}

resource "aws_iam_instance_profile" "backend" {
  name = "${local.name_prefix}-backend-profile"
  role = aws_iam_role.backend.name
}

resource "aws_security_group" "backend" {
  name        = "${local.name_prefix}-backend-sg"
  description = "Backend API via Caddy"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTP for ACME"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  dynamic "ingress" {
    for_each = length(var.ssh_cidr_blocks) > 0 ? [1] : []
    content {
      description = "SSH"
      from_port   = 22
      to_port     = 22
      protocol    = "tcp"
      cidr_blocks = var.ssh_cidr_blocks
    }
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.name_prefix}-backend-sg"
  }
}

resource "aws_instance" "backend" {
  ami                    = data.aws_ami.amazon_linux_2023.id
  instance_type          = var.instance_type
  subnet_id              = data.aws_subnets.default.ids[0]
  vpc_security_group_ids = [aws_security_group.backend.id]
  iam_instance_profile   = aws_iam_instance_profile.backend.name

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  user_data = templatefile("${path.module}/../../templates/ec2-user-data.sh.tpl", {
    cors_allowed_origin    = var.cors_allowed_origin
    github_token_parameter = aws_ssm_parameter.github_token.name
    aws_region             = var.aws_region
  })

  root_block_device {
    volume_size = 20
    volume_type = "gp3"
  }

  tags = {
    Name = "${local.name_prefix}-backend"
  }

  lifecycle {
    ignore_changes = [user_data]
  }
}

resource "aws_eip" "backend" {
  domain = "vpc"

  tags = {
    Name = "${local.name_prefix}-backend-eip"
  }
}

resource "aws_eip_association" "backend" {
  instance_id   = aws_instance.backend.id
  allocation_id = aws_eip.backend.id
}

resource "aws_ssm_parameter" "instance_id" {
  name  = "/${local.name_prefix}/backend_instance_id"
  type  = "String"
  value = aws_instance.backend.id
}
