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

## 2026-07-28 - Interface-default audit

- Audited the live interface against the recurring model-generated patterns
  documented by Default Index.
- Removed the centered marketing opener, generic dark tech gradient, floating
  rounded workbench, capsule status, decorative monospace labels, repeated
  eyebrow headings, glow effects, and broad corner rounding.
- Reframed the product as an editorial lab instrument: the request controls,
  three-process trace, observed outcome, and SQLite history now form one
  continuous ruled surface.
- Kept monospace only where the content is genuinely machine-readable, such as
  JSON, timings, and experiment identifiers.
- Preserved the one-action workflow, accessible pressed states, visible focus,
  mobile layout, and reduced-motion behavior.
- Verification: fifteen public HTTP tests, every workspace type check, every
  production build, and a source-level default-pattern scan pass.

## 2026-07-28 - First-principles interaction reduction

- Restated the common task as one loop: choose a dependency response, run one
  request, and understand what crossed each boundary.
- Removed the separate introduction, two-column control panel, always-visible
  history, duplicate section headings, status label, node badges, and large
  empty result area.
- Kept the four dependency conditions together as a directly comparable
  choice, with the selected explanation and run action immediately below.
- Made the request trace diagnostic: success completes the path in green,
  timeout marks the coordinator deadline, and response or connection failures
  mark the dependency boundary.
- Moved request JSON and past experiments behind disclosures so evidence stays
  available without competing with the common path.
- Verification: fifteen HTTP tests, all workspace type checks and builds, local
  health checks for all three processes, and a successful create-run smoke.

## 2026-07-28 - Purpose-neutral assessment UI

- Removed the remaining authored art direction after it made the demonstration
  feel like a design showcase rather than a distributed-systems exercise.
- Replaced the custom four-option strip with a native select and conventional
  Run button.
- Reduced the heading, spacing, palette, motion, and result typography to
  ordinary application defaults.
- Kept color only for the primary action and semantic success, warning, and
  failure states.
- Replaced the animated route with a compact static request-path readout while
  retaining boundary-level outcome evidence.
- Verification: fifteen HTTP tests, all workspace type checks, and all
  production builds pass.

## 2026-08-11 - Lecturer database readiness

- Reconciled the project with the lecturer's database-server announcement and
  requested Maxwell's private schema credentials by direct email.
- Preserved SQLite as the deterministic local/test lane and added an opt-in
  MySQL persistence adapter for the lecturer-assigned schema.
- Kept every credential in local environment configuration and hard-limited
  the MySQL pool to five connections with a non-configurable application
  constant and regression test.
- Kept the same `experiments` to `experiment_runs` relationship, parameterised
  queries, API contract, and controlled persistence failure response across
  both database lanes.
- Updated the interface language so it describes the configured relational
  database rather than claiming every run uses SQLite.
- Verification: eighteen HTTP/configuration tests pass, all workspace type
  checks and production builds pass, and the production dependency audit has
  no findings. A built production smoke created, ran, and reread one healthy
  experiment across both HTTP boundaries and persistent storage.
- Browser verification: desktop and 390 px layouts rendered without console
  warnings or errors; an unavailable dependency produced and persisted a `503`
  outcome, and saved-history navigation reopened an older successful run.
- Remaining gate: run the same database workflow against the lecturer MySQL
  schema after the private credentials arrive. No credentials were stored, and
  no push, deployment, or Canvas submission was performed.

## 2026-08-11 - Reproducible submission evidence

- Added three jsdom client tests for the complete create/run/render path, local
  JSON rejection before persistence, and reopening a saved run after initial
  load. The repository now has 21 automated tests across the client,
  coordinator, and downstream service.
- Added `npm run smoke`, which starts the built production services against a
  temporary SQLite database, creates and runs an experiment, restarts the
  application, and proves the saved experiment and run survive the restart.
- Added `npm run verify` as the reproducible local gate: all tests, all
  typechecks, all production builds, the restart smoke, and the production
  dependency audit.
- Added `docs/DEMONSTRATION_RUNBOOK.md` with a recording route and
  claim-to-implementation/test/video evidence matrix. It is explicitly a
  checklist, not a claim that a video was recorded or submitted.
- The added test tooling initially exposed a high-severity development-only
  `nanoid` advisory. The lockfile was updated and both full and production-only
  dependency audits now report zero vulnerabilities.
- Re-ran desktop browser QA at `http://localhost:5173`: page identity and DOM
  were correct, the unavailable dependency produced and persisted HTTP 503,
  the selected history count increased from one to two, a saved healthy run
  reopened as HTTP 200, and the warning/error console remained empty.
- A live read-only Canvas brief refresh redirected to AUT Login, so rubric
  reconciliation remains an authentication gate. Lecturer MySQL credentials,
  push, deployment, video recording, and Canvas submission remain unperformed.

## 2026-08-11 - Vercel visual-QA preview

- Added a Vercel configuration that installs from the lockfile with `npm ci`
  and builds only the React client from the workspace root.
- Kept the topology explicit: Vercel hosts the visual client while the existing
  Fly deployment continues to run the coordinator, downstream service, and
  relational persistence lane.
- Stored the non-secret public coordinator URL as the Vercel project's preview
  and production `VITE_API_BASE_URL`, so Git-connected rebuilds do not silently
  fall back to same-origin API requests.
- Verified the immutable preview at desktop and 390 by 844 viewports: no blank
  page, framework overlay, horizontal overflow, or console warnings/errors.
  A malformed response produced `invalid_response`, HTTP 200, and durable
  history through the remote coordinator.

## 2026-08-11 - Rubric-aligned submission package

- Reconciled the repository with the supplied full Canvas instructions: three
  required artifacts, the 1,500-word report limit, exact report headings,
  startup/failure/state-change video evidence, and GitHub website timestamps.
- Restructured the technical report around those headings and added an honest
  status table. The conservative source count is 1,140 words before the lab
  appendix.
- Added a lab-to-project concept map. Fresh runs of the generated Lifecycle
  Lab+ and Data Client Lab+ references passed 9 and 10 tests respectively; the
  document does not claim those references are Canvas submissions.
- Added a deterministic report builder using the formal document style tokens,
  fixed-width tables, a communication diagram, and repeatable metadata
  scrubbing. The final DOCX and PDF passed visual inspection across all eight
  rendered pages.
- Pushed the existing six local milestones so the remote `main` branch now
  matches commit `e5056bf`. The next source commit will preserve this report and
  evidence work as its own meaningful milestone.
- Remaining gates are lecturer MySQL credentials and a live database run, final
  spoken video capture, exact archive review, and explicit Canvas submission
  approval.
