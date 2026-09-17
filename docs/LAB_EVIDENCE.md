# COMP713 lab evidence map

This appendix connects the lab work to RelayLab. It separates the earlier local exercises from the lab submissions verified on 10 September 2026. Submission receipts establish hand-in; they do not establish marks or an in-person explanation.

## Verified lab references

| Relevant weeks | Reproducible artifact | Fresh verification | Concepts carried into RelayLab |
| --- | --- | --- | --- |
| Lab 03-04: request lifecycle | Lifecycle Lab+ generated reference | `uv run pytest -q` -> 9 passed | HTTP request lifecycle, JSON contract, runtime validation, method/route errors, request IDs, timing evidence, transport failure versus HTTP failure |
| Lab 05-06: web clients, API, database connectivity | Data Client Lab+ generated reference | `uv run pytest -q` -> 10 passed | client/API separation, shared service layer, repository boundary, two related tables, foreign-key enforcement, parameter binding, controlled 400/503 paths, restart persistence |

Both references are produced from canonical generator scripts in the private
AUT study repository. The generators and current lab guide entered Git history
in commit `c4e8268` on 29 July 2026. Generated virtual environments, caches, and
database files are not submission evidence and must not be included in the
RelayLab archive.

The reproducible source paths are
`scripts/generate_comp713_lifecycle_lab.py` and
`scripts/generate_comp713_data_client_lab.py`; their generated outputs are
`output/comp713-lifecycle-lab-plus` and
`output/comp713-data-client-lab-plus`.

## Concept-to-project trace

| Lab concept | RelayLab implementation | Project evidence |
| --- | --- | --- |
| Client serialises a request and consumes JSON | React client calls the coordinator API | `client/src/api.ts`, `client/src/App.test.tsx` |
| Handler validates before application logic | Zod validates experiment and downstream message shapes | `server/src/app.ts`, `downstream/src/app.ts` |
| Explicit request/service boundaries | Browser -> coordinator -> downstream | Real TCP downstream tests and live request trace |
| RPC application error differs from transport failure | RPC `-32001` maps to `downstream_error`; refused connection maps to `unreachable` | Coordinator outcome tests |
| Bounded waiting | Coordinator aborts after 400 ms | Timeout test and Slow demonstration |
| Presentation does not access data directly | Client talks only to coordinator | Architecture and source structure |
| Related relational entities | `experiments` has many `experiment_runs` | SQLite/MySQL schema plus persistence tests |
| Parameterised data access | Values are bound rather than concatenated | Database adapter and configuration tests |
| Managed, bounded connection use | MySQL pool limit is fixed at 5 | `MAX_DATABASE_CONNECTIONS` and pool-options test |
| Controlled persistence failure | Generic 503 avoids credential/database leakage | Coordinator error middleware |

## Remaining checks

- The local references are explicitly learning material, not proof of a Canvas
  submission.
- The supplied Week 3 Java project passed ten local MySQL/Payara runtime checks. Lecturer-hosted database access remains unverified.
- RelayLab lecturer-MySQL save/run/reopen and restart checks passed on 15 September over verified TLS. This does not establish a lecturer-hosted run of the separate Week 3 Java exercise.
- The final project submission is still separate from the lab receipts below.

## Reproduction commands

From the AUT study repository:

```bash
make comp713-lifecycle-lab
make comp713-data-client-lab
```

From the RelayLab project repository:

```bash
npm ci
npm run verify
```

These commands reproduce the lab checks and the project verification without
requiring private database credentials.

## Current submission and verification update: 10 September 2026

Revised Canvas Attempt 2 receipts confirm Week 3 at 10:59, Week 4 at 11:00, Week 5 at 11:01, Week 6 at 11:02 and Week 2 at 11:09 NZST on 10 September. These versions use concise references. Earlier attempts remain in Canvas history. Week 2 is a text entry containing the implementation and evidence; Weeks 3–6 are source/evidence archives.

- Week 2: nine tests and six real-browser paths, including a stopped-server failure.
- Week 3: ten local MySQL/Payara runtime checks; lecturer AWS MySQL remains unverified.
- Week 4: four supplied tests, vector-clock reasoning and a conserved snapshot total.
- Week 5: six tests plus live gRPC success and failure checks.
- Week 6: five tests plus eleven real HTTP checks, including no orphan enrolment after downstream failure.
- Week 7: two-host mutual exclusion plus four independent-JVM consensus cases; packaged, with no separate Canvas upload slot identified.

Lab work and weekly progress carry 15 of the 100 rubric marks. The receipts above record when each revised attempt was submitted; they are not presented as evidence of weekly progress before those dates.
