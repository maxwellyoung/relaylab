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

## 2026-07-28 - Evidence-led pivot to RelayLab

- Re-read the current COMP713 brief and rubric after the practice-tracker
  domain produced a weak communication demonstration.
- Kept Option A and preserved the truthful Git history, but changed the domain
  to an API reliability workbench where communication and failure handling are
  the product rather than incidental CRUD.
- RED -> GREEN: the first coordinator test moved from a missing experiment
  route (`404`) to creating and listing a persisted experiment.
- RED -> GREEN: a new independently testable downstream process moved from a
  missing module to a healthy JSON exchange.
- Added deterministic downstream behaviours for healthy, unavailable, slow,
  and malformed responses through separate red-green slices.
- Added durable coordinator outcomes for success, downstream error, timeout,
  invalid response, and unreachable service. Every attempted run is retained
  under its experiment.
- Added controlled invalid-input and missing-resource checks plus restart
  persistence.
- Verification at this checkpoint: nine coordinator HTTP tests and four
  downstream HTTP tests pass; both service type checks pass.

## 2026-07-28 - One-action reliability workbench

- Replaced the practice-tracker interface with one compound workbench rather
  than a collection of dashboard cards.
- A normal run now needs one click: the client creates a saved experiment when
  required, triggers the coordinator, reloads the durable run, and updates the
  evidence list.
- Kept payload editing optional and hid raw response bodies behind a disclosure.
- Added one purposeful in-flight signal along the real browser -> coordinator
  -> dependency path; repeated navigation and list interactions remain
  effectively instant and reduced-motion is supported.
- Live browser verification completed healthy (`200`), timeout (about 400 ms),
  downstream `503`, malformed `200`, invalid local JSON, persisted-history, and
  response-evidence paths with no browser console errors.
- Verification: thirteen public HTTP tests, all workspace type checks, and all
  three production builds pass.

## 2026-07-28 - Reproducible production package

- Added independent coordinator and downstream health checks.
- Added optional static-client serving at the coordinator boundary so the
  hosted browser and API share one public origin.
- Added a two-stage Node container and a production supervisor that starts the
  coordinator and downstream as separate processes.
- Added Fly configuration for one Sydney-region machine and a persistent
  encrypted SQLite volume at `/data`.
- Production smoke: the built React client returned `200`, the coordinator
  health check returned `200`, and a healthy experiment crossed the internal
  downstream boundary and persisted a successful run.
- Verification: fifteen public HTTP tests, all workspace type checks, all
  production builds, and the dependency audit pass.
