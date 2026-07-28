# AimLedger MVP requirements

## Scenario

A CS2 player wants to turn an unstructured play session into deliberate
practice. They create a practice session, record drill results, and review what
they actually worked on.

## Public behaviors

1. Create a practice session with a date, map, goal, and duration.
2. List recorded practice sessions.
3. Open one session and see its related drill results.
4. Add a drill result containing its name, attempts, successes, and an optional
   note.
5. Reject invalid input and references to missing resources with controlled HTTP
   errors.

## Data relationship

```text
practice_sessions 1 -> many drill_results
```

The drill-result foreign key is the rubric-visible relationship between the two
persistent entities.

## Scope boundary

Included:

- separate browser client and API processes;
- SQLite persistence;
- public JSON API;
- validation and controlled errors;
- automated API behavior tests;
- simple readable interface.

Excluded:

- accounts or authentication;
- Steam or third-party APIs;
- matchmaking imports;
- deployment;
- social features;
- advanced statistics or recommendations.

## Done for the first milestone

- The five public behaviors work through the API.
- The browser completes the create/list/detail/add-result workflow.
- A restart retains stored sessions and results.
- Tests, type checking, and production builds pass.
- Maxwell can trace one request from client to database and back.
