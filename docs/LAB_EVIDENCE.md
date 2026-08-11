# COMP713 lab evidence map

This appendix connects verified local lab work to RelayLab without presenting
the generated references as Canvas submissions or student-authored reflection
answers. It records reproducible evidence available on 11 August 2026.

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
| HTTP error differs from transport failure | 503 maps to `downstream_error`; refused connection maps to `unreachable` | Coordinator outcome tests |
| Bounded waiting | Coordinator aborts after 400 ms | Timeout test and Slow demonstration |
| Presentation does not access data directly | Client talks only to coordinator | Architecture and source structure |
| Related relational entities | `experiments` has many `experiment_runs` | SQLite/MySQL schema plus persistence tests |
| Parameterised data access | Values are bound rather than concatenated | Database adapter and configuration tests |
| Managed, bounded connection use | MySQL pool limit is fixed at 5 | `MAX_DATABASE_CONNECTIONS` and pool-options test |
| Controlled persistence failure | Generic 503 avoids credential/database leakage | Coordinator error middleware |

## Honest remaining lab gates

- The local references are explicitly learning material, not proof of a Canvas
  submission.
- The Jakarta EE/Payara/MySQL common checkpoint and any required own-word
  reflections remain separate course tasks unless the lecturer confirms the
  approved-equivalent route.
- A live lecturer-MySQL project run is pending private credentials.
- Any Canvas upload, quiz attempt, declaration, or submission remains a
  student-only action requiring Maxwell's explicit review and approval.

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
