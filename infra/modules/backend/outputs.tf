output "instance_id" {
  value = aws_instance.backend.id
}

output "public_dns" {
  value = aws_instance.backend.public_dns
}

output "public_ip" {
  value = aws_eip.backend.public_ip
}

output "api_url" {
  value = "https://${aws_instance.backend.public_dns}"
}

output "artifacts_bucket_name" {
  value = aws_s3_bucket.artifacts.bucket
}

output "github_token_parameter_name" {
  value = aws_ssm_parameter.github_token.name
}
