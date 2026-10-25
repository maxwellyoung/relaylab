# Windows smoke verification

Use Node 24.15 or later and the .NET SDK pinned in global.json. Build the Release
group lane before calling its DLL-based smoke directly.

```text
npm ci
npm run build:group
npm run verify:group
```

npm-run scripts default to cmd.exe on Windows. npm is not PowerShell, and npx
alone does not translate POSIX environment assignments. The SQL and browser
build commands now use the pinned cross-env dependency, so the environment is
set before the child command on either platform. Do not change firewall rules
to address a shell parsing error.

## Separate startup, execution and failure observation

The deliberate slow-run deadline remains 300 ms in both smoke fixtures, with a
900 ms slow job. Code 4 must still be classified as timeout; code 14 must still be
classified as unreachable. The assertions and same-key recovery checks remain.

Owned Node processes accept a relaylab-shutdown IPC request. The group launcher
also accepts relaylab-stop-runner, so the outage scenario requests the real
runner's graceful shutdown and waits for its actual exit. This makes shutdown
intent explicit on Windows, where SIGTERM otherwise terminates abruptly. The
runner flushes pending work and sends its gRPC shutdown before exiting. A
bounded force-stop remains for unresponsive fixtures. This exercises a stopped
service; it is not a claim that every abrupt crash is detected within 300 ms.

The supervisor has a longer teardown grace period than its children. The Node
coordinator understands the same IPC request, so a supervisor cannot exit first
and leave the API holding its output pipe open.

Coordinator health readiness has a separate 30 second startup budget with short
bounded probes. Spawn failure/child exit fails promptly; timeout diagnostics
include the last health response/error and bounded captured startup output.
This changes startup diagnostics, not the RPC deadline.

## Validation status

Six child-process/HTTP regression tests, the existing 109 workspace tests, types,
builds, real HTTP/review/gRPC smokes, both .NET adapters and .NET audit passed on
macOS. Eleven desktop/phone browser acceptance checks passed headlessly.

The Windows CI job runs verify:group on windows-latest for pull requests.
Check the current commit's CI result before describing the Windows report as
resolved; local macOS validation alone does not establish Windows compatibility.

Browser test fixtures currently use POSIX process groups; their documented
supported hosts remain macOS/Linux/WSL. The portable browser build prefix does
not certify the browser fixture itself for native Windows.

If a Windows run still fails, retain its exact command, Git/source version,
actual/expected assertion and complete coordinator startup error. Do not
silently skip failure checks or globally widen the RPC deadline.
