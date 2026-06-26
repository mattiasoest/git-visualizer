output "cloudfront_url" {
  description = "HTTPS URL for the frontend (use as CORS origin)."
  value       = module.frontend.cloudfront_url
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID for cache invalidation."
  value       = module.frontend.cloudfront_distribution_id
}

output "frontend_bucket_name" {
  description = "S3 bucket name for frontend static assets."
  value       = module.frontend.bucket_name
}

output "api_url" {
  description = "HTTPS URL for the backend API (use as VITE_API_BASE_URL)."
  value       = module.backend.api_url
}

output "ec2_instance_id" {
  description = "Backend EC2 instance ID."
  value       = module.backend.instance_id
}

output "ec2_public_dns" {
  description = "Public DNS name of the backend instance."
  value       = module.backend.public_dns
}

output "artifacts_bucket_name" {
  description = "S3 bucket for backend JAR artifacts."
  value       = module.backend.artifacts_bucket_name
}

output "github_token_parameter_name" {
  description = "SSM parameter name for the GitHub token."
  value       = module.backend.github_token_parameter_name
}

output "aws_region" {
  description = "AWS region used for deployment."
  value       = var.aws_region
}
