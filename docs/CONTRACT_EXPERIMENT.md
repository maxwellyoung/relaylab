# Public contract compatibility experiment

This exercise applies the service-interface lecture to RelayLab's existing
boundary without redesigning the assessment project.

## Boundary under test

The React client may depend on:

- the resource URIs under `/api/experiments`;
- the HTTP methods and documented status codes;
- the required JSON fields and stable error shape.

It must not depend on the coordinator's JavaScript classes, JSON-RPC messages,
repository functions, SQLite/MySQL tables, or other private implementation
details. The machine-readable browser contract is [`openapi.json`](openapi.json).

## Predict before running

Write down the predicted outcome before executing the check:

1. What will the V1 client do when the server adds the unknown `summary` field?
2. What will it do when required `name` is replaced by `displayName`?

## Run

```bash
npm run test:contract
```

The fixtures are deliberately small:

- [`experiment-v1.json`](contract-fixtures/experiment-v1.json) is the baseline;
- [`experiment-v1-additive.json`](contract-fixtures/experiment-v1-additive.json)
  adds one optional field;
- [`experiment-v1-breaking.json`](contract-fixtures/experiment-v1-breaking.json)
  renames one required field.

The compatibility check uses the old V1 decoder against all three responses.
It also checks that OpenAPI documents exactly the five frozen resource
operations and their success/error status codes.

## Student-owned interpretation

After the run, record the observed output and explain why the additive fixture
is or is not compatible, why the renamed required field is or is not breaking,
and which RelayLab details remain private. The automated test supplies evidence;
it does not supply the assessed explanation.
