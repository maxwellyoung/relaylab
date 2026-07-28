# Development log

## 2026-07-28 - Contract and tracer bullet

- Chose COMP713 Option A.
- Defined the two-entity CS2 practice workflow and explicit exclusions.
- RED: the create/list HTTP test failed because the application module did not
  exist.
- GREEN: implemented the smallest Express and SQLite path that records and
  lists sessions.
- RED: a zero-minute session incorrectly returned `201`.
- GREEN: added bounded positive-duration validation and a controlled `400`.
- RED: the drill-result relationship route returned `404`.
- GREEN: added the related `drill_results` table, foreign key, result endpoint,
  and session-detail endpoint.
- RED: eleven successes from ten attempts incorrectly returned `201`.
- GREEN: added cross-field validation and kept the error visible through the
  public API.
- Added explicit coverage for a missing parent session and persistence across
  an application restart.
- Verification: six API behavior tests pass; client and server type checks and
  production builds pass.
- Runtime smoke: Vite served the client, proxied the API, created a session,
  added a related drill result, and retrieved the combined session details.

## 2026-07-28 - Low-friction practice interface

- Reduced session creation to one visible question: the practice focus. Map,
  date, and duration keep sensible defaults behind an optional disclosure.
- The latest session opens automatically, removing a selection step before
  drill evidence can be recorded.
- Kept the assignment-relevant React-to-API-to-SQLite explanation and latest
  HTTP receipt behind a quiet system-details disclosure.
- Added derived accuracy for a selected session without duplicating stored
  data.
- Limited interaction feedback to pressed controls and short disclosure
  transitions, with reduced-motion support.
- Browser check: loaded the ledger, selected a persisted session, confirmed
  default and system-detail disclosures, and found no application console
  errors.
- Verification: six API behavior tests, client and server type checks, and both
  production builds pass.
