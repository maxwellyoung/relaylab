# RelayLab working agreement

RelayLab is Maxwell's fresh COMP713 individual-project workspace.

## Assessment boundary

- Build a small Option A distributed web/API application that Maxwell can run,
  test, and explain.
- Do not copy application code from Maxwell's previous projects or from the
  COMP713 reference apps.
- Keep requirements, tests, evidence, and implementation status honest.
- Do not submit to Canvas, make the academic-integrity declaration, or publish
  a repository without Maxwell's explicit current approval.
- Never commit secrets, real account credentials, private match data, or raw
  personal telemetry.

## Engineering loop

- Use vertical red-green-refactor slices.
- Test behavior through the public HTTP API.
- Keep the architecture explicit: browser client -> coordinator API ->
  downstream service, with experiment/run evidence persisted in SQLite.
- Prefer the smallest reliable implementation over authentication, external
  APIs, deployment, or speculative analytics.
- Run `npm test`, `npm run typecheck`, and `npm run build` before describing a
  milestone as complete.

## Evidence

- Record meaningful development milestones in `docs/DEVELOPMENT_LOG.md`.
- Make small commits with understandable messages.
- Connect each milestone to the COMP713 rubric without manufacturing history.
