# GitHub Events Visualizer

Real-time visualization of GitHub public activity. A Spring Boot backend polls the [GitHub Events REST API](https://docs.github.com/en/rest/activity/events?apiVersion=2026-03-10) and streams new events to a React frontend over Server-Sent Events (SSE).

## Project layout

```
frontend/   React + Vite UI
backend/    Spring Boot API
```

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
# Terminal 1 — backend (port 8080)
cd backend && ./mvnw spring-boot:run

# Terminal 2 — frontend (port 5173, proxies /api to backend)
cd frontend && npm install && npm run dev
```

## Production build

Build and deploy the backend and frontend independently.

**Backend** — packages a Spring Boot JAR (API only):

```bash
cd backend && ./mvnw package
java -jar backend/target/gitvisualizer-0.0.1-SNAPSHOT.jar
```

**Frontend** — static assets in `frontend/dist/`:

```bash
cd frontend && npm install && npm run build
```

Serve `frontend/dist/` from your static host (nginx, S3 + CDN, etc.). Set the backend URL at build time:

```bash
VITE_API_BASE_URL=https://api.example.com npm run build
```

## API endpoints

| Endpoint                 | Description                 |
| ------------------------ | --------------------------- |
| `GET /api/stream/events` | SSE stream of GitHub events |
| `GET /actuator/health`   | Health check                |
