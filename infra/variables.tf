variable "aws_region" {
  description = "AWS region for all resources."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Short name used for resource naming."
  type        = string
  default     = "git-visualizer"
}

variable "instance_type" {
  description = "EC2 instance type for the backend."
  type        = string
  default     = "t4g.micro"
}

variable "github_token" {
  description = "Optional GitHub API token stored in SSM Parameter Store."
  type        = string
  sensitive   = true
  default     = ""
}

variable "ssh_cidr_blocks" {
  description = "CIDR blocks allowed to SSH to the backend instance. Empty list disables port 22."
  type        = list(string)
  default     = []
}

variable "allowed_account_id" {
  description = "Optional AWS account ID guard for the provider."
  type        = string
  default     = null
}
