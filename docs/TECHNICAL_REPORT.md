# RelayLab technical report

**Student:** Maxwell Young

**Student ID:** 23213801

**Course:** COMP713 Distributed and Mobile Systems

**Assessment:** Assessment 2 - Individual Project, Option A

**Implementation status date:** 15 September 2026

## 1. Project Introduction and Requirements

RelayLab is a small distributed web application for observing what happens when
one service depends on another. A user selects a deterministic dependency
behaviour and supplies a JSON request payload. A coordinator service sends the
request to a separately running downstream service using JSON-RPC 2.0,
classifies the result, and stores the evidence. The saved evidence includes the
outcome, optional HTTP status, elapsed time, RPC envelope, and timestamp.

The intended user is a student or developer who wants a repeatable way to
compare a healthy exchange with a timeout, an unavailable dependency, a
malformed response, or an unreachable service. The selected assignment route is
Option A. Its functional requirements are to provide one usable client, a
server-side API, at least three meaningful operations, persistent related data,
input validation, controlled errors, and reproducible run and test instructions.

RelayLab implements a create/read/execute workflow rather than edit and delete
operations. A user can create an experiment, list saved experiments, read one
experiment with its history, and execute it repeatedly. This keeps the scope
small while still producing a complete workflow whose state changes can be
demonstrated.

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
credential-free development and automated testing, or the lecturer-provided
MySQL schema when explicitly configured. Vitest, Testing Library, and
Supertest provide automated tests.

The browser communicates only with the coordinator. It never accesses the
database or downstream service directly. The coordinator owns validation,
persistence, request timing, the 400 ms deadline, response-contract checking,
correlation-ID checking, and outcome classification. The downstream service exposes deterministic
behaviours so both success and failure demonstrations remain repeatable without
depending on a third-party network.

## 3. Implemented Functionality

| Significant function | Status | Evidence |
| --- | --- | --- |
| Create and validate a saved experiment | Completed and tested | API and client tests cover valid creation and invalid JSON/input |
| List saved experiments | Completed and tested | API tests and client saved-history view |
| Read one experiment and its runs | Completed and tested | API tests, client reopening test, and restart smoke |
| Execute a versioned downstream RPC method | Completed and tested locally | Healthy result, RPC error, timeout, malformed result, and unreachable tests |
| Persist experiments and one-to-many run history | Completed and tested | SQLite smoke and live lecturer-MySQL restart check |
| Use lecturer MySQL with a five-connection maximum | Completed and live-tested for demonstrated workflows | Verified TLS, save/run/reopen and restart on the assigned lecturer schema |
| Hosted RPC demonstration | Pending redeployment | Not reverified in this check; local build is the assessed preparation lane |

The public coordinator API has four operations: `POST /api/experiments`,
`GET /api/experiments`, `GET /api/experiments/:id`, and
`POST /api/experiments/:id/runs`. Every execution produces a new durable run
record, including controlled failures.

## 4. Communication and Distributed-System Concepts

RelayLab uses two request-response styles. The browser exchanges REST-shaped
JSON resources with the coordinator. The coordinator calls the private
downstream endpoint with JSON-RPC 2.0 method `relaylab.process.v1`, a UUID
correlation ID, and method parameters. It waits only for the configured
deadline and accepts a response only when its ID and method-result schema
match. This makes presentation, orchestration, service communication, and
persistence separate and visible.

The downstream can return a valid RPC result, application error `-32001`, a
deliberately late result, or a result with the wrong schema. RPC application
errors use HTTP 200, so the interface separates successful HTTP transport from
method failure. The coordinator maps observations to stable outcomes:
`success`, `downstream_error`, `timeout`, `invalid_response`, or `unreachable`.
This distinguishes an application-level error response, a deadline failure, a
contract failure, and a transport connection failure. The coordinator remains
available and persists the attempt instead of crashing.

Zod schemas reject unsupported behaviours, blank or oversized names, and
payloads that are not JSON objects. Missing experiment identifiers produce a
controlled 404. Persistence exceptions produce a generic 503 without leaking
database details. The MySQL path uses parameterised statements and a
non-configurable pool limit of five connections.

