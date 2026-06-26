# AWS infrastructure

Terraform stack for hosting the Git Visualizer:

- **Frontend**: S3 + CloudFront (static `frontend/dist/`)
- **Backend**: EC2 (`t4g.micro` by default) + Elastic IP + Caddy reverse proxy + Spring Boot JAR

The API is **not** proxied through CloudFront because SSE (`/api/stream/events`) requires a long-lived connection that CloudFront cannot reliably support.

## Prerequisites

- [Terraform](https://www.terraform.io/downloads) >= 1.5
- [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) configured (`aws configure`)
- Node.js 24+ and Java 25+ for local builds (or build in CI)

## One-time setup

### 1. Bootstrap remote state

From `infra/bootstrap/`:

```bash
cd infra/bootstrap
terraform init
terraform apply
```

Copy the printed `backend_config` values into `infra/backend.hcl` (see `backend.hcl.example`).

### 2. Configure variables

```bash
cd infra
cp backend.hcl.example backend.hcl    # edit bucket/table names from bootstrap output
cp terraform.tfvars.example terraform.tfvars
```

Set `github_token` in `terraform.tfvars` if you have one (optional but recommended for GitHub rate limits).

### 3. Apply infrastructure

```bash
cd infra
terraform init -backend-config=backend.hcl
terraform plan
terraform apply
```

First apply takes several minutes (EC2 bootstrap installs JDK 25 and Caddy).

### 4. Set GitHub token (optional)

If you did not pass `github_token` at apply time, update SSM manually:

```bash
aws ssm put-parameter \
  --name "$(terraform output -raw github_token_parameter_name)" \
  --type SecureString \
  --value "ghp_your_token_here" \
  --overwrite
```

Then refresh the instance env and restart the app:

```bash
INSTANCE_ID="$(terraform output -raw ec2_instance_id)"
aws ssm send-command \
  --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --parameters 'commands=["TOKEN=$(aws ssm get-parameter --name '"$(terraform output -raw github_token_parameter_name)"' --with-decryption --query Parameter.Value --output text)","sed -i \"s/^GITHUB_TOKEN=.*/GITHUB_TOKEN=$TOKEN/\" /etc/gitvisualizer/env","systemctl restart gitvisualizer"]'
```

## Deploy applications

From the repository root:

```bash
./scripts/deploy-backend.sh
./scripts/deploy-frontend.sh
```

Order matters on first deploy: backend first (so API is up), then frontend (bakes `VITE_API_BASE_URL` from Terraform output).

## Useful outputs

```bash
cd infra
terraform output cloudfront_url      # open in browser
terraform output api_url             # backend HTTPS URL
terraform output ec2_instance_id     # for SSM sessions
```

SSM shell:

```bash
aws ssm start-session --target "$(terraform output -raw ec2_instance_id)"
```

## Smoke test / verification

### 1. Backend health (through Caddy)

```bash
curl -fsS "$(terraform output -raw api_url)/actuator/health"
```

Expected: `{"status":"UP"}` (or similar actuator JSON).

### 2. Caddy TLS

```bash
curl -vI "$(terraform output -raw api_url)/actuator/health"
```

Confirm HTTP/2 or HTTP/1.1 over TLS with a valid Let's Encrypt certificate for the EC2 public hostname.

### 3. CORS from CloudFront origin

```bash
CF_URL="$(terraform output -raw cloudfront_url)"
API_URL="$(terraform output -raw api_url)"

curl -fsSI -X OPTIONS \
  -H "Origin: ${CF_URL}" \
  -H "Access-Control-Request-Method: GET" \
  "${API_URL}/api/stream/events"
```

Expected response headers include:

- `access-control-allow-origin: <cloudfront-url>`
- `access-control-allow-methods: GET`

### 4. SSE stream

```bash
curl -fsSN -H "Accept: text/event-stream" \
  -H "Origin: $(terraform output -raw cloudfront_url)" \
  "$(terraform output -raw api_url)/api/stream/events"
```

Leave running; you should see periodic `: ping` comments (~every 15s) and `event: github-event` payloads when GitHub activity is ingested.

### 5. Frontend in browser

1. Open `terraform output -raw cloudfront_url`
2. Open DevTools → Network → filter `events`
3. Confirm the SSE request stays **pending** (connected), not failed
4. Confirm static assets load from CloudFront

### 6. User-data / service logs (if something fails)

```bash
aws ssm start-session --target "$(terraform output -raw ec2_instance_id)"
sudo tail -f /var/log/gitvisualizer-user-data.log
sudo journalctl -u caddy -f
sudo journalctl -u gitvisualizer -f
```

## Architecture notes

- Caddy listens on `:443` / `:80` and reverse-proxies to Spring Boot on `127.0.0.1:8080`
- Caddyfile uses `flush_interval -1` for SSE (`infra/templates/Caddyfile.tpl`)
- JVM heap capped at 512m for `t4g.micro` (`infra/templates/gitvisualizer.service.tpl`)
- Port `8080` is not exposed in the security group

## Tear down

```bash
cd infra
terraform destroy
```

Then destroy bootstrap state resources if no longer needed:

```bash
cd infra/bootstrap
terraform destroy
```

## Troubleshooting

| Symptom | Check |
|--------|--------|
| Caddy cert errors | Ports 80/443 open; public hostname resolves; review `journalctl -u caddy` |
| SSE fails in browser | Frontend must use `VITE_API_BASE_URL` = `api_url`; API must not go through CloudFront |
| CORS errors | `SPRING_WEB_CORS_ALLOWED_ORIGINS` in `/etc/gitvisualizer/env` must match `cloudfront_url` exactly |
| OOM on `t4g.micro` | Confirm `-Xmx512m`; consider `instance_type = "t4g.small"` in `terraform.tfvars` |
| SSM deploy fails | Instance needs ~3–5 min after first boot for SSM agent; check IAM instance profile |
