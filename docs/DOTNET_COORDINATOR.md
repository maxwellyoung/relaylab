# ASP.NET Core group coordinator

The group launcher uses an original ASP.NET Core 10 coordinator with SQLite.
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
`database: "sqlite"` and `executionTransport: "grpc"`. Both services bind only
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
| `Data/SqliteRepository.cs` | Parameterised SQL, transactions and atomic pending-to-final decisions |
| Node `runner/` | Durable operation identity, execution state, result and restart recovery |

The coordinator uses Microsoft.Data.Sqlite directly. It reuses
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

The supplied task-app README describes another application; its repository has
not been supplied or integrated. This coordinator is independently implemented
against RelayLab's existing contract. Source integration needs that repository
and a review of the actual code before a baseline claim is made.

This lane uses SQLite only; the original Node MySQL adapter remains separate.
Selectable demo actors model the handoff and are not production authentication.
Experiment ownership is still shared. WebSockets, physical Android proof,
team ownership, reports, merge, deployment and submission remain separate work.
Source commits record their real dates; this checkpoint does not establish
three weeks of development.