## 5. Data Design or Message Design

The relational model contains `experiments` and `experiment_runs` in a
one-to-many relationship. An experiment stores its name, selected behaviour,
JSON payload, and creation time. A run stores the experiment foreign key,
classified outcome, optional HTTP status, duration, full RPC evidence, and
creation time. Foreign-key enforcement prevents orphan run records, while
`ON DELETE CASCADE` defines ownership even though deletion is not exposed by
the current API.

SQLite and MySQL implement the same application-facing repository contract.
SQLite makes local inspection and isolated tests deterministic. MySQL supports
the lecturer-provided schema without changing the client or coordinator API.
Credentials are read only from ignored environment configuration and never
appear in source, documentation, logs, screenshots, or submitted artifacts.

## 6. Testing and Evidence

The complete verification command is `npm ci && npm run verify`. The current
suite contains 35 automated tests: five client tests, twenty-three coordinator,
RPC-contract, and database-configuration tests, and seven downstream-service
tests. These cover
the create/run/render workflow, invalid client JSON, saved-history reopening,
all five run outcomes, versioned methods, standard RPC errors, mismatched
correlation IDs, relational persistence, missing records, MySQL configuration,
and the fixed connection-pool limit. The 9 September checks also prove that
malformed HTTP JSON returns 400 and that a failed database write cannot invent
an unreachable-downstream result.

The verification gate also runs all TypeScript checks and production builds,
starts the built application, creates and executes an experiment, restarts the
services, and proves that the experiment and run survived. On 15 September all 35 tests, type checks, builds, restart-persistence smoke and the production dependency audit passed again, with no known production vulnerabilities reported. Earlier browser verification on the built local application separately checked the healthy workflow, an RPC application error, the deadline timeout, and invalid-JSON rejection. The video preparation includes startup, success, the RPC error envelope, restart persistence and GitHub website dates. New lecturer-MySQL footage shows the operational workflows; its replacement narration is pending. September changes were committed and pushed on 17 September. Hosted deployment was not reverified and is not required for the local Option A workflow.

A separate live MySQL check used verified TLS and confirmed four experiments and five related runs by direct SQL after restart, covering success, RPC error, timeout and malformed response. Additional browser captures reran the workflows. A discovered selection/loading race was fixed by disabling controls during requests, with a regression test preventing execution of the previous selection.

Relevant lab work was submitted on 10 September: Weeks 2–6 have personal Canvas receipts. Appendix A maps the lab concepts to this project and distinguishes those submissions from the prepared Week 7 exercise. Submission timestamps establish hand-in, not a history of weekly attendance or independent mastery.

## 7. Limitations and Possible Improvements

The downstream behaviours are simulations rather than measurements of
arbitrary external services. The coordinator intentionally has no retries,
circuit breaker, queue, authentication, edit/delete operations, or production
monitoring. The hosted SQLite demonstration uses one instance and is not
designed for concurrent production traffic. The lecturer MySQL adapter passed the demonstrated workflows and restart checks; concurrent-load testing remains outside the verification scope.

Future work could add configurable timeout policies, outcome aggregation, and
carefully bounded retry or circuit-breaker experiments. These are extensions,
not missing parts of the submitted workflow.

## 8. Running Instructions

Install Node.js 24 or later. From the project root run `npm ci`, then
`npm run dev`, and open `http://localhost:5173`. Ports 5173, 3000, and 3001 host
the client, coordinator, and downstream service. Run `npm run verify` for the
test, type-check, build, restart-persistence, and audit gate. The README lists
the ignored MySQL values and verified-TLS startup command; real credentials must never be committed or displayed.

## Sources

Course requirements: COMP713 Individual Project, checked live on 15 September 2026. https://canvas.aut.ac.nz/courses/23558/assignments/193419

Implementation, explanations and verification material include AI-generated content (OpenAI, 2026; Anthropic, 2026).

OpenAI. (2026). Codex [AI coding assistant]. https://openai.com/codex/

Anthropic. (2026). Claude Code [AI coding assistant]. https://claude.com/claude-code
