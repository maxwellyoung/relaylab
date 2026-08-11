# RelayLab

RelayLab is a deliberately small API reliability workbench for the COMP713
Option A individual project. It runs a saved request experiment through a
separate downstream service, classifies what happened, and keeps the result as
reproducible evidence.

## Architecture

```text
React browser client (port 5173)
        |
        | JSON over HTTP
        v
Coordinator API (port 3000)
        |                         |
        | HTTP with 400 ms bound  | parameterised SQL
        v                         v
Downstream simulator         SQLite database
(port 3001)                  or lecturer MySQL schema
```

The browser never accesses SQLite or the downstream simulator directly. The
coordinator owns experiment validation, outbound request timing, response-shape
validation, outcome classification, and persistence. The downstream process
provides deterministic healthy and failure behaviours without relying on a
third-party network.

In production, one container starts the coordinator and downstream as separate
Node processes. Only the coordinator port is public. It serves the built React
client. The current hosted demonstration mounts SQLite at `/data`; the
lecturer-provided MySQL schema is available as a credential-gated persistence
lane.

## Public workflow

1. Save a request experiment with a name, behaviour, and JSON payload.
2. Run that experiment through the coordinator.
3. The coordinator calls the separate downstream service.
4. The coordinator classifies and stores the observed result.
5. Reopen the experiment and review its run history.

The frozen contract is in [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md).

## Deterministic behaviours

| Behaviour | Downstream action | Coordinator outcome |
| --- | --- | --- |
| `healthy` | Returns valid JSON with `200` | `success` |
| `slow` | Responds after the coordinator deadline | `timeout` |
| `unavailable` | Returns structured JSON with `503` | `downstream_error` |
| `malformed` | Returns unexpected plain text with `200` | `invalid_response` |

If the downstream process is stopped, the coordinator records `unreachable`
instead of crashing or losing the attempt.

## Software

- Node.js 24 or later
- npm 11 or later

No account, API key, external database, or cloud service is required for the
local SQLite lane.

## Install and run

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. The root development command starts all three
processes. Vite proxies browser `/api` requests to the coordinator.

The first run creates `data/relaylab.sqlite`. Runtime configuration may be
overridden without committing secrets:

```bash
PORT=3000
RELAYLAB_DATA_DIR=/absolute/path/to/relaylab-data
DOWNSTREAM_URL=http://127.0.0.1:3001
DOWNSTREAM_TIMEOUT_MS=400
DOWNSTREAM_PORT=3001
```

`VITE_API_BASE_URL` is only needed when a built client does not use Vite's local
proxy.

### Lecturer-provided MySQL server

Copy `.env.example` to an ignored `.env` file and set the values supplied by
the lecturer:

```bash
RELAYLAB_DATABASE_DRIVER=mysql
RELAYLAB_DB_HOST=provided-host
RELAYLAB_DB_PORT=3306
RELAYLAB_DB_NAME=provided-schema
RELAYLAB_DB_USER=provided-username
RELAYLAB_DB_PASSWORD=provided-password
RELAYLAB_DB_SSL=false
```

The coordinator creates the `experiments` and `experiment_runs` tables in the
assigned schema and uses parameterised queries. The MySQL pool limit is a
non-configurable application constant set to **5**, matching the course
requirement. Never put real credentials in `.env.example`, Git, screenshots,
logs, the report, or the demonstration video.

## Test and build

```bash
npm test
npm run typecheck
npm run build
npm run smoke
```

The tests exercise public HTTP behaviour with isolated temporary SQLite
databases and verify the lecturer MySQL configuration fails closed with a
hard five-connection pool. Coordinator tests use a real TCP boundary for the
downstream contract and cover healthy, `503`, malformed, timeout, and
unreachable results. Client tests exercise the create/run/render workflow,
input rejection, and reopening durable history. The downstream package
independently proves each deterministic behaviour. `npm run smoke` starts the
built production application, creates and runs an experiment, restarts both
services, and proves that the experiment and run remain available.

Run the complete local verification ladder with `npm run verify`. The recording
route and claim-to-evidence matrix are in
[`docs/DEMONSTRATION_RUNBOOK.md`](docs/DEMONSTRATION_RUNBOOK.md).

## Production deployment

The repository includes a multi-stage [`Dockerfile`](Dockerfile) and
[`fly.toml`](fly.toml). The image runs the test, type-check, and production-build
gates before it can be released.

```bash
flyctl deploy
```

The Fly configuration uses one machine because SQLite is attached to a single
persistent volume. Automatic stop/start keeps the small assessment deployment
idle when it is unused. The coordinator health endpoint is `/health`.

## Coordinator API

| Method | Route | Behaviour |
| --- | --- | --- |
| `POST` | `/api/experiments` | Validate and create an experiment |
| `GET` | `/api/experiments` | List experiments newest first |
| `GET` | `/api/experiments/:id` | Return one experiment and its run history |
| `POST` | `/api/experiments/:id/runs` | Execute and persist one distributed run |

Example experiment:

```json
{
  "name": "Slow inventory lookup",
  "behavior": "slow",
  "payload": {
    "orderId": "ORDER-42",
    "quantity": 2
  }
}
```

## Known limitations

- The downstream behaviours are deterministic simulations, not measurements of
  arbitrary external systems.
- The coordinator intentionally performs no retry or circuit-breaking.
- Experiments and runs cannot yet be edited or deleted.
- One local user only; authentication is outside the assignment scope.
- The hosted demonstration is intentionally single-machine and is not designed
  for concurrent production traffic.

## Project evidence

Development decisions and red-green milestones are recorded in
[`docs/DEVELOPMENT_LOG.md`](docs/DEVELOPMENT_LOG.md).
