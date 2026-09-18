# RelayLab MVP requirements

## Official brief alignment

The 28 July 2026 COMP713 Assessment 2 brief defines Option A as a small,
complete distributed web/API application. RelayLab maps to its indicative size
without adding speculative scope:

| Brief requirement | RelayLab evidence |
| --- | --- |
| One simple client | One React experiment screen |
| Server-side API/service layer | Express coordinator API |
| At least three meaningful API operations | Create, list, read details, run, and delete |
| Simple data persistence | SQLite locally/tests or lecturer MySQL |
| At least two related entities | `experiments` and `experiment_runs` |
| Relationship or meaningful workflow | One experiment produces many durable runs |
| Validation and failed-request handling | Zod input checks plus classified downstream failures |
| Clear run and test instructions | README plus `npm run verify` |

The brief permits basic CRUD **or another meaningful workflow**. RelayLab uses
the latter: create a request definition, execute it across a second service,
classify the exchange, and read the durable evidence. Delete is also
implemented, so an experiment and its runs can be removed together; update is
outside the frozen scope unless the lecturer explicitly requires it later.

## Scenario

A developer wants to see what actually happens when an API dependency is
healthy, slow, malformed, or unavailable. They save a small request experiment,
run it through a coordinator service, and inspect the durable outcome.

## Public behaviors

1. Create an experiment with a name, downstream behavior, and JSON payload.
2. List saved experiments and open one with its previous runs.
3. Run an experiment through a separately running JSON-RPC service.
4. Persist the observed status, HTTP code, duration, and RPC envelope for every run.
5. Distinguish healthy, downstream-error, timeout, malformed-response, and
   unreachable outcomes.
6. Reject invalid experiment input and missing resources with controlled HTTP
   errors.

## Data relationship

```text
experiments 1 -> many experiment_runs
```

The run foreign key is the rubric-visible relationship between the saved
request definition and the evidence produced by each distributed exchange.

## Scope boundary

Included:

- separate browser client, coordinator API, and downstream-service processes;
- relational persistence through SQLite locally or the lecturer-provided MySQL
  schema;
- REST/JSON between browser and coordinator, then JSON-RPC 2.0 between services;
- a versioned RPC method and correlation-ID validation;
- bounded timeout and response-shape validation;
- controlled downstream failures;
- automated API behavior tests;
- a simple one-action interface with an optional technical trace.

Excluded:

- accounts or authentication;
- deployment;
- arbitrary external URLs;
- automatic retries, queues, or circuit breakers;
- production monitoring or load testing.

## Done for the first milestone

- The public behaviors work through the coordinator API.
- The browser completes the create/run/review workflow.
- A restart retains experiments and runs.
- The downstream service can deterministically demonstrate success and failure.
- Tests, type checking, and production builds pass.
- Maxwell can trace one request across REST, JSON-RPC, and relational persistence.

## Lecturer database lane

- MySQL is enabled only through local environment configuration.
- The application creates and uses the same two related entities in the
  lecturer-assigned schema.
- The MySQL pool is hard-limited to five connections in application code.
- No username, password, or schema credential belongs in Git history.
- SQLite remains the deterministic offline and automated-test lane.
