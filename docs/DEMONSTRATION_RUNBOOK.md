# RelayLab demonstration and evidence runbook

This is a recording checklist, not evidence that a video has already been
recorded or submitted. Reconcile it with the current Canvas brief and marking
rubric after AUT authentication is restored.

## Before recording

1. Put lecturer-issued values in the ignored `.env` file. Do not show the file,
   terminal environment, password manager, or shell history in the recording.
2. Confirm `RELAYLAB_DATABASE_DRIVER=mysql` for the assessed database run. The
   deterministic offline test lane intentionally uses SQLite.
3. Run `npm ci`, then `npm run verify`. Keep the concise passing summaries
   available; do not expose unrelated terminal history.
4. Start the three-process development system with `npm run dev` and open
   `http://localhost:5173`.
5. Use a clean browser window and a payload containing only invented data.

## Suggested recording route

| Segment | Show | Explain | Evidence produced |
| --- | --- | --- | --- |
| Identity | Title slide or spoken introduction | Name, student ID, course, project name | Assessment identity |
| Architecture | README diagram and three running processes | Browser to coordinator to downstream; only the coordinator owns persistence | Distributed boundaries |
| Healthy exchange | Choose Healthy and run | JSON crosses two HTTP boundaries and the validated result is persisted | HTTP 200, duration, response |
| Controlled failure | Choose Unavailable and run | The dependency returns 503; the coordinator classifies and stores the failure instead of crashing | `downstream_error`, HTTP 503 |
| Timeout/contract | Run Slow or Malformed | Bounded waiting and response-shape validation are separate failure modes | `timeout` or `invalid_response` |
| Durable history | Open Saved experiments, restart the app, reopen the same item | One experiment has many run records through a foreign key | Run history survives restart |
| Database safety | Show only the relevant source lines | MySQL uses parameterised queries and a hard pool cap of five; credentials stay outside Git | Implementation evidence without secrets |
| Testing | Run `npm run verify` | Client workflow, coordinator API, downstream contract, build, restart smoke, and production dependency audit | Reproducible test evidence |
| Limitations | README limitations | Deterministic simulator, single user, no automatic retries or arbitrary external URLs | Honest evaluation |

## Report evidence matrix

| Claim | Primary implementation | Automated evidence | Video evidence |
| --- | --- | --- | --- |
| Separate distributed processes | `client/`, `server/`, `downstream/` | Coordinator tests use a real TCP downstream boundary | Show three named dev processes and request path |
| Validated JSON API | `server/src/app.ts`, `downstream/src/app.ts` | Coordinator and downstream suites | Healthy and malformed runs |
| Relational one-to-many persistence | `server/src/database.ts` | API restart tests plus `npm run smoke` | Reopen saved history after restart |
| Controlled failure handling | `server/src/app.ts` | 503, timeout, malformed, and unreachable tests | Show at least two distinct failure modes |
| Browser workflow | `client/src/App.tsx` | `client/src/App.test.tsx` | Create, run, inspect, reopen |
| Lecturer database constraint | `server/src/database.ts` | Database configuration tests | State pool cap five; never display credentials |

## Final evidence gates

- [ ] Current Canvas brief and rubric have been reread after authentication.
- [ ] Lecturer MySQL credentials have been received and entered locally.
- [ ] `npm run verify` passes from a clean install.
- [ ] The demonstrated database is the lecturer server where required.
- [ ] The video visibly proves operational behavior; README prose alone is not
      treated as execution evidence.
- [ ] Name and student ID are correct in every submitted artifact.
- [ ] The uploaded repository/archive contains no `.env`, database password,
      generated local database, or unrelated private material.
- [ ] Canvas submission is completed only after Maxwell reviews the exact final
      artifact and explicitly authorizes the upload.
