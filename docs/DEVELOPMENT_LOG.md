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
