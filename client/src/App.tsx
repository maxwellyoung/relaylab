import { useEffect, useMemo, useState } from "react";
import {
  createExperiment,
  getExperiment,
  listExperiments,
  deleteExperiment,
  runExperiment,
  type Experiment,
  type ExperimentBehavior,
  type ExperimentDetails,
  type ExperimentRun,
  type RunOutcome,
} from "./api";

const behaviorCopy: Record<
  ExperimentBehavior,
  { label: string; signal: string; description: string }
> = {
  healthy: {
    label: "Healthy",
    signal: "Valid 200",
    description: "The dependency accepts the payload and returns valid JSON.",
  },
  slow: {
    label: "Slow",
    signal: "Deadline exceeded",
    description: "The dependency responds after the coordinator gives up.",
  },
  unavailable: {
    label: "Unavailable",
    signal: "RPC error −32001",
    description: "The transport succeeds, but the RPC method returns an application error.",
  },
  malformed: {
    label: "Malformed",
    signal: "Invalid RPC result",
    description: "The dependency returns a JSON-RPC result with the wrong method shape.",
  },
};

const outcomeCopy: Record<
  RunOutcome,
  { label: string; explanation: string; tone: "good" | "warn" | "bad" }
> = {
  success: {
    label: "Request completed",
    explanation: "The JSON-RPC result matched the method contract and correlation id.",
    tone: "good",
  },
  downstream_error: {
    label: "RPC method failed",
    explanation: "HTTP transport succeeded; the dependency returned a correlated RPC error.",
    tone: "bad",
  },
  timeout: {
    label: "Deadline exceeded",
    explanation: "The coordinator stopped waiting, classified the timeout, and kept the attempt.",
    tone: "warn",
  },
  invalid_response: {
    label: "Contract rejected",
    explanation: "The service answered, but its RPC envelope or method result failed validation.",
    tone: "warn",
  },
  unreachable: {
    label: "Dependency unreachable",
    explanation: "The TCP connection failed without taking down the coordinator.",
    tone: "bad",
  },
};

const defaultPayload = `{
  "orderId": "ORDER-42",
  "quantity": 2
}`;

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-NZ", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value.endsWith("Z") ? value : `${value}Z`));
}

function responseText(run: ExperimentRun) {
  if (run.response === null) return "No response body was received.";
  return typeof run.response === "string"
    ? run.response
    : JSON.stringify(run.response, null, 2);
}

function rpcSignal(run: ExperimentRun) {
  // The coordinator classifies and stores the code; do not re-derive it.
  if (typeof run.rpcErrorCode === "number") {
    return String(run.rpcErrorCode).replace("-", "−");
  }
  if (run.outcome === "invalid_response") return "invalid";
  if (!run.response || typeof run.response !== "object") return "—";
  const envelope = run.response as {
    jsonrpc?: unknown;
    result?: unknown;
    error?: { code?: unknown };
  };
  if (envelope.jsonrpc !== "2.0") return "invalid";
  if (typeof envelope.error?.code === "number") {
    return String(envelope.error.code).replace("-", "−");
  }
  return "result" in envelope ? "result" : "invalid";
}

