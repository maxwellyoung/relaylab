# Combined candidate: demo, report and package checklist

Prepared 26 October 2026 UTC by the recovery assistant. This is a local
engineering checkpoint, not a submission, student reflection or team agreement.

## Source and attribution

The isolated checkout starts from main `4cec6d1`. PR7 `9b5e9ee` already includes
PR5 `0cbc882`; PR6 `73d1de4` was applied locally. The Android tree is identical
to PR6. Its original Hansith Perera development-log entry is preserved after
the PR7 entries; both branches appended at the same location. The original
PR6 patch is retained outside the checkout. No duplicate audit update was made.

| Source | Concrete change | Attribution evidence |
| --- | --- | --- |
| [PR5](https://github.com/maxwellyoung/relaylab/pull/5) | Browser acceptance fixtures and desktop/phone workflow checks | Original PR and commits; existing log describes assistant support |
| [PR6](https://github.com/maxwellyoung/relaylab/pull/6) | Per-review, per-origin Android drafts, discard, unsent notes | Hansith's four original commits and attributed log; reported manual checks remain his historical evidence |
| [PR7](https://github.com/maxwellyoung/relaylab/pull/7) | Windows command portability, bounded smoke startup/outage observation, production dependency fixes | Original PR, commits and exact CI run |
| This recovery | Local assembly, new combined-source verification and this checklist | Assistant work on 26 October UTC; does not establish a student's independent contribution |

Before any later remote integration, preserve the original PR histories and
their authors. PR7 is stacked on PR5; retarget it only after the approved PR5
integration. No remote merge, push, deployment or submission is authorized here.

## Verified on the combined source

- [x] Clean locked npm installation; Node 26.8.2, npm 11.19.1.
- [x] `npm test`: 119 pass (10 smoke-helper, 22 browser-client unit, 7 runner,
  10 downstream, 70 coordinator); one credential-dependent MySQL test skipped.
- [x] `npm run typecheck`, including browser fixture types; `npm run build`.
- [x] Locked .NET 10.0.401 restore/build: zero build warnings/errors.
- [x] `npm run smoke`, `smoke:reviews`, `smoke:grpc` (Node).
- [x] `npm run smoke:dotnet`, `smoke:dotnet:sql`, `smoke:grpc:dotnet`:
  EF/direct SQL, HTTP compatibility, durable decisions, role visibility,
  concurrent writes, gRPC deadlines/same-key recovery and runner restart.
- [x] `npm audit --omit=dev --audit-level=high`: zero vulnerabilities;
  `npm run audit:dotnet`: no reported direct/transitive vulnerabilities.
- [x] `npm run test:browser`: 11/11, one run with zero retries, real .NET/EF
  and gRPC fixtures, separate identities, desktop and 320px Chromium phone
  emulation. Includes stale-decision conflict, offline draft recovery and focus.
- [x] Java 21, Gradle 8.7 with a copied workspace-local cache:
  `:app:testDebugUnitTest :app:assembleDebug :app:lintDebug
  :app:assembleRelease :app:lintRelease --offline --no-daemon --console=plain`.
  Eleven Android unit tests pass, including six draft-store tests. Each lint
  variant has five warnings (OldTargetApi and four SetTextI18n), no errors.
  Debug APK is for local testing; release APK is unsigned.

All runtime fixtures use disposable databases and fresh loopback ports.
Their normal teardown targets their own children/groups. No existing preview,
checkout or unknown process was targeted. The npm installation warned about
unapproved dependency install scripts; no approval or source change was needed
for these tests/builds to pass. Web build reports large documentation chunks.

The smoke commands contain small warm-loopback refresh timing samples. Other
verification commands ran concurrently; do not present those samples as an
agreed workload benchmark or Android latency result.

[PR7's exact CI run](https://github.com/maxwellyoung/relaylab/actions/runs/40185729670)
passed all six jobs, including Windows and real MySQL. That is upstream PR7
evidence; it is not combined-source Windows/MySQL/Android runtime evidence.

## Requirements that still need an authoritative source

- [ ] Obtain the current COMP713 Assessment 3 brief, marking rubric, Canvas
  submission instructions and exact deadline/timezone. `REQUIREMENTS.md`,
  `TECHNICAL_REPORT.md` and `DEMONSTRATION_RUNBOOK.md` primarily describe the
  earlier individual Assessment 2 Option A submission. Their 1,500-word limit,
  report headings, video and hosting rules must not be assumed for Assessment 3.
  No authoritative Assessment 3 brief is present in this fresh repository.
- [ ] Map every Assessment 3 criterion to an implementation, a genuine dated
  evidence artifact and any report/demo location. Mark unmet criteria clearly.
- [ ] Confirm team roster and actual accepted responsibilities. The lanes in
  `TEAM_HANDOFF.md` are proposals; commit authors/PRs alone do not establish
  all personal contribution, review or independent investigation claims.
- [ ] Resolve the documented ownership and notification choices: experiments
  are shared, review submissions are actor-scoped, demo roles are open, and
  Android notification delivery is polled rather than instant remote push.
- [ ] Confirm workload/data volume and Android response-time acceptance target.
  Run a dated, reproducible dataset/concurrency/device measurement only after
  those parameters are agreed. Preserve two genuine dated working checkpoints
  if the actual brief requires them; no new run creates three weeks of history.

## Remaining demonstration work

Use `GETTING_STARTED.md` for the group path, not the old Node-only video route.
For this checkout choose unused ports and a new data directory; do not reuse
ports or stores belonging to another task. For example, after confirming that
the ports are free:

```bash
PORT=43128 RUNNER_PORT=53128 \
RELAYLAB_GROUP_DATA_DIR="$PWD/output/demo-recovery" npm run start:group
```

This command is an example, not a claim that a preview is running or that these
ports remain free. Windows shells can use `npx cross-env` for the assignments.

- [ ] Record the health response showing `implementation: dotnet`,
  `persistenceAdapter: ef`, `executionTransport: grpc`. Explain separate runner
  and coordinator stores and browser REST -> .NET -> protobuf/gRPC -> runner.
- [ ] Show researcher A create/run/submit, then a separate reviewer context
  requiring feedback and saving a decision. Refresh the researcher to show
  identical feedback and unchanged execution outcome.
- [ ] Show a slow/timeout receipt, a competing decision, and recovery/persistence
  across a deliberate restart of only the demonstration's own services.
- [ ] On a newly owned Android test device/emulator against this exact source,
  verify two independent drafts, back/open, rotation, app process recreation,
  failed/uncertain submission retention, successful decision clearing only its
  draft, web decision leaving a read-only unsent note, and disconnect clearing
  only that API origin. Keep native Android distinct from Chromium emulation.
  The existing `smoke-android.py` is restricted to a named QA AVD and ports
  3118/3128; it was not run here. Do not repoint it at another task's emulator.
- [ ] Verify notifications and any required physical-device/network behavior
  separately. Static build and draft-store tests do not prove these paths.
- [ ] Record the actual new combined demo with real speakers and dates. The
  earlier Assessment 2 film described in the repository is historical evidence,
  not a completed group demo. Check screen contents and synthetic data first.

## Remaining reports

- [ ] Create the Assessment 3 group report only after confirming its required
  structure/length. Explain the .NET/EF coordinator, gRPC ledger, review workflow
  and native Android addition, with a boundary diagram and current evidence.
- [ ] Cite the original PRs and actual verification artifacts. Distinguish
  historical main/PR results from this candidate and emulator from real device.
- [ ] Have each member supply their own investigation, decisions and reflection.
  Do not copy the earlier individual report into a new group report or invent
  claims about who implemented/reviewed work or when it was completed.
- [ ] Reconcile actual tests, limitations, source commit and dates across report,
  video and package; then render and review the final deliverables visually.

## Package and approval checklist

- [ ] Review this local candidate and choose the final integrated source after
  explicit approval for any remote integration. None was performed here.
- [ ] Build an archive from the candidate snapshot, not PR7 HEAD with unstaged
  Android changes. `npm run package` archives only committed HEAD.
- [ ] Inspect archive membership for `.env`, credentials, databases, caches,
  dependencies, generated builds and unrelated material. Keep synthetic raw
  traces and session-bearing logs outside the source archive.
- [ ] Extract the exact archive into a new directory and run locked install,
  `npm run verify:group`, browser acceptance, and Android checks appropriate to
  the agreed submission. Fresh extraction was not verified in this checkpoint.
- [ ] Decide whether the submission needs an installable APK, source only, a
  signed release, PDF, video or repository link from the actual instructions.
  This checkpoint's release APK is unsigned and is not a store release.
- [ ] Review the final archive/report/video/APK hashes and a file manifest.
- [ ] Obtain Maxwell's explicit approval for the exact remote merge/push,
  deployment or submission action, as applicable. No Teams send belongs to
  this engineering recovery task.

Raw run logs and a machine-readable verification summary are retained in the
allocated task's sibling `evidence/` directory. Browser HTML/screenshots are
under `output/playwright/`; Android XML/HTML reports are under
`android/app/build/`. These generated files are excluded from Git.
