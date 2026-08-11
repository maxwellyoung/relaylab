# RelayLab demonstration and evidence runbook

This is the recording plan and evidence checklist. It was reconciled on 11
August 2026 against the supplied Canvas assignment instructions and official
three-page Option A brief. It is not a claim that the final video or Canvas
submission has already been completed.

## Before recording

1. Put lecturer-issued values in the ignored `.env` file. Never show the file,
   terminal environment, password manager, shell history, or credentials.
2. Use invented request data only. If credentials have arrived, confirm the
   assessed run uses `RELAYLAB_DATABASE_DRIVER=mysql`; otherwise label the
   recording as a SQLite draft and do not claim live MySQL evidence.
3. Run `npm ci` and `npm run verify`. Keep only the concise passing summary
   visible.
4. Start the three-process system with `npm run dev` and open
   `http://localhost:5173`.
5. Open the GitHub repository's **Commits** page so the website timestamps can
   be shown directly, as required.

## Suggested recording route

| Segment | Show | Explain | Evidence produced |
| --- | --- | --- | --- |
| Introduction | Title card or brief spoken introduction | Name, student ID, course, Option A, and RelayLab purpose | Assessment identity and scope |
| Startup | Clean terminal running `npm run dev` | Three independently running processes and their ports | System starts reproducibly |
| Architecture | README diagram and live interface | Browser REST -> coordinator -> downstream JSON-RPC; coordinator -> database | Communication boundaries and protocol choice |
| Healthy exchange | Select Healthy and run invented JSON | Coordinator sends `relaylab.process.v1` with a correlation ID | HTTP 200, RPC result, duration, envelope, timestamp |
| Invalid input | Enter malformed JSON and run | Client validation prevents an invalid API write | Readable controlled error |
| Failed request | Select Unavailable and run | HTTP succeeds while the method returns RPC error `-32001` | `downstream_error`, HTTP 200, RPC `-32001`, run count change |
| Contract/deadline | Run Malformed or Slow | RPC result validation and bounded waiting are different failure modes | `invalid_response` or `timeout` |
| Durable state | Reopen Saved experiments; restart and reopen if practical | One experiment owns many run records | State survives restart |
| Database implementation | Show only safe source excerpts | Related tables, parameterised SQL, optional MySQL adapter, hard pool cap 5 | Data-design evidence without credentials |
| Test evidence | Run `npm run verify` | 27 tests plus type checks, builds, restart smoke, and dependency audit | Reproducible evidence |
| GitHub history | Repository **Commits** page | Point out meaningful July and August milestones and visible website timestamps | Development-process evidence |
| Limitations | Report or README limitations | Simulator, single user, no retries; disclose MySQL live-test status exactly | Honest self-evaluation |

## Report evidence matrix

| Claim | Primary implementation | Automated evidence | Video evidence |
| --- | --- | --- | --- |
| Separate distributed processes | `client/`, `server/`, `downstream/` | Coordinator tests use a real TCP downstream boundary | Show the three dev processes and request path |
| REST plus JSON-RPC | `server/src/app.ts`, `server/src/downstream-rpc.ts`, `downstream/src/app.ts` | Correlation, method, parameter, result, and error tests | Expand the saved RPC envelope |
| Relational one-to-many persistence | `server/src/database.ts` | API persistence tests and `npm run smoke` | Reopen history after a new run/restart |
| Controlled failure handling | `server/src/app.ts` | RPC error, timeout, malformed-result, and unreachable tests | Show at least one failed request |
| Browser workflow | `client/src/App.tsx` | Three client tests | Create, run, inspect, and reopen |
| Lecturer database constraint | `server/src/database.ts` | Database configuration tests | Show pool cap 5 without showing credentials |
| Incremental development | GitHub repository | Commit history and development log | Show timestamps on GitHub website |

## Final evidence gates

- [x] Official Option A project brief has been reviewed.
- [x] Supplied Canvas submission instructions and full rubric have been reviewed.
- [x] Current 27-test verification, type checks, builds, restart smoke, and
      production dependency audit pass.
- [x] Current source commits are visible on GitHub.
- [ ] Lecturer MySQL credentials have been received and entered locally.
- [ ] The lecturer MySQL schema has passed a live create/run/read/restart check.
- [ ] The final video visibly proves startup, main functions, communication,
      state change, a failure/invalid-input case, limitations, and GitHub website
      timestamps.
- [ ] Name and student ID have been checked in every final artifact.
- [ ] The final archive contains no `.env`, password, local database,
      `node_modules`, build output, cache, or unrelated private material.
- [ ] Canvas upload and submission occur only after Maxwell reviews the exact
      final artifacts and explicitly authorizes that action.
