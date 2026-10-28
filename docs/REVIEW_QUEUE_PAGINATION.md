# Review queue filtering and pagination (issue #2)

Implementation scope: the ASP.NET Core coordinator and both coordinator-owned SQLite adapters. The runner, Node coordinator, browser and Android clients are unchanged.

## API contract

The existing `GET /api/reviews` endpoint **continues to return a JSON array of complete review records** (including run evidence) in pending-first / descending review ID order. It still requires a demo-session bearer token; existing web and Android callers need not change.

Optional query parameters:

| Parameter | Meaning |
|---|---|
| `status` | Exact lowercase `pending`, `approved` or `rejected`; absent = all visible statuses |
| `page` | 1-based positive integer; must appear with `pageSize` |
| `pageSize` | Integer from 1 to 100; must appear with `page` |

Example:

```http
GET /api/reviews?status=pending&page=1&pageSize=25
Authorization: Bearer <demo-session-token>
```

The response remains the same **array**, containing at most 25 full review records. There is no new envelope or total-count metadata. A page with fewer than `pageSize` rows is the last page; when the final page has exactly `pageSize` items, clients can request another page to observe an empty array. An out-of-range page returns `[]`. Optional `status` can be used by itself without paging (filtered but unbounded).

`page` and `pageSize` must either both appear or both be absent. Unsupported statuses, malformed/zero/negative page numbers, sizes outside 1–100 and offsets outside the supported integer range return HTTP 400 JSON `{ "error": "..." }`.

The researcher restriction comes **only** from the actor's session; callers cannot request someone else's researcher ID. Visibility filtering, then optional status filtering, then ordering, then paging are all performed in SQLite before returning the result. The EF and direct-SQL adapters implement matching behavior.

**Concurrent changes:** offset pagination does not provide a snapshot across HTTP requests. A newly submitted review or a status change can move entries between pages, producing duplicates or omissions during navigation. Clients should refresh from page 1 after submissions/decisions or when they detect a stale queue. Strong snapshot/cursor semantics are beyond this issue's agreed scope.

## Verification

Prerequisites: Node 24.15+, project dependencies installed (`npm ci`), and the .NET 10 SDK specified in `global.json`. From the repository root:

```bash
npm run build:dotnet
npm run smoke:dotnet:queue
```

`smoke:dotnet:queue` starts the **real .NET HTTP coordinator** twice (EF then SQL), using two disposable seeded SQLite files and **no gRPC runner**. It checks unauthenticated requests, demo sessions, legacy list contract and nested run data, all three statuses, actor visibility, page traversal, final/empty pages, invalid inputs, 20 concurrent readers, and adapter result parity. It also changes a pending review to approved between page requests and asserts the resulting offset-page omission and refreshed first page. It deletes temporary data and processes afterward.

The existing narrower baseline can also be run independently:

```bash
node scripts/smoke-dotnet.mjs --crud
RELAYLAB_PERSISTENCE_ADAPTER=sql node scripts/smoke-dotnet.mjs --crud  # Git Bash
```

The original full `smoke:dotnet` includes gRPC runner tests. In prior Windows results it failed at `scripts/smoke-dotnet.mjs:118` because a stopped runner returned `timeout` rather than the asserted `unreachable`. **Do not treat queue-test success as resolving this unrelated defect.** Previous `verify:group` runs also encountered `npm audit` findings. Report these separately as existing baseline limitations, not failures caused by paging.

## Reproducible .NET HTTP benchmark

After `npm ci` and `npm run build:dotnet`:

```bash
npm run bench:dotnet:queue -- --reviews=1000,10000 --clients=1,10,25 --samples=100 --warmup=20 --adapter=ef --pageSize=25 --revision=local-uncommitted
```

To benchmark both persistence implementations, set `--adapter=both`. Each dataset is **synthetic**, deterministic, and isolated in a temporary directory. For each adapter and dataset, the script exercises the original unbounded response and the opt-in first page over the same data. Every measured HTTP request records elapsed wall-clock duration, response bytes, status and errors. JSON includes p50/p95 (nearest-rank, successful requests only), completed requests/s, error counts, environment information and workload settings. CSV preserves individual observations. Output files are under `benchmarks/results/` by default. **This repository's existing `.gitignore` does not exclude that directory**, so add it to your local `.git/info/exclude` or `.gitignore` before staging changes. Include selected anonymized results in your submission evidence if appropriate.

