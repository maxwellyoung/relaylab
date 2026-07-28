# AimLedger

AimLedger is a deliberately small CS2 practice tracker built for the COMP713
Option A individual project. It turns an unstructured play session into a
practice intention plus measurable drill evidence.

## Architecture

```text
React browser client (port 5173)
        |
        | JSON over HTTP
        v
Express API (port 3000)
        |
        | parameterised SQL through the repository
        v
SQLite database (data/aimledger.sqlite)
```

The client never accesses the database directly. Express owns HTTP routing and
validation; the repository owns table creation, SQL, row mapping, and the
session-to-results relationship.

An optional “How AimLedger stores this” disclosure exposes that path and the
latest HTTP receipt when it is useful for a demo. It stays out of the normal
practice flow. Accuracy is derived in the client from the persisted drill
attempts and successes; it is not stored as a second source of truth.

## Requirements

The frozen MVP contract is in
[`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md). Its five public behaviors are:

1. Create a practice session.
2. List practice sessions.
3. Open one session with its drill results.
4. Add a drill result to a session.
5. Return controlled errors for invalid input and missing resources.

## Software

- Node.js 24 or later
- npm 11 or later

No external database, account, API key, or cloud service is required.

## Install and run

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. The Vite development server proxies `/api`
requests to Express at <http://localhost:3000>.

The first run creates `data/aimledger.sqlite`. Override the data directory when
needed:

```bash
AIMLEDGER_DATA_DIR=/absolute/path/to/runtime-data npm run dev
```

The API port may be changed with `PORT`. If the client is not using the local
Vite proxy, set `VITE_API_BASE_URL` to the API origin before building it.

## Test and build

```bash
npm test
npm run typecheck
npm run build
```

The integration tests drive the public HTTP API and use isolated temporary
SQLite databases. They cover:

- create then list;
- invalid session duration;
- session-to-result persistence;
- result counts where successes exceed attempts;
- a result linked to a missing session;
- data retained after closing and reopening the application.

## API

| Method | Route | Behavior |
| --- | --- | --- |
| `POST` | `/api/sessions` | Validate and create a practice session |
| `GET` | `/api/sessions` | List sessions newest first |
| `GET` | `/api/sessions/:id` | Return one session and its drill results |
| `POST` | `/api/sessions/:id/results` | Validate and add related drill evidence |

Example session:

```json
{
  "playedAt": "2026-07-28",
  "map": "Dust II",
  "goal": "Practise one clean counter-strafe block",
  "durationMinutes": 20
}
```

## Known limitations

- One local user only; authentication is deliberately outside the assignment
  scope.
- Map names are free text and are not sourced from Steam.
- Sessions and results cannot yet be edited or deleted.
- The client currently relies on API integration tests plus type/build checks;
  its core plan/select/prove flow has been manually exercised in the browser,
  while automated browser tests remain a later milestone.
- The application has not been deployed and does not need deployment for this
  milestone.

## Project evidence

Development decisions and red-green milestones are recorded in
[`docs/DEVELOPMENT_LOG.md`](docs/DEVELOPMENT_LOG.md).
