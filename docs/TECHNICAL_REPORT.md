# RelayLab technical report

**Student:** Maxwell Young

**Student ID:** 23213801

**Course:** COMP713 Distributed and Mobile Systems

**Assessment:** Assessment 2 - Individual Project, Option A

**Implementation status date:** 20 September 2026

## 1. Project Introduction and Requirements

RelayLab is a small distributed web application for observing what happens when
one service depends on another. A user selects a deterministic dependency
behaviour and a JSON payload; a coordinator sends the request to a separately
running downstream service over JSON-RPC 2.0, classifies the result, and stores
the evidence.

The intended user is a developer or COMP713 learner investigating partial failure. The selected assignment route is
Option A. Its requirements are one usable client, a server-side API, at least three
meaningful operations, persistent related data, input validation, controlled
errors, and reproducible run and test instructions.

RelayLab implements create, read, execute and delete: create an experiment, list
saved experiments, read one with its history, execute it repeatedly, and delete
it with its runs. The workflow is small and demonstrable.

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
configured. Express keeps both service boundaries inspectable. SQLite makes the marker's first run independent of credentials; the interchangeable MySQL adapter demonstrates the same relationship on the assigned server. This is a distributed process boundary over real HTTP, even when the processes share one machine; it does not imply replication or high availability.

The browser communicates only with the coordinator. It never accesses the
database or downstream service directly. The coordinator owns validation,
persistence, request timing, the request deadline (400 ms by default), response-contract checking,
correlation-ID checking, and outcome classification. Requests and replies carry the full correlation ID; both services log its first eight characters for readability, while the client displays the shortened value. The downstream service exposes deterministic
behaviours so both success and failure demonstrations remain repeatable without
depending on a third-party network.

## 3. Implemented Functionality

| Significant function | Status | Evidence |
| --- | --- | --- |
| Create and validate a saved experiment | Completed and tested | API and client tests cover valid creation and invalid input |
| List saved experiments | Completed and tested | API tests and client saved-history view |
| Read one experiment and its runs | Completed and tested | API tests, client reopening test, and restart smoke |
| Delete an experiment and cascade its runs | Completed and tested | API test asserts 204, then 404, and no orphan runs |
| Same-key retry of a run | Completed and tested within process lifetime | Settled replay, in-flight deduplication, timeout recovery and cross-experiment isolation tests |
| Execute a versioned downstream RPC method | Completed and tested locally | Healthy result, RPC error, timeout, malformed result, and unreachable tests |
| Persist experiments and one-to-many run history | Completed and tested | SQLite smoke and live lecturer-MySQL restart check |
| Use lecturer MySQL with a five-connection maximum | Completed; live-checked manually | Verified-TLS save/run/restart evidence from 15-18 September; rollback tests use stubs; optional live adapter test is separate |
| Log each exchange with its correlation ID | Completed and tested | Coordinator and downstream logging tests; live logs in the video |
| Run services independently and inspect stored rows | Completed and tested | Separate start scripts and `npm run db:inspect`, with a test that kills a real downstream process |
| Hosted deployment (optional) | Not completed | Fly configuration is included but not redeployed; the brief does not require hosting |

The public coordinator API has five resource operations, plus a `GET /health` that reports the configured driver and deadline: `POST /api/experiments`,
`GET /api/experiments`, `GET /api/experiments/:id`, and
`POST /api/experiments/:id/runs` and `DELETE /api/experiments/:id`. A newly completed attempt returns HTTP 201 after its record is saved, even if the stored outcome is a dependency failure. A settled replay returns HTTP 200 and the existing record. Storage failure returns 503 rather than claiming that evidence was saved. The correlation header connects a new exchange to both services' logs.

For example, save a slow inventory lookup, run it, then reopen its history after restarting the services. The timeout remains inspectable beside the original payload. Deleting the experiment removes both its definition and dependent history. This connects all five operations through one relationship.

## 4. Communication and Distributed-System Concepts

RelayLab uses two request-response styles. The browser exchanges REST-shaped
JSON resources with the coordinator. The coordinator calls the private
downstream endpoint with JSON-RPC 2.0 method `relaylab.process.v1`, a UUID
correlation ID, and method parameters. It waits only for the configured
deadline and accepts a response only when its ID and method-result schema
match. The response must contain a result or an error, never both, as required by the JSON-RPC specification (JSON-RPC Working Group, 2013). A successful result must also name the requested experiment: correlation alone cannot establish correctness. The service implements this application's single-request subset; it does not claim support for every JSON-RPC feature, such as batches and notifications.

The downstream can return a valid RPC result, application error `-32001`, a
deliberately late result, or a result with the wrong schema. RPC application
errors use HTTP 200, so the interface separates successful HTTP transport from
method failure. The coordinator maps observations to stable outcomes:
`success`, `downstream_error`, `timeout`, `invalid_response`, or `unreachable`.
This distinguishes an application error, a deadline failure, a contract failure,
and a transport failure. The coordinator remains
available and persists the attempt instead of crashing. A timeout means the coordinator does not know whether the remote work completed. It is not itself an at-least-once delivery guarantee, nor proof that the dependency stopped.

Each browser Run click starts a new experiment execution with a new UUID. API callers can retry an uncertain operation with the same `Idempotency-Key`. The coordinator replays a settled stored result without another call. Following a timeout or unreachable outcome, it calls again; the downstream reuses a completed or in-flight promise for the same experiment/key pair. Different experiments remain isolated even if callers reuse a key. The recorded trace shows a timeout at 406 ms, the dependency completing later, and a same-key retry returning that result in 17 ms. These are observations from one demonstration, not performance guarantees.

