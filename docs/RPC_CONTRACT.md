# RelayLab downstream RPC contract

The browser-facing API remains RESTful. Only the coordinator calls the private
downstream endpoint `POST /rpc` using JSON-RPC 2.0.

## Versioned method

`relaylab.process.v1`

## Request

```json
{
  "jsonrpc": "2.0",
  "id": "1e9f0f1d-4e02-4e51-b9d4-22ccfa18ef08",
  "method": "relaylab.process.v1",
  "params": {
    "experimentId": 42,
    "behavior": "healthy",
    "payload": { "orderId": "ORDER-42", "quantity": 2 }
  }
}
```

The coordinator generates the UUID. A response is valid only when its `id`
matches the request and its result matches the method-specific schema.

## Successful result

```json
{
  "jsonrpc": "2.0",
  "id": "1e9f0f1d-4e02-4e51-b9d4-22ccfa18ef08",
  "result": {
    "accepted": true,
    "experimentId": 42,
    "echo": { "orderId": "ORDER-42", "quantity": 2 },
    "processedAt": "2026-08-11T01:00:00.000Z"
  }
}
```

## Errors

| Code | Meaning | Coordinator classification |
| --- | --- | --- |
| `-32600` | Invalid JSON-RPC request envelope | `downstream_error` |
| `-32601` | Method not found | `downstream_error` |
| `-32602` | Invalid method parameters | `downstream_error` |
| `-32001` | Simulated dependency unavailable | `downstream_error` |

JSON-RPC method errors can travel over a successful HTTP `200` response. The
interface therefore presents HTTP transport and RPC outcome separately. An
invalid envelope, wrong correlation ID, or wrong result shape becomes
`invalid_response`. A deadline or connection failure remains `timeout` or
`unreachable` because no valid RPC response was received.
