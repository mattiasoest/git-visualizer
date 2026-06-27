# GitHub Events Visualizer

Real-time visualization of GitHub public activity. A Spring Boot backend polls the [GitHub Events REST API](https://docs.github.com/en/rest/activity/events?apiVersion=2026-03-10) and streams new events to a React frontend over Server-Sent Events (SSE).

## Project layout

```
frontend/   React + Vite UI
backend/    Spring Boot API
scripts/    release and version sync helpers
```

The repo root is an npm workspace (`package.json` + `package-lock.json`). Install Node dependencies from the root, not only inside `frontend/`.

## Architecture

- **Backend**: Spring Boot 4 in `backend/` polls `GET /events` with ETag support and respects `X-Poll-Interval`
- **Frontend**: React + Vite in `frontend/` renders a force-directed activity graph and live event feed
- **Transport**: SSE at `/api/stream/events`

The frontend and backend are deployed separately. In development, Vite proxies `/api` to the backend.

## Prerequisites

For local development (two terminals):

- Java 25+
- Maven 3.9+
- Node.js 24+

For Docker development (single command, no local Java/Node required):

- Docker with Compose

## Configuration

Set an optional GitHub token for higher rate limits (recommended):

```bash
export GITHUB_TOKEN=ghp_your_token_here
```

Without a token, unauthenticated requests are limited to 60 requests/hour.

Configuration lives in [`backend/src/main/resources/application.yaml`](backend/src/main/resources/application.yaml):

```yaml
github:
  api:
    base-url: https://api.github.com
    events-path: /events
    per-page: 100
    min-poll-interval-seconds: 60
```

For separate frontend hosting, set CORS on the backend to your frontend origin:

```yaml
spring:
  web:
    cors:
      allowed-origins: https://your-frontend.example.com
```

Or via environment variable: `SPRING_WEB_CORS_ALLOWED_ORIGINS=https://your-frontend.example.com`

## Development

Two ways to run the app in development. Both start a backend on port 8080 and a Vite dev server on port 5173. Open http://localhost:5173.

### Docker Compose (recommended if you don't want local Java/Node)

From the repo root:

```bash
docker compose up --build
```

Optional GitHub token (read from your shell environment):

```bash
export GITHUB_TOKEN=ghp_your_token_here
docker compose up --build
```

Source is mounted into the containers, so code changes reload without rebuilding images. First startup can take a few minutes while Maven and npm dependencies are downloaded.

Stop with `Ctrl+C`, or run `docker compose down` in another terminal.

### Local (two terminals)

```bash
# Once, from repo root
npm install

# Terminal 1 — backend (port 8080)
cd backend && ./mvnw spring-boot:run

# Terminal 2 — frontend (port 5173, proxies /api to backend)
npm run dev --workspace=frontend
```

For a production API URL during local builds, set `VITE_API_BASE_URL` in [`frontend/.env`](frontend/.env).

## Release

Bump the version across root, frontend, and backend, create a release commit, and tag it (for example `v0.2.0`):

```bash
npm run release minor   # patch | major | x.y.z
git push origin HEAD --follow-tags
```

Pushing a `v*` tag triggers GitHub Actions:

| Workflow | What it does |
| --- | --- |
| [`.github/workflows/deploy-frontend.yml`](.github/workflows/deploy-frontend.yml) | Build frontend → sync to S3 → invalidate CloudFront |
| [`.github/workflows/publish-backend.yml`](.github/workflows/publish-backend.yml) | Build backend Docker image → push to GHCR |

### GitHub Actions configuration

**Repository variables**

| Variable | Purpose |
| --- | --- |
| `VITE_API_BASE_URL` | Backend URL baked into the frontend build |
| `S3_BUCKET` | Frontend static hosting bucket |
| `CLOUDFRONT_DISTRIBUTION_ID` | CloudFront distribution to invalidate |
| `AWS_REGION` | AWS region for deploy |

**Repository secret**

| Secret | Purpose |
| --- | --- |
| `AWS_ROLE_ARN` | IAM role for GitHub OIDC (S3 + CloudFront) |

The backend publish workflow uses the built-in `GITHUB_TOKEN` to push to `ghcr.io/<owner>/git-visualizer-backend` with the git tag and `latest`.

The frontend deploy workflow uses the `production` GitHub environment.

## Production build

Build and deploy the backend and frontend independently, or let the release workflows above handle tagged deploys.

**Backend** — publish image to GHCR manually:

```bash
cd backend
export GITHUB_TOKEN=ghp_your_token_here   # needs write:packages
./scripts/publish-image.sh                # tags and pushes :latest
./scripts/publish-image.sh v1.0.0         # also updates :latest
```

**Backend** — run on a server (pulls the published image):

```bash
cd backend
cp .env.example .env                      # set GHCR_IMAGE, CORS origin, etc.
# If the GHCR package is private:
# echo $GITHUB_TOKEN | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
./scripts/deploy.sh
```

Or manually:

```bash
cd backend
docker compose pull
docker compose up -d
```

Or run the JAR directly:

```bash
cd backend && ./mvnw package
java -jar target/gitvisualizer-0.0.1-SNAPSHOT.jar
```

**Frontend** — static assets in `frontend/dist/`:

```bash
npm ci
VITE_API_BASE_URL=https://api.example.com npm run build --workspace=frontend
```

For local development builds, `frontend/.env` can set `VITE_API_BASE_URL` instead.

## API endpoints

| Endpoint                 | Description                 |
| ------------------------ | --------------------------- |
| `GET /api/stream/events` | SSE stream of GitHub events |
| `GET /actuator/health`   | Health check                |