A target should ideally be agreed and justified **before** a benchmark run. The existing project documents a **500 ms local queue-refresh target** for a much smaller warm loopback workload (`docs/GROUP_WORKFLOW.md`); it is a defensible **proposed demonstration threshold**, not a production SLA. The initial measurements below were collected *without* a target, so adopting 500 ms afterward must be disclosed as post-hoc. Use `--targetMs=500` for a confirmatory run if the team accepts this threshold. The script evaluates the threshold **only for paginated responses**, reporting `meetsTarget: null` for intentionally unbounded legacy responses. No target is assumed by default. Keep the data distribution, environment, number of samples and concurrency consistent across comparisons. Do not confuse the gRPC runner deadline with HTTP queue response time.

**Methodology cautions:** Requests are real HTTP calls to loopback, dispatched through up to N concurrent Node workers; each worker waits for its current response before issuing the next. The script uses 20 sequential warm-ups per endpoint by default, then measures a fixed number of requests. `p50Ms`/`p95Ms` use nearest-rank percentiles of *successful* requests, while `failures` is reported separately; throughput is measured requests divided by scenario elapsed seconds. Endpoint order now alternates across scenarios to reduce a systematic second-run advantage, but repeated runs are still needed. Very short measurements (under a second) produce unstable throughput estimates. The test is a single-process, local, synthetic SQLite workload; it does not measure database-only latency, resource utilization, real-user network time or multi-process scalability.

**Interpretation:** the original and paged endpoints intentionally return different numbers of records. A smaller response size demonstrates bounded data transfer, not necessarily an improvement in same-work algorithmic throughput. Neither endpoint's benchmark alone measures database-only execution time or C# allocations. Investigate generated SQL and `EXPLAIN QUERY PLAN` before adding indexes or rewriting projections. EF materializes the page's existing full `Review` shape to preserve compatibility; a lightweight summary DTO would be a separate API-contract change.

## Evidence for issue/PR and Assessment 3

Record the real local date/time, current branch and base commit, a note that changes are uncommitted until reviewed, test commands and outputs, observed dataset sizes, latency numbers, environment and failures. Do not label an unexecuted test as passing. Run both the queue-specific checks and available broader regression checks before proposing a merge. Do not falsify earlier commit/checkpoint dates.

| Component | What changed | Evidence to collect |
|---|---|---|
| Controller & validation | Optional, validated query parameters | HTTP invalid-input/legacy checks |
| Service | Preserved existing actor-based visibility | Researcher A/B and reviewer tests |
| EF repository | Applied SQL-side status/paging before materialization | Full queue test; SQL inspection |
| Direct-SQL repository | Parameterized equivalent SQL | Adapter parity checks |
| Test harness | Seeded real-HTTP isolated scenarios | `smoke:dotnet:queue` output |
| Benchmark | Synthetic concurrent HTTP workload | JSON/CSV results and limitations |

## Observed local results — 28 October 2026

### Confirmatory run

The latest confirmatory run was reported on Windows with .NET SDK 10.0.402,
10,000 reviews, 10 concurrent clients, 300 measured requests per scenario and
30 warm-ups per scenario. The four scenarios (two adapters by legacy/page-25)
therefore comprise **1,200 measured requests**. The reported run had zero
failures.

| Adapter | Reviews | Concurrent clients | Legacy p95 (ms) | Page of 25 p95 (ms) |
|---|---:|---:|---:|---:|
| EF Core | 10,000 | 10 | 517.46 | 26.65 |
| Direct SQLite | 10,000 | 10 | 915.19 | 86.80 |

Both adapters met the proposed page-25 p95-under-500-ms threshold in this
reported local run. The legacy endpoint is not subject to that target. These
are user-reported local measurements, not independently rerun here or
production performance guarantees. The supplied summary did not include
machine CPU/OS build, Node version, p50, throughput, response sizes, or generated
JSON/CSV filenames; retain the benchmark output and record those details with
the assessment evidence when available.

