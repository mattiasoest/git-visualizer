locals {
  name_prefix = replace(var.project_name, "_", "-")
}

module "frontend" {
  source = "./modules/frontend"

  project_name = local.name_prefix
  aws_region   = var.aws_region
}

module "backend" {
  source = "./modules/backend"

  project_name        = local.name_prefix
  aws_region          = var.aws_region
  instance_type       = var.instance_type
  github_token        = var.github_token
  ssh_cidr_blocks     = var.ssh_cidr_blocks
  cors_allowed_origin = module.frontend.cloudfront_url

  depends_on = [module.frontend]
}
