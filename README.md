# GitHub Events Visualizer

Real-time visualization of GitHub public activity. A Spring Boot backend polls the [GitHub Events REST API](https://docs.github.com/en/rest/activity/events?apiVersion=2026-03-10) and streams new events to a React frontend over Server-Sent Events (SSE).

## Architecture

- **Backend**: Spring Boot 4 polls `GET /events` with ETag support and respects `X-Poll-Interval`
- **Frontend**: React + Vite renders a force-directed activity graph and live event feed
- **Transport**: SSE at `/api/stream/events`, bootstrap snapshot at `/api/events`

## Prerequisites

- Java 25+
- Maven 3.9+
- Node.js 22+ (for local frontend dev; Maven can install Node for production builds)

## Configuration

Set an optional GitHub token for higher rate limits (recommended):

```bash
export GITHUB_TOKEN=ghp_your_token_here
```

Without a token, unauthenticated requests are limited to 60 requests/hour.

Configuration lives in [`src/main/resources/application.yaml`](src/main/resources/application.yaml):

```yaml
github:
  api:
    base-url: https://api.github.com
    events-path: /events
    per-page: 100
    min-poll-interval-seconds: 60
```

## Development

Run backend and frontend separately:

```bash
# Terminal 1 — backend (port 8080)
./mvnw spring-boot:run

# Terminal 2 — frontend (port 5173, proxies /api to backend)
cd frontend && npm install && npm run dev
```

Open http://localhost:5173

## Production build

Builds the React app into `src/main/resources/static` and packages a single Spring Boot JAR:

```bash
./mvnw package
java -jar target/github-0.0.1-SNAPSHOT.jar
```

Open http://localhost:8080

## API endpoints

| Endpoint | Description |
|---|---|
| `GET /api/events?limit=50` | Snapshot of buffered events |
| `GET /api/stream/events?replay=50` | SSE stream with optional replay |
| `GET /actuator/health` | Health check |

## Notes

GitHub's Events API is optimized for polling, not sub-second delivery. Event latency can range from 30 seconds to several hours depending on GitHub load. The UI updates instantly when the backend receives new events.
