# Live review updates (.NET group lane)

The browser receives WebSocket invalidations when another role submits or
decides a review. It reloads its actor-scoped HTTP list without a manual
refresh or a review-polling timer. The existing Refresh action remains usable
when the live transport fails. Native Android continues to use the unchanged
HTTP contract and its existing polling/notification worker.

Run the normal `npm ci`, `npm run build:group`, `npm run start:group` lane.
Use separate browser contexts as Researcher A and Reviewer. Wait for **Live
updates connected**, submit a run, and watch the reviewer's queue change.
Save a decision and watch the researcher's receipt receive its feedback.
The optional Node coordinator and the historical individual baseline do not
implement this WebSocket extension; their HTTP/Refresh lane is retained.

## Contract and access boundaries

- Endpoint: `GET /api/reviews/live`, upgraded to WebSocket. An ordinary HTTP
  request receives 426. Same-origin browser connections and the existing local
  Vite development origins are accepted; other browser origins receive 403.
- The first complete text frame must be
  `{"type":"subscribe","token":"<current demo-session token>"}` within 5 seconds,
  fitting 512 bytes. Tokens are not put in a URL, persisted or logged.
- No subscription or outbound event exists before session validation. Invalid
  authentication closes with 1008. Selectable demo roles remain a local
  demonstration, not password authentication or production authorization.
- A valid subscription receives `{"type":"ready"}`. Subsequent relevant
  changes receive only `{"type":"reviews-changed"}`: no run ID, actor ID,
  count, payload or feedback is broadcast. Reviewers receive review changes;
  researchers receive only changes to their own submitted reviews. The normal
  authenticated HTTP API independently enforces every data read.
- Every outbound frame rechecks session validity. Revocation wakes the sender
  to close the old connection; expiry is also checked on the 15-second
  heartbeat. The heartbeat carries only `{"type":"heartbeat"}`.
- Notifications publish after a successful persisted submit/decision. Failed
  validation, stale decisions and failed writes do not emit success events.
  The database-side single-winner decision remains authoritative.
- There are at most 128 active subscriptions, each with one coalesced queued
  invalidation. Slow readers do not accumulate an unbounded change history.

## Disconnect, missed changes and UI continuity

The server registers the subscription before `ready`. On every `ready`, the
browser retrieves the current HTTP snapshot, so reconnect repairs missed
changes instead of relying on a replay cursor or treating an event as data.
An invalidation arriving during a read or local write schedules another
snapshot; obsolete session callbacks cannot overwrite a newly selected role.

The client retries failed live connections with 1, 2, 4, ... 30-second backoff.
Online/offline events pause/restart connection attempts. A 40-second watchdog
detects a silent transport against the 15-second server heartbeat. The browser
shows the actual connection state, preserves its review draft and selected
receipt during background updates, and retains explicit Refresh. A whole
browser network outage requires a successful HTTP resync before deciding.
WebSocket-only failure does not disable otherwise working HTTP decisions.
Existing HTTP validation and409 conflict recovery remain in force.

The stream is an in-process notification channel for writes through this
coordinator. Multi-instance fan-out, external database writers, production
identity/TLS deployment and a durable event broker are outside this scope.
Coordinator restart invalidates in-memory demo sessions; choose a role again
to read persistent reviews. A notification is not a durable business receipt.

## Verification and response-time method

`npm run test:browser` runs real .NET/EF SQLite and Node gRPC services on fresh
ports/stores, with no retries. `tests/browser/live-updates.spec.ts` covers peer
submission/decision propagation, offline missed-change resync, keyboard draft
continuity, live-only failure with HTTP fallback, invalid session/role scope,
revocation and a rejected foreign Origin. The existing browser handoff,
validation, phone and conflict checks remain; a stale HTTP decision must still
return 409 even if the UI already received its winner over WebSocket.

One declared desktop-only response-time case starts with 200 synthetic pending
reviews, performs 2 warmups and 20 timed sequential submissions. It measures from
HTTP submission start to a visible reviewer queue row, including persistence,
invalidation, HTTP snapshot, DOM update and test observation delay. The
engineering target is <=1000 ms on the declared local workload, justified as a
visible peer handoff within one second; team acceptance remains pending. Raw
samples and the environment are written to the test's `live-response-time.json`
attachment. This is not WAN, production, Android or a before/after query
optimization measurement. Execution results must be read from the actual run,
not inferred from this test plan.

Work added 27 October 2026 (NZDT) with assistant implementation/testing support. It is
new work, not historical three-week evidence or a contribution attributed to
Archie or Hansith. Original candidate4553c9d and its packages are preserved.
