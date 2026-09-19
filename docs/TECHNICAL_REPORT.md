# RelayLab technical report

**Student:** Maxwell Young

**Student ID:** 23213801

**Course:** COMP713 Distributed and Mobile Systems

**Assessment:** Assessment 2 - Individual Project, Option A

**Implementation status date:** 18 September 2026

## 1. Project Introduction and Requirements

RelayLab is a small distributed web application for observing what happens when
one service depends on another. A user selects a deterministic dependency
behaviour and a JSON payload; a coordinator sends the request to a separately
running downstream service over JSON-RPC 2.0, classifies the result, and stores
the evidence.

The intended user wants a repeatable way to compare a healthy exchange with each
failure mode. The selected assignment route is
Option A. Its requirements are one usable client, a server-side API, at least three
meaningful operations, persistent related data, input validation, controlled
errors, and reproducible run and test instructions.

RelayLab implements create, read, execute and delete: create an experiment, list
saved experiments, read one with its history, execute it repeatedly, and delete
it with its runs. That keeps the scope small while the workflow stays complete and
demonstrable.

## 2. Architecture and Technology Stack

```text
React browser client
        |
        | JSON over HTTP
        v
Express coordinator API
        |                         |
        | bounded JSON-RPC 2.0    | parameterised SQL
        | request over HTTP       |
        v                         v
Express downstream service   relational database
                              (SQLite or MySQL)
```

The client is React with TypeScript and Vite. The coordinator and downstream
service are separate Node.js/Express processes written in TypeScript. Zod
validates request and response data. The persistence adapter uses SQLite for
credential-free development and tests, or the lecturer MySQL schema when
configured.

The browser communicates only with the coordinator. It never accesses the
database or downstream service directly. The coordinator owns validation,
persistence, request timing, the request deadline (400 ms by default), response-contract checking,
correlation-ID checking, and outcome classification. Both services log each exchange, and the outbound request and its reply carry a shortened correlation ID, so one request can be followed across the two processes. The downstream service exposes deterministic
behaviours so both success and failure demonstrations remain repeatable without
depending on a third-party network.

## 3. Implemented Functionality

| Significant function | Status | Evidence |
| --- | --- | --- |
| Create and validate a saved experiment | Completed and tested | API and client tests cover valid creation and invalid input |
| List saved experiments | Completed and tested | API tests and client saved-history view |
| Read one experiment and its runs | Completed and tested | API tests, client reopening test, and restart smoke |
| Delete an experiment and cascade its runs | Completed and tested | API test asserts 204, then 404, and no orphan runs |
| Idempotent retry of a run | Completed and tested | Replay test, mid-flight dedupe test, and a timed-out attempt retried into one execution |
| Execute a versioned downstream RPC method | Completed and tested locally | Healthy result, RPC error, timeout, malformed result, and unreachable tests |
| Persist experiments and one-to-many run history | Completed and tested | SQLite smoke and live lecturer-MySQL restart check |
| Use lecturer MySQL with a five-connection maximum | Completed; live-checked manually | Verified TLS and save/run/reopen/restart on the assigned schema (15 September); transactional writes rechecked 17 September. Automated tests use a stub connection |
| Log each exchange with its correlation ID | Completed and tested | Coordinator and downstream logging tests; live logs in the video |
| Run services independently and inspect stored rows | Completed and tested | Separate start scripts and `npm run db:inspect`, with a test that kills a real downstream process |
| Hosted deployment (optional) | Not completed | Fly configuration is included but not redeployed; the brief does not require hosting |

The public coordinator API has five resource operations, plus a `GET /health` that reports the configured driver and deadline: `POST /api/experiments`,
`GET /api/experiments`, `GET /api/experiments/:id`, and
`POST /api/experiments/:id/runs` and `DELETE /api/experiments/:id`. Every
execution produces a durable run record, including controlled failures, and each
run response carries an `X-Correlation-Id` header matching both services' logs.

## 4. Communication and Distributed-System Concepts

RelayLab uses two request-response styles. The browser exchanges REST-shaped
JSON resources with the coordinator. The coordinator calls the private
downstream endpoint with JSON-RPC 2.0 method `relaylab.process.v1`, a UUID
correlation ID, and method parameters. It waits only for the configured
deadline and accepts a response only when its ID and method-result schema
match.

The downstream can return a valid RPC result, application error `-32001`, a
deliberately late result, or a result with the wrong schema. RPC application
errors use HTTP 200, so the interface separates successful HTTP transport from
method failure. The coordinator maps observations to stable outcomes:
`success`, `downstream_error`, `timeout`, `invalid_response`, or `unreachable`.
This distinguishes an application error, a deadline failure, a contract failure,
and a transport failure. The coordinator remains
available and persists the attempt instead of crashing. A timeout is
at-least-once: the dependency may finish after the coordinator gives up, which
the paired logs show. The browser therefore sends one id per click as both the
exchange id and an `Idempotency-Key`. The coordinator replays a settled run for
a repeated key without calling the dependency, and for an unsettled attempt it
calls again while the dependency dedupes by key, so a retried timeout returns
the single completed result: effectively once.

