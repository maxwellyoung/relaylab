# RelayLab MVP requirements

## Scenario

A developer wants to see what actually happens when an API dependency is
healthy, slow, malformed, or unavailable. They save a small request experiment,
run it through a coordinator service, and inspect the durable outcome.

## Public behaviors

1. Create an experiment with a name, downstream behavior, and JSON payload.
2. List saved experiments and open one with its previous runs.
3. Run an experiment through a separately running downstream service.
4. Persist the observed status, HTTP code, duration, and response for every run.
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
- SQLite persistence;
- JSON request/response exchange;
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
- Maxwell can trace one request across both HTTP boundaries and into SQLite.
