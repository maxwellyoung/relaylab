# RelayLab technical report - working draft

**Student:** Maxwell Young  
**Student ID:** 23213801  
**Course:** COMP713 Distributed and Mobile Systems  
**Assessment:** Assessment 2 - Individual Project, Option A

This draft describes the verified implementation as of 11 August 2026. It must
be reviewed against the final Canvas instructions before submission. The
lecturer MySQL lane is implemented but cannot be claimed as live-tested until
the private credentials arrive.

## 1. Project purpose

RelayLab is a small distributed web/API application for observing how one
request behaves when a dependency is healthy, slow, unavailable, malformed, or
unreachable. A user chooses a deterministic dependency behaviour and supplies a
JSON payload. The coordinator sends the request to a separately running service,
classifies the result, and stores durable evidence including the outcome, HTTP
status, elapsed time, and response body.

The project deliberately stays within the Option A size in the official brief.
It has one client interface, four meaningful API operations, two related
persistent entities, input validation, controlled errors, and clear run/test
instructions. It avoids authentication, arbitrary external services, complex
deployment, and a large schema.

## 2. Architecture and communication flow

```text
React browser client
        |
        | JSON over HTTP
        v
Express coordinator API
        |                         |
        | bounded HTTP request    | parameterised SQL
        v                         v
Downstream simulator         relational database
                             (SQLite or MySQL)
```

The browser communicates only with the coordinator. It never accesses the
database or simulator directly. The coordinator validates experiment input,
owns persistence, measures the downstream request, enforces a 400 ms deadline,
validates the response shape, and maps the observation to a stable outcome.

The downstream simulator is a separate Express process. Its deterministic
behaviours make success and failure demonstrations repeatable without relying
on a third-party network. This creates two visible HTTP boundaries: browser to
coordinator and coordinator to downstream service.

## 3. API operations and workflow

| Method and route | Responsibility |
| --- | --- |
| `POST /api/experiments` | Validate and save a request experiment |
| `GET /api/experiments` | List saved experiments newest first |
| `GET /api/experiments/:id` | Read one experiment with its run history |
| `POST /api/experiments/:id/runs` | Execute, classify, and persist one distributed run |

This is a meaningful create/read/execute workflow rather than full CRUD. The
official brief allows basic CRUD **or another meaningful workflow**. A saved
experiment is reusable, and every execution creates a new evidence record that
can be reopened through the client.

## 4. Persistence design

The data model contains two related entities:

```text
experiments 1 ---- many experiment_runs
```

`experiments` stores the name, selected behaviour, JSON payload, and creation
time. `experiment_runs` stores the foreign key, classified outcome, optional
HTTP status, duration, response evidence, and creation time. Deleting an
experiment would cascade to its runs at the schema level, although deletion is
not exposed in the frozen API.

SQLite provides the deterministic offline and automated-test lane. The
lecturer-server lane uses MySQL with the same relationship and parameterised
queries. The MySQL pool has a non-configurable maximum of five connections.
Credentials are read only from ignored local environment configuration.

## 5. Validation and failure handling

Zod schemas reject invalid experiment names, unsupported behaviours, and
non-object payloads. Missing experiment identifiers return controlled 404
responses. Persistence failures return a generic 503 response rather than
leaking database or credential details.

The coordinator distinguishes five downstream results:

- `success`: valid JSON with HTTP 200;
- `downstream_error`: a reachable dependency returns an error such as 503;
- `timeout`: the response exceeds the 400 ms deadline;
- `invalid_response`: the dependency returns HTTP 200 with the wrong body shape;
- `unreachable`: the TCP connection fails.

Each attempted exchange is persisted, including controlled failures, so the
evidence is not limited to successful requests.

## 6. Testing and operational evidence

The reproducible verification command is:

```bash
npm ci
npm run verify
```

The current suite contains 21 automated tests:

- three client tests for create/run/render, invalid JSON rejection before an
  API write, and reopening saved history;
- thirteen coordinator/configuration tests covering public API behaviour,
  persistence, all five outcomes, MySQL configuration, and the five-connection
  limit;
- five downstream tests proving each deterministic service response.

`npm run verify` also runs every TypeScript check and production build, starts
the built application, creates and runs an experiment, restarts the services,
and proves that the saved experiment and run survived. Both full and
production-only dependency audits currently report zero vulnerabilities.

Rendered browser checks at desktop and 390 px widths showed no framework error
overlay or console warnings/errors. A 503 exchange was persisted and increased
the selected run count, while saved-history navigation reopened an older HTTP
200 result.

## 7. Limitations and possible improvements

The downstream behaviours are simulations and do not measure arbitrary
external services. The coordinator intentionally has no retries, queue,
circuit breaker, or production monitoring. The system supports one local user
and exposes no edit/delete operations. These boundaries keep the application
small enough to explain and test completely.

If the project were extended, useful next steps would be configurable timeout
policies, aggregated outcome statistics, and carefully bounded retry or circuit
breaker experiments. Those are not required to demonstrate the current
distributed communication and persistence concepts.

## 8. Running the system

Install Node.js 24 or later, then run:

```bash
npm install
npm run dev
```

The client is available at `http://localhost:5173`; the coordinator and
downstream health endpoints use ports 3000 and 3001. The README documents the
ignored MySQL environment variables. Real credentials must never appear in the
repository, report, screenshots, terminal recording, or demonstration video.
