# Get a review through the system

The goal is one saved run, one review decision, and feedback visible to the researcher. You can do it locally with two browser tabs.

## Start the group lane

Use Node 24.15 or later and the .NET SDK pinned in `global.json`. Run these commands from the repository root:

```bash
npm ci
npm run build:group
npm run start:group
```

Open http://localhost:3000. The launcher starts the Node runner first, waits for readiness, and starts the .NET coordinator. The coordinator serves the built browser client, so source changes need a new client build before they appear here.

If the SDK is not found, follow `docs/DOTNET_COORDINATOR.md`. If port 3000 is occupied, choose a free local port:

```bash
PORT=3128 RUNNER_PORT=50128 npm run start:group
```

## Create and submit evidence

1. Select Researcher A under Demo identity. Open Experiments in the sidebar.
2. Choose Healthy and click Run experiment. Expect a success receipt with timing and response evidence.
3. Open Run reviews. Submit the selected run for review. Expect Pending review.
4. Open a second tab, select Reviewer, and refresh the queue.
5. Open the submitted receipt. Inspect its evidence, write useful feedback and approve or reject it.
6. Return to the researcher tab and refresh reviews. Expect the saved decision and the same feedback.

Repeat with Slow. A timeout receipt can be approved as evidence of a working deadline. Neither approval nor rejection changes the recorded execution outcome.

## Inspect persistence

Default coordinator data is in `data/group/coordinator/relaylab.sqlite`; the independent runner ledger is in `data/group/runner/runner.sqlite`. `RELAYLAB_GROUP_DATA_DIR` changes the root. Open copies in DB Browser for SQLite if you want to inspect without interacting with the live files.

In the coordinator, inspect `experiments`, `experiment_runs` and `run_reviews`. In the runner, inspect `executions`. Restart the launcher and choose a demo role again: the token is gone, but saved runs and decisions remain.

Do not put database files, session tokens or real personal data into a commit. Use synthetic examples for screenshots and demonstrations.

## Make one change safely

Create a branch from current main and choose one small acceptance criterion. Follow the existing client/API contract. For browser changes, start with:

```bash
npm run test -w client
npm run typecheck -w client
npm run build -w client
```

Before integration, run `npm run verify:group`. Android work has its own commands in `docs/ANDROID_REVIEWER.md`. Keep commits about actual working slices: “Preserve feedback draft while switching review views” describes a reviewable behavior; “updates” does not.

## Read the next layer

Open How it works in the app for the illustrated explanation. Its source is `docs/HOW_IT_WORKS.md`, so documentation edits update both GitHub and the app after a build. Exact API fields are in `docs/openapi.json`; team contribution boundaries are in `docs/TEAM_HANDOFF.md`.
