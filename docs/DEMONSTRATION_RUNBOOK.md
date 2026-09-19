# RelayLab demonstration and evidence runbook

This is the recording plan and evidence checklist. It was reconciled on 10
September 2026 against the supplied Canvas assignment instructions and official
three-page Option A brief. It is not a claim that the final video or Canvas
submission has already been completed.

## Before recording

1. Keep credentials in the ignored `.env` file. Never show that file, the
   terminal environment, a password manager, or shell history.
2. Run `npm run build`. The lecturer MySQL lane needs `RELAYLAB_DB_SSL_CA`
   pointing at the public RDS CA bundle (see README).
3. Arrange three terminals in the project root and a browser with the GitHub
   **Commits** page open, so website timestamps can be shown directly.

## Recording route

One continuous screen recording with spoken explanation, then light editing.

| Segment | Show | Evidence produced |
| --- | --- | --- |
| Introduction | Name, student ID, course, Option A, one-line architecture | Assessment identity and scope |
| Startup | `npm run start:downstream` and `npm run start:coordinator`, then `/health` | Two independently running services; the reported driver and deadline |
| Healthy exchange | Run Healthy; expand response evidence; point at both logs | HTTP 200, correlated JSON-RPC result, same `rpc=` ID in both processes, saved run |
| Invalid input | Break the payload JSON and run | Client-side rejection, no request sent |
| Failure kinds | Run Unavailable, Slow, Malformed | `downstream_error` over HTTP 200, `timeout` with the late downstream reply in its log, `invalid_response` |
| Unreachable dependency | Stop only the downstream; run; restart it; run again | `unreachable` recorded while the coordinator keeps serving, then recovery |
| Data design | `npm run db:inspect`; server-side validation with `curl` | Two related tables with a foreign key; 400 with field errors |
| Durable state | Restart the coordinator; reload; reopen saved experiments | History survives restart |
| Test evidence | `npm test` | 63 passing tests |
| GitHub history | Scroll the repository **Commits** page | Commit dates on the GitHub website |
| Limitations | Spoken | Simulated failures, single user, no authentication or retries, no hosted deployment in this submission |

## Report evidence matrix

| Claim | Primary implementation | Automated evidence | Video evidence |
| --- | --- | --- | --- |
| Separate distributed processes | `client/`, `server/`, `downstream/` | Coordinator tests use a real TCP downstream boundary | Show the three dev processes and request path |
| REST plus JSON-RPC | `server/src/app.ts`, `server/src/downstream-rpc.ts`, `downstream/src/app.ts` | Correlation, method, parameter, result, and error tests | Expand the saved RPC envelope |
| Relational one-to-many persistence | `server/src/database.ts` | API persistence tests and `npm run smoke` | Reopen history after a new run/restart |
| Controlled failure handling | `server/src/app.ts` | RPC error, timeout, malformed-result, and unreachable tests | Show at least one failed request |
| Browser workflow | `client/src/App.tsx` | Eight client tests | Create, run, inspect, and reopen |
| Optional MySQL pool limit | `server/src/database.ts` | Database configuration tests | Show pool cap 5 without showing credentials |
| Incremental development | GitHub repository | Commit history and development log | Show timestamps on GitHub website |

## Final evidence gates

- [x] Official Option A project brief has been reviewed.
- [x] Supplied Canvas submission instructions and full rubric have been reviewed.
- [x] 10 September: 34 tests, type checks, builds, and restart smoke pass.
- [x] 10 September: production dependency audit reports zero known vulnerabilities after qs 6.16.0; full verification passes.
- [x] July/August history and timestamps verified on the GitHub website on 10 September. September fixes were committed and pushed on 17 September.
- [x] 15 September: lecturer MySQL schema passed a live verified-TLS create/run/read/restart check (see DEVELOPMENT_LOG.md). Hosted deployment is not required by the Option A brief and was not reverified.
- [x] 18 September: the final video shows startup of both services, a healthy
      request, an RPC application error, a deadline timeout, invalid JSON
      rejected, restart persistence on the lecturer schema, commit dates on the
      GitHub website through 18 September, and a limitations card.
- [x] 17 September: name and student ID (Maxwell Young, 23213801) checked on the report cover, every report page header, and the demonstration title card.
- [x] 17 September: `npm run package` builds the archive from `git archive`; it contains no `.env`, password, local database,
      `node_modules`, build output, cache, or unrelated private material.
- [ ] Canvas upload and submission occur only after Maxwell reviews the exact
      final artifacts and explicitly authorizes that action.


## Current recording

The submitted demonstration is `outputs/relaylab-film-v7/RelayLab-demo-23213801-Maxwell-Young.mp4`
(1:53, 1920x1080). It is an edited film, not one continuous take: Maxwell's own
narration, recorded on 17 September, runs over real browser and console
recordings, and every section states on screen which recording it shows and
when it was made. The narration is cleaned by `scripts/clean-voice-takes.py`,
which removes one false start, trims over-long pauses, notches out the
recording's hum and normalises the level. One spoken claim that had gone stale
was cut rather than left in: a test count the later database work changed. The
narration's reference to September commits is kept, because the GitHub segment
was re-recorded on 18 September and shows them. Sections: title card with name and student ID; startup of the
coordinator and downstream as separate processes; a healthy request, an RPC
application error, a deadline timeout, invalid JSON rejected, an outage while
both services are down, and the saved history reopened, all recorded on the
lecturer MySQL schema on 18 September with the current interface; a card showing both services' real log lines for one exchange
that timed out, was retried with the same idempotency key, and was replayed by
the dependency rather than executed twice; a card showing the coordinator
rejecting an invalid request with its field errors; the GitHub commits page; a
closing card covering
communication, failure handling, transactional persistence, the fresh-clone
verification and the limitations; and an excerpt of the actual `npm run verify`
output, so the spoken claim about the test suite is evidenced on screen.

Every section is current: the startup card, the three application clips, the log
card and the validation card were all produced on 18 September against the
lecturer MySQL schema. Invalid input, the
outage and restart persistence were re-recorded on the lecturer MySQL schema on
18 September by `scripts/record-demo-clips.mjs`, which drives the real browser
against the configured database and records one clip per narrated section,
stopping and restarting both services for the last one. The GitHub segment is a screen
recording of the commits page made on 18 September, so the September commits and
their dates are on screen.
The fuller live route in the table above was not recorded; cuts v2 to v6 are
superseded.
