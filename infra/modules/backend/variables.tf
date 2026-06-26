variable "project_name" {
  type = string
}

variable "aws_region" {
  type = string
}

variable "instance_type" {
  type = string
}

variable "github_token" {
  type      = string
  sensitive = true
}

variable "ssh_cidr_blocks" {
  type = list(string)
}

variable "cors_allowed_origin" {
  type = string
}
