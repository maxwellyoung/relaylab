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
  prepared a private credential request. Outlook remained at Microsoft sign-in,
  so no message was sent and no credentials were entered.
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

## 2026-08-11 - Versioned downstream JSON-RPC boundary

- Preserved the browser-facing REST resource API and replaced the private
  coordinator-to-dependency operation with JSON-RPC 2.0 at `POST /rpc`.
- Added the versioned `relaylab.process.v1` method, UUID correlation IDs,
  method-specific parameter/result validation, standard protocol errors, and
  application error `-32001` for the simulated unavailable dependency.
- Persisted the complete RPC result or error envelope so transport status,
  method outcome, correlation evidence, and duration remain inspectable.
- Updated the interface to show HTTP and RPC outcomes separately. This makes
  an HTTP 200 carrying an RPC application error visibly different from a
  timeout, invalid result, or unreachable process.
- Added contract tests for method versioning, matched and mismatched IDs,
  RPC errors, invalid parameters, malformed results, timeout, persistence, and
  the real TCP service boundary. Current total: 28 passing automated tests.
- Built-production browser QA passed at 1280 by 720 and 390 by 844. A healthy
  call showed HTTP 200 plus RPC result; an unavailable call showed HTTP 200
  plus RPC `-32001`, the correlated envelope, durable history, and zero console
  warnings or errors.
- The first video QA pass exposed a presentation-only mismatch: a deliberately
  invalid method result was classified correctly but its RPC badge still read
  `result`. The badge now follows the persisted `invalid_response` outcome and
  a client regression test preserves that distinction.
- Commits `b7f5236`, `83a5c09`, and `e3df3ab` were pushed to `origin/main` after
  explicit approval. Local production-browser evidence and the narrated draft
  were refreshed. The Fly backend redeployment remains gated by user-only CLI
  authentication, so the public alias stays on the last compatible release.

## 2026-08-18 - Browser-facing REST compatibility bench

- Described the four frozen browser resource operations, request/response
  schemas, status codes, and stable error shapes in OpenAPI 3.1 JSON.
- Centralised the coordinator's experiment input and V1 response decoders so
  tests exercise the same public field contract as runtime validation.
- Added three explicit response fixtures: the V1 baseline, an additive optional
  field, and a deliberately breaking rename of required `name`.
- Added a focused contract command that proves the old decoder tolerates the
  optional field, rejects the renamed required field, and checks OpenAPI's
  operation/status surface.
- Kept JSON-RPC, repository code, and relational tables outside the public
  browser contract. The learner still owns the pre-run prediction and
  post-run explanation in Project Studio.

## 2026-08-22 - Report and recording evidence reconciliation

- Added a request sequence diagram that traces experiment creation, one
  downstream JSON-RPC run, controlled failure classification, persistence, and
  reopening durable history across the three processes and relational store.
- Re-ran `npm run verify`: 32 automated tests, all workspace type checks and
  production builds, restart-persistence smoke, and the production dependency
  audit passed.
- Updated the report and demonstration runbook to use the verified test count.
  The final narrated video, lecturer-MySQL live check, and Canvas submission
  remain explicit student-owned gates.

## 2026-09-09 - Input and persistence failure classification

- Reproduced malformed HTTP JSON incorrectly returning 503; a public API
  regression failed before the fix and now verifies a controlled 400 response
  with no accidental experiment creation.
- Reproduced a transient run-write failure being retried as invented
  `unreachable` evidence. Moved persistence outside the downstream error catch;
  the regression now proves one write attempt, 503, and no fabricated run.
- Restored dependencies using the existing lockfile. All 34 tests, workspace
  type checks, production builds, and restart-persistence smoke pass locally.
- No deployment, submission, personal lab-credit claim, or live MySQL check
  was made in this verification.

## 2026-09-10 - Submission preparation and dependency verification

- Updated transitive qs from 6.15.3 to 6.16.0. All 34 tests, type checks, builds and restart smoke pass; production audit reports zero known vulnerabilities.
- Verified healthy, RPC-error, timeout and invalid-JSON paths in the built local app. Created a clearly labelled screenshot walkthrough with synthetic narration. It is preparation material, not the final continuous demonstration.
- Updated the report below the 1500-word limit and reconciled lab evidence with verified Canvas receipts.
- Verified historical commits on the GitHub website. September changes remain local; existing remote checks are not represented as passing. Lecturer MySQL and final video remain open.

- Recorded real startup, healthy RPC, correlated RPC error, and reopening persisted records after stopping/restarting the services. Prepared a 3:09 review video with disclosed synthetic narration and a live GitHub website capture. Full file decoding passed; every section was visually sampled. No submission or remote publication performed.


## 15 September 2026 departure preparation

Re-ran `npm run verify`: all 34 tests, type checks, production builds, restart-persistence smoke and production dependency audit passed. Fixed the report builder to derive its cover status date from the report source instead of a hard-coded August date. Rebuilt DOCX privately from current report and lab appendix; layout remains unverified because the bundled LibreOffice executable is missing. Narration, final video review, repository publication and personal Canvas submission remain separate gates.