Zod schemas reject unsupported behaviours, blank or oversized names, and
payloads that are not JSON objects. Missing or malformed experiment identifiers produce a
controlled 404. Persistence exceptions produce a generic 503 without leaking
database details. The MySQL path uses parameterised statements and a
non-configurable pool limit of five connections. Each MySQL insert and its
read-back share one transaction, so a failed write rolls back rather than
leaving a row the client was told was not saved.

## 5. Data Design or Message Design

The relational model contains `experiments` and `experiment_runs` in a
one-to-many relationship. An experiment stores its name, selected behaviour,
JSON payload, and creation time. A run stores the experiment foreign key,
classified outcome, optional HTTP status, the dependency's JSON-RPC error code
when its method failed, duration, full RPC evidence, and creation time. Its own column
means failures can be counted in SQL, not only read from the envelope. Foreign-key enforcement prevents orphan run records, while
`ON DELETE CASCADE` gives the experiment ownership of its runs: deleting one
removes its history and leaves no orphans.

The schema ships as `database/schema.sqlite.sql` and
`database/schema.mysql.sql`, applied idempotently at startup; SQLite also
indexes runs by experiment and by outcome. Reporting queries ship in `database/queries`. Both scripts constrain the behaviour and outcome
values in the database, not only in the application, and an idempotent migration
adds the error-code column to older schemas without losing rows.

SQLite and MySQL implement the same repository contract: SQLite keeps local
inspection and tests deterministic, MySQL serves the lecturer schema without
changing the client or coordinator API.
Credentials are read only from ignored environment configuration and never
appear in source, documentation, logs, screenshots, or submitted artifacts.

## 6. Testing and Evidence

The verification command is `npm ci && npm run verify`. The suite contains 68
tests: eight client, fifty coordinator, RPC-contract, database and logging,
and ten downstream-service tests, plus a live lecturer-MySQL test that runs
only when its credentials are present. They cover the browser workflow, every
run outcome, validation, correlation, persistence, the pool limit, a failed
write that must not invent evidence, a killed dependency process, one request
traced across both logs, the shipped queries, idempotent replay, and twenty
concurrent runs. GitHub Actions runs
the gate and the MySQL adapter against a real MySQL 8.4 service on every push.

The gate also runs type checks and builds, then starts the built application,
executes an experiment, restarts the services and proves both survived. A
fresh clone passed it on 18 September with no known vulnerabilities. The video
shows the two services starting, a successful exchange, an RPC application
error, a deadline timeout, invalid-JSON rejection, an outage and restart
persistence, all on the lecturer MySQL schema and recorded 18 September,
together with both services' logs for one exchange, the API's own rejection of
an invalid request, and commit dates on the GitHub website.

Live MySQL checks used verified TLS: the transactional write path and
`db:inspect` were rechecked on the assigned schema on 17 and 18 September.

Lab work was submitted on 10 September, with Canvas receipts for Weeks 2–6;
Appendix A maps those concepts to this project.

## 7. Limitations and Possible Improvements

The downstream behaviours are simulations rather than measurements of
arbitrary external services. The coordinator intentionally has no retries,
circuit breaker, queue, authentication, editing, or production
monitoring. The Fly deployment configuration uses a single SQLite instance and is not
designed for concurrent production traffic. The lecturer MySQL adapter passed the demonstrated workflows and restart checks; concurrent-load testing remains outside the verification scope.

Future work could add timeout policies, outcome aggregation, and bounded retry
or circuit-breaker experiments; these are extensions, not missing parts of the
submitted workflow.

## 8. Running Instructions

Install Node.js 24.15 or later. From the project root run `npm ci`, then
`npm run dev`, and open `http://localhost:5173`; ports 5173, 3000 and 3001 host
the three processes. After `npm run build`, `npm run start:downstream` and `npm run start:coordinator` run the services separately, and `npm run db:inspect` prints the stored rows. Run `npm run verify` for the
test, type-check, build, restart-persistence, and audit gate. The README lists
the ignored MySQL values and verified-TLS startup command; real credentials must never be committed or displayed.

## References

Auckland University of Technology. (2026). *COMP713 Individual Project* [Canvas assignment]. https://canvas.aut.ac.nz/courses/23558/assignments/193419

Implementation, explanations and verification material include AI-generated content (OpenAI, 2026; Anthropic, 2026).

OpenAI. (2026). Codex [AI coding assistant]. https://openai.com/codex/

Anthropic. (2026). Claude Code [AI coding assistant]. https://claude.com/claude-code