### Earlier 100-sample run

Evidence: user-executed `npm run bench:dotnet:queue -- --reviews=1000,10000 --clients=1,10 --samples=100 --adapter=both --revision=local-uncommitted`. There were 16 scenarios, each with 20 warm-up calls and 100 measured calls: **1,600/1,600 successful measured requests**, zero reported failures. The following values were copied from the actual local JSON/terminal output rather than generated or independently rerun here.

| Adapter | Reviews | Concurrent clients | Legacy p95 (ms) | Page of 25 p95 (ms) |
|---|---:|---:|---:|---:|
| EF Core | 1,000 | 1 | 29.85 | 5.49 |
| EF Core | 1,000 | 10 | 75.31 | 9.16 |
| EF Core | 10,000 | 1 | 138.25 | 11.98 |
| EF Core | 10,000 | 10 | 549.42 | 20.65 |
| Direct SQLite | 1,000 | 1 | 26.94 | 2.30 |
| Direct SQLite | 1,000 | 10 | 82.44 | 9.18 |
| Direct SQLite | 10,000 | 1 | 130.97 | 10.21 |
| Direct SQLite | 10,000 | 10 | 993.29 | 80.80 |

At 10,000 reviews, a legacy response was **5,709,296 bytes** versus **13,451 bytes** for page 1 of 25. This demonstrates an approximately 424-fold reduction in returned bytes, not a 424-fold isolated database speedup. Under 10 concurrent clients, EF p95 changed from **549.42 ms to 20.65 ms**, and direct SQL from **993.29 ms to 80.80 ms**. Direct SQL's higher p95 under concurrency is an observation; shared-connection locking is a hypothesis, not an established cause.

**Validity and target:** The earlier run did not configure `--targetMs`; its `targetMs` and `meetsTarget` fields correctly remain `null`. The 500 ms proposal is therefore **post-hoc** for those observations. The confirmatory run above provides a separate reported result for the representative 10,000-review, 10-client workload, with the updated script's alternating endpoint order. The results are still one local run; repeat independently to assess variation. Do not average p95 values as if they were individual request times.

```bash
npm run bench:dotnet:queue -- --reviews=10000 --clients=10 --samples=300 --warmup=30 --adapter=both --pageSize=25 --targetMs=500 --revision=local-uncommitted
```

The benchmark script marks the threshold as met only when there are no failed
requests and p95 is at or below the configured target; the supplied p95 values
are strictly below 500 ms either way. Record the generated CSV and JSON
filenames, full `environment` values, and exact run time with the final evidence.

## Staging / local generated-file hygiene

Keep benchmark CSV/JSON in your assessment evidence directory, but avoid accidentally staging them, a local .NET installer or a source ZIP. Since the existing `.gitignore` had a conflict with earlier changes, a **local-only** exclusion is sufficient without changing the tracked `.gitignore`:

```bash
printf '\n/benchmarks/results/\n/dotnet-install.ps1\n/relaylab-source.zip\n' >> "$(git rev-parse --git-path info/exclude)"
git status --short
git diff --check
```

This adjusts only `.git/info/exclude` in your local clone and **does not delete** any files. When staging eventually becomes appropriate, name the intended paths explicitly instead of using `git add .`. For example:

```bash
git add README.md docs/openapi.json docs/REVIEW_QUEUE_PAGINATION.md package.json \
  coordinator-dotnet/Controllers/ReviewsController.cs \
  coordinator-dotnet/Data/EfRepository.cs coordinator-dotnet/Data/ICoordinatorRepository.cs \
  coordinator-dotnet/Data/SqliteRepository.cs coordinator-dotnet/Models/ReviewListOptions.cs \
  coordinator-dotnet/Services/ReviewService.cs \
  scripts/smoke-dotnet-queue.mjs scripts/benchmark-dotnet-queue.mjs
git diff --cached --check
git diff --cached --stat
```

Staging is not committing, but do not stage until the final review and team handoff are ready.
