import { useState } from "react";
import { getRunnerExecution, type RunnerExecution } from "./api";

export default function RunnerExecutionStatus({ runId, disabled }: { runId: number; disabled: boolean }) {
  const [execution, setExecution] = useState<RunnerExecution | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function check() {
    if (busy || disabled) return;
    setBusy(true); setError("");
    try { setExecution(await getRunnerExecution(runId)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to inspect runner execution"); }
    finally { setBusy(false); }
  }
  return <div className="runner-inspection">
    <button type="button" disabled={disabled || busy} onClick={() => void check()}>{busy ? "Checking runner…" : "Check runner execution"}</button>
    <div role="status">
      {execution && <>
        <p>{error ? "Last retrieved runner state" : "Runner state"}: {execution.state}{execution.outcome ? ` · ${execution.outcome}` : ""}</p>
        <p>The recorded attempt above stays unchanged.</p>
        <p>Execution ID: <code>{execution.executionId}</code></p>
        <details><summary>Runner-owned evidence</summary><pre>{execution.resultJson || "The execution has not completed."}</pre></details>
      </>}
    </div>
    {error && <p role="alert">{error}</p>}
  </div>;
}
