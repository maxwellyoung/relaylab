# Local gRPC runner

The group lane separates **experiment and review coordination** from **durable
execution**. It retains the original JSON-RPC lane for baseline checks.

```text
Web client / future Android reviewer
                 | HTTP/JSON
         Coordinator API
          |             |
          |             +-- coordinator/relaylab.sqlite
          |                 experiments, immutable attempt receipts, reviews
          |
          | gRPC: ExecuteRun / GetExecution, explicit deadline
          v
         Runner
          |
          +-- runner/runner.sqlite
              execution requests, operation identity, state and result
```

Each application reads/writes only its own database. `experiment_ref` is an
opaque string, not a foreign key. The coordinator keeps a snapshot of what it
observed on each call; it does not own or mutate the runner execution. Review
foreign keys reference coordinator receipts only, so reviews preserve the
observed attempt even if the runner later finishes a timed-out execution.

## Start and inspect

```bash
npm ci
npm run build
npm run start:group
```

Open http://localhost:3000 in two tabs for researcher/reviewer. The launcher
binds both services to loopback, uses SQLite, and stores data under
`data/group/coordinator/` and `data/group/runner/`. `PORT`, `RUNNER_PORT` and
`RELAYLAB_GROUP_DATA_DIR` override these local settings. It waits for runner
readiness before launching the coordinator. Losing the runner afterwards
leaves the coordinator serving failure receipts; losing the coordinator stops
the supervised runner. It does not restart an existing process automatically.

For independent terminals:

```bash
RUNNER_DATA_DIR=/absolute/path/to/runner-data npm run start:runner
RELAYLAB_REVIEW_DEMO=true RELAYLAB_RUNNER_TARGET=127.0.0.1:50051 npm run start:coordinator
```

The coordinator uses `RELAYLAB_RUNNER_NAMESPACE` (default `relaylab`) to scope
operation and experiment references. Keep it stable across restarts and use a
distinct namespace for another coordinator. Unset `RELAYLAB_RUNNER_TARGET` to
retain JSON-RPC behaviour. No credentials or local databases are packaged.

## Contract and responsibilities

[`protocol/runner.proto`](../protocol/runner.proto) defines two unary methods:

- **ExecuteRun:** validated experiment reference, behavior and JSON payload,
  stable operation ID and correlation UUID. Persists an execution before work
  begins, then returns the runner-owned result. Known behavior values are
  `healthy`, `slow`, `unavailable` (simulated dependency failure), and `malformed`
  (contract-test result). Payloads must be JSON objects within 64 KB UTF-8.
- **GetExecution:** reads the execution by operation ID, including RUNNING,
  COMPLETED or INTERRUPTED. The coordinator's HTTP
  `GET /api/runs/{runId}/execution` resolves its receipt's operation reference
  and calls this method; it never opens the runner database.

The Node implementation uses the official runtime-loaded protobuf descriptor
approach: [Node gRPC guide](https://grpc.io/docs/languages/node/basics/).
Types describe that shared descriptor without another code-generation build
step. JSON payload/result fields keep the experiment's arbitrary object data
inside an otherwise explicit request/execution contract.

The coordinator validates execution UUID, operation/experiment identity,
state, accepted-result shape and echoed payload before calling an attempt a
success. Correlation IDs link coordinator and runner logs without logging
payloads or session tokens. Existing public run fields remain compatible;
gRPC evidence explicitly names its transport and status, and has no HTTP
downstream status. The browser uses the configured transport for its trace.

## Deadlines, failures and restart recovery

All calls have the coordinator's configured `DOWNSTREAM_TIMEOUT_MS` budget
(default 400 ms). [gRPC deadline guidance](https://grpc.io/docs/guides/deadlines/)
defines the caller's wait bound; this runner deliberately treats a persisted
execution as a job whose lifetime is independent of the waiting RPC.

| Case | Coordinator receipt / behaviour |
| --- | --- |
| Valid completed execution | `success`, gRPC status 0 |
| Simulated execution dependency failure | `downstream_error`, gRPC status 0; business failure differs from transport failure |
| Wrong operation/reference or invalid result | `invalid_response`; evidence preserved |
| Deadline exceeded | `timeout`, gRPC status 4; accepted job may still finish |
| Runner unavailable | `unreachable`, gRPC status 14; API/reviews remain usable |
| Interrupted operation after restart | gRPC ABORTED 10; no silent repeat under that operation ID |

After a timeout, **Check runner execution** retrieves live status without
rewriting the timed-out receipt. An API retry with the same idempotency key
reuses the same durable execution and produces a new coordinator observation.
A settled coordinator receipt is replayed without another execution call.
The browser's **Run again** intentionally creates a new operation; it is not
the same-key retry demonstrated by API tests and the smoke check.

The runner fingerprints canonical request content. Same-key concurrent calls
share accepted work; completed results replay across restarts. Reusing an
operation ID for different content returns ALREADY_EXISTS 6. Graceful shutdown
finishes accepted jobs. After abrupt exit, prior RUNNING rows become INTERRUPTED:
the result is uncertain, and using a new operation is an explicit decision.
This is not a general exactly-once guarantee for external side effects.

A file lease guards ledger ownership before recovery updates run. A second
live owner is refused; a lease is reclaimed only when its recorded process no
longer exists. Corrupt or ambiguous leases require inspection. There is no
cross-process takeover or process kill in application startup.

The current transport is insecure gRPC on loopback, with selectable demo
identities on the web side. Real authentication, protected inter-host
transport, multiple runner replicas and real external execution are not
implemented. Do not present this local setup as production deployment.

## Reproducible verification

```bash
npm run verify
```

The gate runs all workspace tests/types/builds, baseline and review smoke
checks, `smoke:grpc` and the production dependency audit. The gRPC smoke uses
two built independent processes, separate disposable databases, a review
handoff, a deadline and same-key retry, a stopped/restarted runner, and caller
recovery. The runner suite additionally kills an owned disposable runner
process abruptly and verifies interrupted-state recovery and refusal to
re-execute. The MySQL live test remains credential-dependent.

Evidence is in the ignored `outputs/grpc-runner-2026-10-08/` directory. Native
Android, notifications, team ownership, genuine three-week history, reports,
publication and submission remain separate work/gates.