export default function App() {
  const [behavior, setBehavior] = useState<ExperimentBehavior>("healthy");
  const [payloadText, setPayloadText] = useState(defaultPayload);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [selected, setSelected] = useState<ExperimentDetails | null>(null);
  const [latestRun, setLatestRun] = useState<ExperimentRun | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const isBusy = isRunning || isLoading;
  const [error, setError] = useState("");

  const currentOutcome = latestRun ? outcomeCopy[latestRun.outcome] : null;
  const runCount = useMemo(
    () => selected?.runs.length ?? 0,
    [selected?.runs.length],
  );

  useEffect(() => {
    void loadInitialState();
  }, []);

  async function loadInitialState() {
    try {
      const nextExperiments = await listExperiments();
      setExperiments(nextExperiments);
      if (nextExperiments[0]) {
        const details = await getExperiment(nextExperiments[0].id);
        selectDetails(details);
      }
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to load experiments",
      );
    } finally {
      setIsLoading(false);
    }
  }

  function selectDetails(details: ExperimentDetails) {
    setSelected(details);
    setBehavior(details.behavior);
    setPayloadText(JSON.stringify(details.payload, null, 2));
    setLatestRun(details.runs[0] ?? null);
  }

  function chooseBehavior(nextBehavior: ExperimentBehavior) {
    setBehavior(nextBehavior);
    setSelected(null);
    setLatestRun(null);
    setError("");
  }

  async function openExperiment(experimentId: number) {
    if (isBusy) return;
    setIsLoading(true);
    setError("");
    try {
      selectDetails(await getExperiment(experimentId));
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to load experiment",
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function removeExperiment(experimentId: number, name: string) {
    if (isBusy) return;
    const confirmed = window.confirm(
      `Delete "${name}" and every run saved against it? This cannot be undone.`,
    );
    if (!confirmed) return;
    setError("");
    setIsLoading(true);
    try {
      await deleteExperiment(experimentId);
      const remaining = await listExperiments();
      setExperiments(remaining);
      if (selected?.id === experimentId) {
        setSelected(null);
        setLatestRun(null);
      }
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to delete experiment",
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function execute() {
    if (isBusy) return;
    setError("");

    let payload: Record<string, unknown>;
    try {
      const parsed = JSON.parse(payloadText) as unknown;
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
        throw new Error("Payload must be a JSON object.");
      }
      payload = parsed as Record<string, unknown>;
    } catch {
      setError("Payload must be a valid JSON object.");
      return;
    }

    setIsRunning(true);
    try {
      const experiment =
        selected ??
        (await createExperiment({
          name: `${behaviorCopy[behavior].label} dependency`,
          behavior,
          payload,
        }));
      const run = await runExperiment(experiment.id);
      const [details, nextExperiments] = await Promise.all([
        getExperiment(experiment.id),
        listExperiments(),
      ]);
      setSelected(details);
      setLatestRun(run);
      setExperiments(nextExperiments);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to run experiment",
      );
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <main id="main-content">
      <header className="topbar">
        <a href="#main-content" aria-label="RelayLab home">
          RelayLab
        </a>
        <p>Distributed communication demo</p>
      </header>

      <section
        className={`lab ${isRunning ? "running" : ""}`}
        aria-labelledby="lab-title"
      >
        <header className="lab-heading">
          <h1 id="lab-title">Run a dependency failure experiment</h1>
          <p>
            Send one request through an Express coordinator to a separate
            service. The result is stored in the configured relational database.
          </p>
        </header>

        {error ? (
          <div className="error-message" role="alert">
            <strong>Couldn’t run that.</strong>
            <span>{error}</span>
          </div>
        ) : null}

        <div className="experiment-controls">
          <label className="behavior-control">
            <span>Dependency behavior</span>
            <select
              disabled={isBusy}
              value={behavior}
              onChange={(event) =>
                chooseBehavior(event.target.value as ExperimentBehavior)
              }
            >
              {(Object.keys(behaviorCopy) as ExperimentBehavior[]).map(
                (option) => (
                  <option key={option} value={option}>
                    {behaviorCopy[option].label} —{" "}
                    {behaviorCopy[option].signal}
                  </option>
                ),
              )}
            </select>
          </label>

          <details className="request-details">
            <summary>Edit request payload</summary>
            <label>
              <span className="sr-only">JSON request payload</span>
              <textarea
                disabled={isBusy}
                aria-label="JSON request payload"
                value={payloadText}
                onChange={(event) => {
                  setPayloadText(event.target.value);
                  setSelected(null);
                  setLatestRun(null);
                  setError("");
                }}
                spellCheck="false"
              />
            </label>
          </details>

          <button
            className="run-button"
            disabled={isBusy}
            onClick={() => void execute()}
            type="button"
          >
            {isLoading ? "Loading…" : isRunning ? "Running…" : selected ? "Run again" : "Run experiment"}
          </button>

          {!selected && experiments.length > 0 ? (
            <p className="fork-hint">
              Nothing is selected, so running saves a new experiment.
            </p>
          ) : null}
        </div>

        <p className="behavior-description">
          {behaviorCopy[behavior].description}
        </p>

        <section className="trace" aria-label="Distributed request trace">
          <h2>Request path</h2>
          <ol
            className={`route ${latestRun?.outcome ?? ""}`}
            aria-label="Distributed request path"
          >
            <li className="route-node browser-node">
              <div>
                <strong>Browser</strong>
                <small>POST experiment run</small>
              </div>
            </li>
            <li className="route-line" aria-hidden="true">
              →
            </li>
            <li className="route-node coordinator-node">
              <div>
                <strong>Coordinator</strong>
                <small>JSON-RPC 2.0 · 400 ms deadline</small>
              </div>
            </li>
            <li className="route-line" aria-hidden="true">
              →
            </li>
            <li className="route-node dependency-node">
              <div>
                <strong>Dependency</strong>
                <small>{behaviorCopy[behavior].signal}</small>
              </div>
            </li>
          </ol>

          <div className="result-slot" aria-live="polite">
            {isLoading ? (
              <div className="pending-result"><p>Loading saved experiment…</p></div>
            ) : isRunning ? (
              <div className="pending-result">
                <p>Waiting at the coordinator boundary…</p>
              </div>
            ) : latestRun && currentOutcome ? (
              <article
                className={`result-card ${currentOutcome.tone}`}
                key={latestRun.id}
              >
                <header>
                  <h3>{currentOutcome.label}</h3>
                  <dl>
                    <div>
                      <dt>HTTP</dt>
                      <dd>{latestRun.httpStatus ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>RPC</dt>
                      <dd>{rpcSignal(latestRun)}</dd>
                    </div>
                    <div>
                      <dt>Time</dt>
                      <dd>{latestRun.durationMs} ms</dd>
                    </div>
                    {latestRun.correlationId ? (
                      <div>
                        <dt>Correlation</dt>
                        <dd title={latestRun.correlationId}>
                          {latestRun.correlationId.slice(0, 8)}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                </header>
                <p>{currentOutcome.explanation}</p>
                <details>
                  <summary>Response evidence</summary>
                  <pre>{responseText(latestRun)}</pre>
                </details>
              </article>
            ) : (
              <div className="ready-state">
                <p>
                  Run the request to see its outcome, timing, and preserved
                  response.
                </p>
              </div>
            )}
          </div>
        </section>

        <details className="evidence">
          <summary>
            <span>Saved experiments</span>
            <span>
              {experiments.length} saved · {runCount} in selected
            </span>
          </summary>

          {experiments.length === 0 ? (
            <p className="empty-evidence">
              Your first completed request will be stored here.
            </p>
          ) : (
            <div className="experiment-list">
              {experiments.map((experiment) => (
                <div className="experiment-row" key={experiment.id}>
                  <button
                    disabled={isBusy}
                    aria-label={`Open ${experiment.name}`}
                    aria-pressed={selected?.id === experiment.id}
                    className={selected?.id === experiment.id ? "selected" : ""}
                    onClick={() => void openExperiment(experiment.id)}
                    type="button"
                  >
                    <span>
                      <strong>{experiment.name}</strong>
                      <small>{formatTimestamp(experiment.createdAt)}</small>
                    </span>
                    <span>{behaviorCopy[experiment.behavior].signal}</span>
                  </button>
                  <button
                    className="delete-experiment"
                    disabled={isBusy}
                    aria-label={`Delete ${experiment.name} and its runs`}
                    onClick={() => void removeExperiment(experiment.id, experiment.name)}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </details>
      </section>
    </main>
  );
}