Executions and recorded attempts differ: a timeout and later success may create two history rows for one downstream execution. Concurrent retries can also create multiple attempt rows. This is bounded deduplication, not durable exactly-once processing: the downstream cache is lost on restart.

Zod schemas reject unsupported behaviours, blank or oversized names, and
payloads that are not JSON objects. Missing or malformed experiment identifiers produce a
controlled 404. Persistence exceptions produce a generic 503 without leaking
database details. The MySQL path uses parameterised statements and a
non-configurable pool limit of five connections. Each MySQL insert and its
read-back share one transaction, so a failed write rolls back rather than
leaving a row the client was told was not saved.

## 5. Data Design or Message Design

`experiments` and `experiment_runs` form a one-to-many relationship. An experiment stores its name, selected behaviour,
JSON payload, and creation time. A run stores the experiment foreign key,
classified outcome, optional HTTP status, the dependency's JSON-RPC error code
when its method failed, duration, full RPC evidence, and creation time. Its own column
means failures can be counted in SQL, not only read from the envelope. Foreign-key enforcement prevents orphan run records, while
`ON DELETE CASCADE` gives the experiment ownership of its runs: deleting one
removes its history and leaves no orphans.

A run's nullable fields express what was actually observed: no HTTP status means no response was received; a missing RPC error code does not invent a method failure. Duration measures the coordinator's waiting time, not remote execution time. UTC timestamps support comparison, but wall-clock timestamps alone do not establish causal ordering; the request ID provides the causal link.

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

The verification command is `npm ci && npm run verify`. The suite contains 71
tests: eight client, fifty-three coordinator, RPC-contract, database and logging,
and ten downstream-service tests, plus a live lecturer-MySQL test that runs
only when its credentials are present. They cover the browser workflow, every
run outcome, validation, correlation, persistence, the pool limit, a failed
write that must not invent evidence, a killed dependency process, one request
traced across both logs, the shipped queries, idempotent replay, and twenty
concurrent runs. The included GitHub Actions workflow defines separate local-gate and MySQL 8.4 service jobs; its existence alone is not evidence that the current revision passed remote CI.

The gate also runs type checks and builds, then starts the built application,
executes an experiment, restarts both services and checks that the saved definition and run survived. The 20 September final package is verified from a fresh extraction, not just the development checkout. The production dependency audit reports zero known vulnerabilities; development dependencies are a separate audit scope. The video
shows the two services starting, a successful exchange, an RPC application
error, a deadline timeout, invalid-JSON rejection, an outage and restart
persistence, using lecturer-MySQL footage from 18 September and the retry trace from 19 September,
together with both services' logs for one exchange, the API's own rejection of
an invalid request, and commit dates on the GitHub website. A dated verification addendum distinguishes the 20 September revision from that earlier recording.

Three additional public-HTTP regression cases first failed against the prior revision, then passed after repair: reuse of a key across two experiments, a correlated reply naming the wrong experiment, and a reply containing both result and error. The latter two must persist as `invalid_response`, not false successes. Existing replay and timeout tests remain part of the gate, checking that the repairs preserve valid behaviour.

Live MySQL checks used verified TLS: the transactional write path and
`db:inspect` were rechecked on the assigned schema on 17 and 18 September. The 20 September credential-free run skips live MySQL; these earlier checks remain historical evidence.

Lab work was submitted on 10 September, with Canvas receipts for Weeks 2–6;
Appendix A maps those concepts to this project.

## 7. Limitations and Possible Improvements

The downstream behaviours are simulations rather than measurements of
arbitrary external services. The coordinator intentionally has no automatic retries,
circuit breaker, queue, authentication, editing, or production
monitoring. The Fly deployment configuration uses a single SQLite instance and is not
designed for concurrent production traffic. Twenty concurrent SQLite requests are tested, but distributed load, MySQL concurrency, and network partitions are not established by that test. The downstream cache has no eviction and is process-local; it suits a short assessment session, not a long-running production service.

The highest-value extension is a bounded, durable idempotency store with atomic result recording. That would address restart ambiguity before adding automatic retries, which could otherwise duplicate side effects. Authentication and resource limits would be required before exposing the service to untrusted callers.

## 8. Running Instructions

Install Node.js 24.15 or later. From the project root run `npm ci`, then
`npm run dev`, and open `http://localhost:5173`; ports 5173, 3000 and 3001 host
the three processes. After `npm run build`, `npm run start:downstream` and `npm run start:coordinator` run the services separately, and `npm run db:inspect` prints the stored rows. Run `npm run verify` for the
test, type-check, build, restart-persistence, and audit gate. The README lists
the ignored MySQL values and verified-TLS startup command; real credentials must never be committed or displayed.

## References

JSON-RPC Working Group. (2013). *JSON-RPC 2.0 Specification*. https://www.jsonrpc.org/specification

Auckland University of Technology. (2026). *COMP713 Individual Project* [Canvas assignment]. https://canvas.aut.ac.nz/courses/23558/assignments/193419

Implementation, explanations and verification material include AI-generated content (OpenAI, 2026; Anthropic, 2026).

OpenAI. (2026). Codex [AI coding assistant]. https://openai.com/codex/

Anthropic. (2026). Claude Code [AI coding assistant]. https://claude.com/claude-code
