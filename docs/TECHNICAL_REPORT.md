# RelayLab technical report

**Student:** Maxwell Young

**Student ID:** 23213801

**Course:** COMP713 Distributed and Mobile Systems

**Assessment:** Assessment 2 - Individual Project, Option A

**Implementation status date:** 11 August 2026

## 1. Project Introduction and Requirements

RelayLab is a small distributed web application for observing what happens when
one service depends on another. A user selects a deterministic dependency
behaviour and supplies a JSON request payload. A coordinator service sends the
request to a separately running downstream service, classifies the result, and
stores the evidence. The saved evidence includes the outcome, optional HTTP
status, elapsed time, response body, and timestamp.

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
        | bounded HTTP request    | parameterised SQL
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
and outcome classification. The downstream service exposes deterministic
behaviours so both success and failure demonstrations remain repeatable without
depending on a third-party network.

## 3. Implemented Functionality

| Significant function | Status | Evidence |
| --- | --- | --- |
| Create and validate a saved experiment | Completed and tested | API and client tests cover valid creation and invalid JSON/input |
| List saved experiments | Completed and tested | API tests and client saved-history view |
| Read one experiment and its runs | Completed and tested | API tests, client reopening test, and restart smoke |
| Execute through the downstream service | Completed and tested | Healthy, 503, timeout, malformed, and unreachable tests |
| Persist experiments and one-to-many run history | Completed and tested | SQLite restart tests and production smoke |
| Use lecturer MySQL with a five-connection maximum | Completed but not live-tested | Configuration and pool tests pass; private credentials are still pending |
| Hosted visual demonstration | Completed and tested | Vercel client communicates with the Fly coordinator at desktop and mobile widths |

The public coordinator API has four operations: `POST /api/experiments`,
`GET /api/experiments`, `GET /api/experiments/:id`, and
`POST /api/experiments/:id/runs`. Every execution produces a new durable run
record, including controlled failures.

## 4. Communication and Distributed-System Concepts

RelayLab demonstrates request-response communication across two HTTP
boundaries. The browser first exchanges JSON with the coordinator. The
coordinator then creates a second request to the downstream process and waits
only for the configured deadline. The system therefore makes the separation
between presentation, coordination, dependency communication, and persistence
visible.

The downstream service can return valid JSON with HTTP 200, structured JSON
with HTTP 503, a deliberately late response, or plain text that violates the
expected contract. The coordinator maps these observations to stable outcomes:
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
classified outcome, optional HTTP status, duration, response evidence, and
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
suite contains 21 automated tests: three client tests, thirteen coordinator and
database-configuration tests, and five downstream-service tests. These cover
the create/run/render workflow, invalid client JSON, saved-history reopening,
all five run outcomes, relational persistence, missing records, MySQL
configuration, and the fixed connection-pool limit.

The verification gate also runs all TypeScript checks and production builds,
starts the built application, creates and executes an experiment, restarts the
services, and proves that the experiment and run survived. The production
dependency audit reports zero known vulnerabilities. Browser checks at 1280 x
720 and 390 x 844 showed no console warnings, errors, or horizontal overflow.
A live 503 exchange was classified and persisted, and an older HTTP 200 run was
reopened from saved history.

Relevant COMP713 lab references were also regenerated and tested on 11 August:
the request-lifecycle reference passed 9 tests, and the web-client/API/
relational-data reference passed 10. Appendix A maps those lab concepts to the
project without claiming that the local references are Canvas lab submissions.

## 7. Limitations and Possible Improvements

The downstream behaviours are simulations rather than measurements of
arbitrary external services. The coordinator intentionally has no retries,
circuit breaker, queue, authentication, edit/delete operations, or production
monitoring. The hosted SQLite demonstration uses one instance and is not
designed for concurrent production traffic. Most importantly, the lecturer
MySQL adapter is implemented and configuration-tested but cannot be described
as live-tested until the private credentials are received.

Future work could add configurable timeout policies, outcome aggregation, and
carefully bounded retry or circuit-breaker experiments. These are extensions,
not missing parts of the submitted workflow.

## 8. Running Instructions

Install Node.js 24 or later. From the project root run `npm install`, then
`npm run dev`, and open `http://localhost:5173`. Ports 5173, 3000, and 3001 host
the client, coordinator, and downstream service. Run `npm run verify` for the
test, type-check, build, restart-persistence, and audit gate. The README lists
the optional ignored MySQL values; real credentials must never be committed or
displayed.
