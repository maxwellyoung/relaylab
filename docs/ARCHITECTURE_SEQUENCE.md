# RelayLab — one request, end to end

Drop-in for the technical report sections 2 and 4 (communication flow). It
renders on GitHub and in Markdown surfaces that support Mermaid; otherwise
export it as an image before using it in the report.

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser (React client)
    participant C as Coordinator API (Express, REST/JSON)
    participant D as Downstream service (JSON-RPC 2.0)
    participant S as Store (SQLite / MySQL, pool ≤ 5)

    B->>C: POST /api/experiments {name, behavior, payload}
    C->>C: Zod validation (400 on invalid input)
    C->>S: INSERT experiments
    C-->>B: 201 {experiment}

    B->>C: POST /api/experiments/:id/runs
    C->>S: SELECT experiment (404 if missing)
    C->>D: JSON-RPC request {method: "relaylab.process.v1", id: correlationId, params}
    alt healthy
        D-->>C: {result, id}
    else downstream error / timeout / malformed / unreachable
        D--xC: error envelope, no response within timeout, bad shape, or connection refused
    end
    C->>C: classify outcome (success | downstream_error | timeout | invalid_response | unreachable)
    C->>S: INSERT experiment_runs {outcome, http_status, rpc_error_code, duration_ms, response_json}
    C-->>B: 201 {run}

    B->>C: GET /api/experiments/:id
    C->>S: SELECT experiment + runs (1 → many)
    C-->>B: 200 {experiment, runs[]}
```

Three processes, two protocols, one durable relationship:
`experiments 1 -> many experiment_runs`.
