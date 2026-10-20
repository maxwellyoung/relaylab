# Browser acceptance tests

These tests open the built browser client and exercise the real ASP.NET Core
coordinator, EF SQLite persistence and separate gRPC runner. Each test gets
empty temporary databases, unused loopback ports and independent browser
contexts for its demo identities. It never reuses the normal preview.

## Run locally

Use the Node and .NET prerequisites from the root README. Run the harness on
macOS, Linux or WSL; service cleanup uses POSIX process groups. From the repo
root:

```bash
npm ci
npx playwright install chromium
npm run test:browser
```

The command builds the group lane before running the tests. It forces the web
API base URL to the local origin during this build. The fixture verifies the
coordinator implementation, persistence adapter and empty experiment store
before opening any workflow. Setup failures fail the test rather than falling
back to an already-running application.

Each test owns a detached supervisor/service process group. Teardown stops
that group and removes its temporary databases. The existing preview and its
records are outside this lifecycle. A startup port collision fails safely;
the tests never terminate an unknown process to obtain a port.

For another run after a successful build:

```bash
npx playwright test
```

## Covered workflows

- Researcher creates, executes and submits a run through the web UI.
- Reviewer approves with required feedback in another browser context.
- Researcher refreshes and sees the saved decision and the same execution
  outcome. This models selectable local demo identities, not password accounts.
- Empty reviewer feedback is rejected; rejection of a slow run retains its
  timeout outcome and displays the saved explanation to the researcher.
- Researcher review lists remain separate, while the reviewer sees both
  submissions. Experiment recipes remain shared as documented.
- Browser network loss keeps draft feedback editable and decisions disabled
  until a successful refresh; receipt changes and guide navigation retain drafts.
- A real competing reviewer decision produces a conflict and loads the saved
  winner instead of overwriting it.

Both desktop (1280 x 800) and phone (320 x 740) Chromium projects run the five
workflow scenarios. A phone-only case also checks invalid JSON, keyboard
selection, focus return, filtered empty state, page overflow and reachable
44-pixel decision controls. There are 11 acceptance checks in one normal run.
The desktop and phone contexts use reduced motion.

To select one viewport or check repeatability after a build:

```bash
npx playwright test --project=phone
npx playwright test --repeat-each=5
```

## Evidence and limits

The HTML report and per-test evidence are under ignored
`output/playwright/report/` and `output/playwright/results/`. Failures retain
screenshots, a trace and bounded service logs. A successful handoff also saves
a researcher receipt screenshot. To inspect a trace, run:

```bash
npx playwright show-trace path/to/trace.zip
```

Evidence contains synthetic data and temporary demo sessions. Keep raw traces,
databases and logs outside Git; run this suite only against its disposable
fixture, not private accounts or shared data. Browser automation is separate
from physical Android, performance benchmarking and the teammate queue/draft
work. Network loss is injected with browser offline mode; it is not proof of a
server-process crash. A controlled SIGINT check also verified that Playwright
cancellation stops its service and removes the temporary stores.
Store removal also runs when writing failure diagnostics throws; a controlled
attachment failure verified this cleanup path.

## CI

The verification workflow includes a dedicated browser job. It installs the
pinned Playwright Chromium build and Linux dependencies, builds the group lane
and runs `npm run test:browser`. The existing Node, .NET, MySQL and Android jobs
remain separate. The browser job uploads its synthetic report/screenshots and
failure traces for five days when the run is not cancelled.

This job configuration is source until it has run on a pushed branch or PR.
The acceptance suite is an explicit command; `verify:group` retains its existing
non-browser checks. Phone checks are Chromium emulation, separate from native
Android and other browser engines.

The per-test service/context lifecycle follows [Playwright test fixtures](https://playwright.dev/docs/test-fixtures).
