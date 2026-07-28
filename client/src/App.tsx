import { useEffect, useMemo, useState } from "react";
import {
  createExperiment,
  getExperiment,
  listExperiments,
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
    signal: "503 response",
    description: "The dependency is reachable but refuses the request.",
  },
  malformed: {
    label: "Malformed",
    signal: "Invalid body",
    description: "The dependency returns 200 with the wrong response shape.",
  },
};

const outcomeCopy: Record<
  RunOutcome,
  { label: string; explanation: string; tone: "good" | "warn" | "bad" }
> = {
  success: {
    label: "Request completed",
    explanation: "The response crossed both HTTP boundaries and matched the contract.",
    tone: "good",
  },
  downstream_error: {
    label: "Dependency refused",
    explanation: "The coordinator reached the service and preserved its error response.",
    tone: "bad",
  },
  timeout: {
    label: "Deadline exceeded",
    explanation: "The coordinator stopped waiting, classified the timeout, and kept the attempt.",
    tone: "warn",
  },
  invalid_response: {
    label: "Contract rejected",
    explanation: "The service answered, but its body failed response-shape validation.",
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

export default function App() {
  const [behavior, setBehavior] = useState<ExperimentBehavior>("healthy");
  const [payloadText, setPayloadText] = useState(defaultPayload);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [selected, setSelected] = useState<ExperimentDetails | null>(null);
  const [latestRun, setLatestRun] = useState<ExperimentRun | null>(null);
  const [isRunning, setIsRunning] = useState(false);
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
    setError("");
    try {
      selectDetails(await getExperiment(experimentId));
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to load experiment",
      );
    }
  }

  async function execute() {
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
    <main>
      <header className="topbar">
        <a href="#top" aria-label="RelayLab home">
          Relay<span>Lab</span>
        </a>
        <div>
          <span aria-hidden="true" />
          Three local processes
        </div>
      </header>

      <section className="intro" id="top">
        <p>API reliability workbench</p>
        <h1>Break the request on purpose.</h1>
        <p className="lede">
          Pick a dependency condition. RelayLab sends one real HTTP request and
          preserves exactly how it failed.
        </p>
      </section>

      {error ? (
        <div className="error-message" role="alert">
          <strong>Couldn’t run that.</strong>
          <span>{error}</span>
        </div>
      ) : null}

      <section
        className={`workbench ${isRunning ? "running" : ""}`}
        aria-label="Request workbench"
      >
        <div className="controls">
          <div className="section-label">
            <span>01</span>
            <p>Dependency condition</p>
          </div>

          <div className="behavior-picker">
            {(Object.keys(behaviorCopy) as ExperimentBehavior[]).map(
              (option) => (
                <button
                  aria-pressed={behavior === option}
                  className={behavior === option ? "selected" : ""}
                  key={option}
                  onClick={() => chooseBehavior(option)}
                  type="button"
                >
                  <span>{behaviorCopy[option].label}</span>
                  <small>{behaviorCopy[option].signal}</small>
                </button>
              ),
            )}
          </div>

          <p className="behavior-description">
            {behaviorCopy[behavior].description}
          </p>

          <details className="request-details">
            <summary>Request payload</summary>
            <label>
              <span className="sr-only">JSON request payload</span>
              <textarea
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
            disabled={isRunning}
            onClick={() => void execute()}
            type="button"
          >
            <span>{isRunning ? "Request in flight…" : selected ? "Run again" : "Run request"}</span>
            <span aria-hidden="true">→</span>
          </button>
        </div>

        <div className="trace">
          <div className="trace-heading">
            <div className="section-label">
              <span>02</span>
              <p>Live path</p>
            </div>
            <span className={`trace-status ${currentOutcome?.tone ?? ""}`}>
              {isRunning
                ? "In flight"
                : currentOutcome?.label ?? "Ready"}
            </span>
          </div>

          <ol className="route" aria-label="Distributed request path">
            <li>
              <span className="node-index">A</span>
              <div>
                <strong>Browser</strong>
                <small>POST experiment run</small>
              </div>
            </li>
            <li className="route-line" aria-hidden="true">
              <span />
            </li>
            <li>
              <span className="node-index">B</span>
              <div>
                <strong>Coordinator</strong>
                <small>400 ms deadline</small>
              </div>
            </li>
            <li className="route-line" aria-hidden="true">
              <span />
            </li>
            <li>
              <span className="node-index">C</span>
              <div>
                <strong>Dependency</strong>
                <small>{behaviorCopy[behavior].signal}</small>
              </div>
            </li>
          </ol>

          <div className="result-slot" aria-live="polite">
            {isRunning ? (
              <div className="pending-result">
                <span />
                <p>Waiting at the coordinator boundary…</p>
              </div>
            ) : latestRun && currentOutcome ? (
              <article
                className={`result-card ${currentOutcome.tone}`}
                key={latestRun.id}
              >
                <header>
                  <div>
                    <p>Observed outcome</p>
                    <h2>{currentOutcome.label}</h2>
                  </div>
                  <dl>
                    <div>
                      <dt>HTTP</dt>
                      <dd>{latestRun.httpStatus ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>Time</dt>
                      <dd>{latestRun.durationMs} ms</dd>
                    </div>
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
                <span>↳</span>
                <p>
                  No request yet. The result, timing, and response body will
                  appear here.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="evidence" aria-labelledby="evidence-title">
        <header>
          <div>
            <p>SQLite evidence</p>
            <h2 id="evidence-title">Previous experiments</h2>
          </div>
          <span>
            {experiments.length} saved · {runCount} in selected
          </span>
        </header>

        {experiments.length === 0 ? (
          <p className="empty-evidence">
            Your first completed request will become durable evidence here.
          </p>
        ) : (
          <div className="experiment-list">
            {experiments.map((experiment, index) => (
              <button
                aria-pressed={selected?.id === experiment.id}
                className={selected?.id === experiment.id ? "selected" : ""}
                key={experiment.id}
                onClick={() => void openExperiment(experiment.id)}
                type="button"
              >
                <span className="experiment-number">
                  {String(experiments.length - index).padStart(2, "0")}
                </span>
                <span>
                  <strong>{experiment.name}</strong>
                  <small>{formatTimestamp(experiment.createdAt)}</small>
                </span>
                <span>{behaviorCopy[experiment.behavior].signal}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <footer>
        <span>React → Express coordinator → Express dependency → SQLite</span>
        <span>Local only</span>
      </footer>
    </main>
  );
}
