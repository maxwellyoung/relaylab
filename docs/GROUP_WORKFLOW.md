# Provisional group workflow

This local extension starts from the submitted RelayLab baseline, application
commit `360b4db` and checkout `b410394` (the latter changes only `.gitignore`).
It does not establish team agreement, teammate ownership, Android completion,
or three weeks of Assessment 3 development. The gRPC execution lane is now
implemented and verified locally; [runner notes](GRPC_RUNNER.md) describe its
scope and recovery limits.

## Run and exercise the handoff

Use the existing lockfile and Node prerequisites from the root README:

```bash
npm ci
npm run build
npm run start:group
```

Open http://localhost:3000 in two tabs. Choose **Researcher A** in the first and
**Reviewer** in the second. In the researcher tab:

1. Run an experiment through the existing coordinator/downstream path.
2. Submit the selected run for review; its review status starts as pending.
3. In the reviewer tab, refresh the queue, inspect the run evidence, enter
   feedback, then approve or reject it.
4. Refresh the researcher's reviews to see the decision and feedback.

Researcher B sees only their own review submissions. The original experiment
lab remains shared and unauthenticated: a researcher may submit any unclaimed
run from that shared lab. This prototype does not prove per-user experiment or
execution ownership. That contract must be agreed before real accounts are added.

Failed execution can be approved as useful experimental evidence. Approval
does not change `run.outcome`. Rejection asks for a new run; decided reviews
cannot be edited or resubmitted. Submitted runs and their containing experiment
cannot be deleted. Unsubmitted experiments retain the original delete behaviour.

## Shared HTTP contract

The authoritative machine-readable contract is [openapi.json](openapi.json),
version 1.2.0. Original experiment/run response fields remain compatible;
gRPC receipts have null `httpStatus` and protocol-labelled evidence in `response`.

| Method | Endpoint | Operation |
| --- | --- | --- |
| POST | `/api/demo-sessions` | Body `{ "actorId": "researcher-a" }`, `researcher-b`, or `reviewer`; returns token and actor. |
| DELETE | `/api/demo-sessions/current` | Revoke the current demo token. |
| GET | `/api/reviews` | Researcher's own submissions or reviewer's full list; pending first, newest first within status group. |
| POST | `/api/runs/{runId}/reviews` | Researcher submits an existing run exactly once; returns 201 and Location. |
| GET | `/api/reviews/{reviewId}` | Read one visible review with its execution evidence. |
| PATCH | `/api/reviews/{reviewId}` | Reviewer sends `{ "status": "approved", "feedback": "Evidence verified" }`, or `rejected`. |
| GET | `/api/runs/{runId}/execution` | Read live runner execution over gRPC, without changing the persisted attempt. |

Review/session operations use `Authorization: Bearer <token>`. Identity is
resolved by the server, not accepted from review request bodies. Feedback is
trimmed, required and limited to 2,000 characters. Errors use the existing
`{ "error": "message" }` shape: 400 invalid input, 401 invalid/expired session,
403 wrong role or disabled demo, 404 absent/invisible resource, 409 duplicate,
already-decided or protected evidence, 429 too many demo sessions, 503 storage
failure. Clients refresh after an uncertain/stale result rather than overwrite it.

Demo tokens are tab-local in the UI, expire after one hour, and disappear when
the coordinator restarts. Reviews persist across restarts. Selecting another
identity revokes the prior tab's token and clears its review rows and draft
feedback. Account selection is deliberately open to anyone; this is a local
workflow model, not password authentication. Enable it only for local use;
the coordinator binds to `127.0.0.1` in this mode. Deployment defaults keep it off.

## Persistence and concurrency

The coordinator owns `experiments`, immutable `experiment_runs` receipts, and
`run_reviews`. The runner owns `executions` in a separate database. There is no
cross-service SQL or foreign key; runner execution IDs and snapshots are opaque
evidence in coordinator receipts. Startup creates the new table without resetting baseline rows in
either schema. A unique run ID prevents duplicate submissions. Decisions use
an atomic update conditioned on `status = 'pending'`; only one competing
reviewer request can succeed. Write/read-back pairs run in transactions.
Foreign-key RESTRICT preserves submitted evidence during deletion races.

Both SQLite and MySQL adapter code are maintained. SQLite is the verified
local persistence lane; mocked MySQL transaction tests do not establish a
successful live MySQL connection.

## Verification

```bash
npm test
npm run typecheck
npm run build
npm run smoke
npm run smoke:reviews
npm run smoke:grpc
```

The review smoke uses built code, real loopback HTTP and the actual JSON-RPC
downstream, a disposable SQLite database, two demo identities, a persisted
decision and a coordinator restart. Its review-refresh acceptance target is
500 ms: a local interactive refresh should complete within half a second.
It records 20 sequential warm requests with one review, p95 and maximum.
This is a reproducible small local check, not an Android, network-load or
production performance claim. Logs and browser evidence for 8 October live in
the ignored `outputs/group-review-2026-10-08/` directory.

## Remaining team work

- Agree the baseline, real account/ownership requirements and each member's
  technical responsibility. Record genuine contributions and AI-assisted
  changes accurately; individual investigation/reflection remains personal work.
- Build the native Android reviewer and event-driven notification capability.
- Integrate the verified gRPC lane with the team's agreed workflow and Android.
  The original JSON-RPC simulator remains available for baseline regression;
  the group launcher uses the runner-owned execution ledger.
- Validate the agreed larger dataset, concurrent clients and actual Android
  response-time requirement; retain two genuine dated working checkpoints.
- The inherited `proxy-addr` advisory was cleared with its compatible patch
  update during the gRPC milestone. The production dependency audit passes;
  development-tool advisories remain outside that production audit.
- Team reports/demo, independent individual reports, public repository
  publication and final submission remain separate work and approval gates.

WebSocket bonus work remains optional. No team message, remote push,
deployment, publication or assessment submission is performed by this slice.
