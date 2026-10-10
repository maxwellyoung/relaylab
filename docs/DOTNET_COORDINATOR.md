# ASP.NET Core group coordinator

The group launcher uses an original ASP.NET Core 10 coordinator with EF Core
SQLite persistence.
It implements the existing experiment/run/review HTTP contract so the React
client and native Android reviewer can connect without application changes.
The independent Node gRPC runner retains its own execution ledger. The original
individual Node/JSON-RPC baseline and optional Node group lane remain available.

## Setup

Install the .NET SDK version specified in `global.json`, alongside the existing
Node/npm prerequisites. Use the official Microsoft SDK installer or an existing
installation. `DOTNET_COMMAND` may point to a private SDK executable; otherwise
the wrapper uses `~/.local/share/relaylab-dotnet/dotnet` when present, then
`dotnet` on PATH. SDK and build output are excluded from Git.

```bash
npm ci
npm run build:group
npm run start:group
```

Open http://localhost:3000. `GET /health` reports `implementation: "dotnet"`,
`database: "sqlite"`, `executionTransport: "grpc"` and `persistenceAdapter: "ef"`. Both services bind only
to loopback. Override `PORT`, `RUNNER_PORT` and `RELAYLAB_GROUP_DATA_DIR` when
another local instance is running. The launcher waits for actual service
readiness and stops its own runner when the coordinator exits.

```bash
npm run verify:group
npm run start:group:node  # optional previous Node group implementation
```

`verify:group` includes the original tests, types, builds and integration smokes,
then locked .NET restore/build, real HTTP compatibility and gRPC recovery smokes,
and a direct/transitive NuGet vulnerability audit. Reported vulnerabilities fail
the audit; an incomplete audit fails closed. It requires network access to NuGet.

## Layers and ownership

| Layer | Responsibility |
| --- | --- |
| React / native Android | Input, review queue, feedback and displayed execution evidence |
| `Controllers/` | HTTP routes, status codes and correlation/session headers |
| `Services/ExperimentService.cs` | Validated experiment input, attempt classification and idempotent replay |
| `Services/ReviewService.cs` | Demo sessions, role visibility and permitted review transitions |
| `Services/RunnerGateway.cs` | Generated gRPC client, deadline, transport errors and result validation |
| `Data/ICoordinatorRepository.cs` | Persistence contract consumed by experiment/review services |
| `Data/EfRepository.cs` | Default EF adapter with per-operation contexts and transactional review decisions |
| `Data/CoordinatorDbContext.cs` | Explicit entity/column/FK mappings to the existing coordinator schema |
| `Data/CoordinatorDatabase.cs` | Shared non-destructive schema startup |
| `Data/SqliteRepository.cs` | Optional direct SQL adapter, retained for compatibility checks |
| Node `runner/` | Durable operation identity, execution state, result and restart recovery |

EF Core SQLite 10.0.12 is pinned alongside Microsoft.Data.Sqlite. The coordinator reuses
`database/schema.sqlite.sql` and generates its C# gRPC client from
`protocol/runner.proto`. NuGet dependencies are pinned in `packages.lock.json`;
restore runs in locked mode. The runner never reads the coordinator database,
and the coordinator never reads the runner database.

## Existing data and persistence demonstration

The default files remain:

- `data/group/coordinator/relaylab.sqlite`: experiments, immutable attempt
  receipts and reviews.
- `data/group/runner/runner.sqlite`: executions owned by the separate service.

Open each separately in DB Browser for SQLite to demonstrate ownership. Do not
run two coordinators against the same file during the demo or test a migration
on the only copy of valuable data. The isolated smoke copies synthetic
Node-created records into a disposable directory and proves .NET reads their
experiment, historical JSON-RPC receipt and decided review. No user database is
modified by that compatibility test. Historical JSON-RPC receipts remain
readable but have no live gRPC operation to inspect.

Reviews and receipts survive a coordinator restart. Demo sessions do not:
reselect the actor. Review decisions are conditioned on pending status, so only
one competing request succeeds; submitted evidence is protected from deletion.
A late runner completion does not rewrite a recorded timeout. A same-key retry
can observe that durable operation again, and channel recovery permits a call
immediately after the runner is restarted.

## Current scope

The teammate task-app source has now been reviewed privately. It provides an
ASP.NET/EF Core/SQLite approach for editable tasks and lists; the coordinator
here remains independently implemented against RelayLab's experiment/review
contract. The EF persistence approach has been adapted to that contract in this branch.
No task-app source or history has been imported. The adapter notes below explain
its boundaries and verification.

This lane uses SQLite only; the original Node MySQL adapter remains separate.
Selectable demo actors model the handoff and are not production authentication.
Experiment ownership is still shared. WebSockets, physical Android proof,
team ownership, reports, merge, deployment and submission remain separate work.
Source commits record their real dates; this checkpoint does not establish
three weeks of development.

## EF persistence adapter

`ICoordinatorRepository` is implemented by `EfRepository` by default. The original
`SqliteRepository` can be selected explicitly for compatibility or comparison:

```bash
RELAYLAB_PERSISTENCE_ADAPTER=sql npm run start:group
npm run smoke:dotnet:sql
```

Only `ef` and `sql` are accepted. The health endpoint reports the selected
adapter. Both adapters use the same coordinator database and shared startup
schema; switching does not copy, rebuild or delete its tables. EF does not call
EnsureCreated, EnsureDeleted or automatic EF migrations. The canonical SQL
retains its existing defaults, checks, indexes and foreign-key constraints.
Older missing RPC/idempotency columns are added before the shared schema is
applied. Schema evolution remains an explicit change to the canonical scripts.

CoordinatorDbContext maps `experiments`, `experiment_runs` and `run_reviews`
columns explicitly. Experiment payloads and receipt responses remain serialized
JSON; stored timestamp text is normalized to the existing UTC HTTP shape. The
runner's execution database remains behind gRPC and is never mapped by EF.

The adapter uses IDbContextFactory with one disposed context per operation,
so singleton review/session services never capture a scoped context. Reads use
AsNoTracking. This follows Microsoft's [DbContext lifetime guidance](https://learn.microsoft.com/en-gb/ef/core/miscellaneous/configuring-dbcontext).
The current repository methods perform synchronous, bounded local SQLite work;
this does not claim asynchronous database I/O or production-load performance.

Review creation and decision write/read-back use explicit transactions. A
pending-only ExecuteUpdate and affected-row check select one winning decision.
Duplicate submissions and protected deletion become the existing 409 error
shape. Transactions cover the update plus returned receipt, because
[ExecuteUpdate does not create a transaction automatically](https://learn.microsoft.com/en-us/ef/core/saving/execute-insert-update-delete).

`npm run verify:group` tests both adapters through real HTTP. It verifies an
older Node-created schema and historical feedback, concurrent writes, atomic
review decisions, protected evidence, gRPC deadline/restart recovery and an
EF-to-SQL-to-EF roundtrip. The alternate adapter reads existing history, writes
new receipts/feedback, and the original adapter reads them and replays the same
idempotency key. No user data is used by these disposable tests.

This is an original adaptation of the teammate's EF/SQLite approach. The
private task-app snapshot stays outside tracked source; no private database or
executable is imported. The next team checkpoint is review of this adapter,
agreement on real experiment ownership/accounts and the proposed contribution
split. WebSockets remain optional after those core requirements are agreed.