## 15 September: lecturer database verification and selection race

Configured the assigned lecturer MySQL database privately. Verified TLS with the official AWS RDS CA bundle, request outcomes and restart persistence through API and direct SQL. Browser recording exposed a race where Run could use the previous experiment during a pending selection request. Controls now stay disabled during loading/running, with a deferred-response regression test. Final video narration and Canvas submission remain separate gates.

## 17 September: publication and packaging

Reinstalled from the lockfile and re-ran `npm run verify`: all 35 tests, type checks, builds, restart-persistence smoke and production audit passed. Committed the 9, 10 and 15 September work as separate logical commits on 17 September, with each message stating when the work was done, and pushed to GitHub. Added `npm run package`, which builds the submission zip from `git archive` so dependencies, `.env`, databases and build output cannot be bundled. Final narration, video review and personal Canvas submission remain separate gates.

## 17 September: report and demonstration finalisation

Finalised the report for submission: 1,294 main-body words (sections 1-8), A4, name and student ID on the cover and every page header. Rebuilt the demonstration picture cut from the 15 September lecturer-MySQL recording with corrected on-screen claims and name and student ID throughout. The voiceover, final video review and personal Canvas submission remain.

## 17 September: database atomicity and submission sweep

MySQL inserts and their read-backs now share one transaction on one pooled connection and roll back together, so a 503 cannot hide a saved row. Sessions run in UTC and idle connections use TCP keep-alive. The schema moved to `database/schema.sqlite.sql` and `database/schema.mysql.sql`, with a SQLite index on run history. Malformed experiment identifiers return 404 before any query. A timing test that failed under machine load now allows a realistic margin. The lecturer server was confirmed as MySQL 8.4 on InnoDB, already in UTC, shared by the class with 60 connections in total. The transactional path was rechecked live against the assigned schema: create, two runs, coordinator restart and reopen. The report word-limit note was restored to 1,500 words, matching the captured Canvas instructions. All 45 tests, type checks, builds, restart smoke and the production audit pass.

## 18 September: demonstration assembled

Assembled the submitted demonstration from six voice takes Maxwell recorded on 17 September over the v7 picture cut. Two stale spoken claims were cut from the audio rather than left in: a test count that the new database work had made wrong, and a reference to September commits that the 10 September GitHub capture does not show. Footage timing was matched to each take so the picture keeps moving and no section runs silent. Final file: 1:58, 1920x1080, H.264 and AAC, mean level -17.9 dB, peak -1.4 dB, no silence over two seconds, decodes without errors. The report PDF could not be rebuilt on the Mac mini: every LibreOffice launch hangs in the dynamic loader, so the current DOCX stands and the PDF must be exported elsewhere.

## 18 September: restart evidence re-recorded on the lecturer schema

Replaced the demonstration's invalid-input and restart segment with a single continuous browser recording made against the assigned lecturer MySQL schema, driven by a Playwright script that stops and restarts both services mid-session. The recording shows invalid JSON rejected in the browser, the running page reporting the outage while both processes are down, and the saved experiments and run history returning from MySQL after restart. Only the startup segment now comes from the earlier SQLite run. Report and runbook updated to match.

## 18 September: narration cleaned and levelled

Cleaned the six voice takes with a new tracked script: removed a false start where the JSON-RPC acronym was restarted mid-word, trimmed pauses over one second, tightened each take's head and tail, notched out a 120 Hz buzz and a low hum cluster, gated the room tone between phrases, and normalised every take to -16 LUFS with peaks at -1.5 dBTP. Room tone in the gaps fell by about 32 dB. A compressor and a broadband denoiser were both tried and rejected: measured against a speech-to-text transcript of the same audio, each smeared consonants badly enough to turn "stop" into "start" and "healthy" into "help you". The finished video is 1:51; its audio track was transcribed end to end to confirm the narration survived the edits.

## 18 September: GitHub history captured live

The demonstration's development-history segment is now a screen recording of the signed-in GitHub commits page, made on 18 September, so the date headers through Sep 18 and Sep 17 are visible alongside the August milestones. It replaces the 10 September still, which stopped at 22 August and made the narration's reference to September work unsupported. Automated capture was attempted first and abandoned: Chrome's cookie encryption will not unlock for an automated profile copy, and the live profile cannot be opened while Chrome is running.

## 18 September: data design and failure evidence strengthened

The dependency's JSON-RPC error code is now its own column on experiment_runs rather than something only recoverable from the stored envelope, so failures are countable in SQL. Both schema scripts constrain the behaviour and outcome value sets at the database level, and an idempotent migration adds the new column to a schema created before it, keeping existing rows: the lecturer schema was migrated in place. The unreachable outcome is now proved by killing a real downstream child process between two runs of the same experiment, instead of by pointing the coordinator at an unused port, and db:inspect has a test and reports runs grouped by outcome. The suite is 49 tests and the full verification ladder passes.
