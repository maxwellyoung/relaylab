import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  addDrillResult,
  createSession,
  getSession,
  listSessions,
  type PracticeSession,
  type PracticeSessionDetails,
} from "./api";

const today = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Pacific/Auckland",
}).format(new Date());

const emptySession = {
  playedAt: today,
  map: "Dust II",
  goal: "",
  durationMinutes: 30,
};

const emptyResult = {
  drillName: "",
  attempts: 20,
  successes: 0,
  notes: "",
};

type Exchange = {
  method: "GET" | "POST";
  endpoint: string;
  response: string;
  message: string;
  tone: "success" | "error";
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-NZ", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function calculateAccuracy(session: PracticeSessionDetails | null) {
  if (!session) return null;

  const totals = session.results.reduce(
    (summary, result) => ({
      attempts: summary.attempts + result.attempts,
      successes: summary.successes + result.successes,
    }),
    { attempts: 0, successes: 0 },
  );

  if (totals.attempts === 0) return null;

  return {
    ...totals,
    percentage: Math.round((totals.successes / totals.attempts) * 100),
  };
}

function messageFrom(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}

export default function App() {
  const [sessions, setSessions] = useState<PracticeSession[]>([]);
  const [selected, setSelected] = useState<PracticeSessionDetails | null>(null);
  const [sessionInput, setSessionInput] = useState(emptySession);
  const [resultInput, setResultInput] = useState(emptyResult);
  const [exchange, setExchange] = useState<Exchange | null>(null);
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  const accuracy = useMemo(() => calculateAccuracy(selected), [selected]);

  useEffect(() => {
    void loadLedger();
  }, []);

  async function loadLedger() {
    try {
      const nextSessions = await listSessions();
      setSessions(nextSessions);

      if (nextSessions[0]) {
        const latest = await getSession(nextSessions[0].id);
        setSelected(latest);
        setExchange({
          method: "GET",
          endpoint: `/api/sessions/${latest.id}`,
          response: "200 OK",
          message: "The latest session and its drill evidence were loaded.",
          tone: "success",
        });
      } else {
        setExchange({
          method: "GET",
          endpoint: "/api/sessions",
          response: "200 OK",
          message: "The ledger is ready for its first session.",
          tone: "success",
        });
      }
    } catch (reason) {
      recordFailure("GET", "/api/sessions", reason, "Unable to load sessions");
    }
  }

  async function selectSession(sessionId: number) {
    setError("");
    try {
      const nextSession = await getSession(sessionId);
      setSelected(nextSession);
      setExchange({
        method: "GET",
        endpoint: `/api/sessions/${sessionId}`,
        response: "200 OK",
        message: "Session evidence loaded from SQLite.",
        tone: "success",
      });
    } catch (reason) {
      recordFailure(
        "GET",
        `/api/sessions/${sessionId}`,
        reason,
        "Unable to load session",
      );
    }
  }

  function recordFailure(
    method: Exchange["method"],
    endpoint: string,
    reason: unknown,
    fallback: string,
  ) {
    const message = messageFrom(reason, fallback);
    setError(message);
    setExchange({
      method,
      endpoint,
      response: "Request failed",
      message,
      tone: "error",
    });
  }

  async function submitSession(event: FormEvent) {
    event.preventDefault();
    setError("");
    setIsBusy(true);

    try {
      const created = await createSession(sessionInput);
      const [nextSessions, details] = await Promise.all([
        listSessions(),
        getSession(created.id),
      ]);
      setSessions(nextSessions);
      setSelected(details);
      setSessionInput({ ...emptySession, playedAt: today });
      setExchange({
        method: "POST",
        endpoint: "/api/sessions",
        response: "201 Created",
        message: "Your practice focus is saved.",
        tone: "success",
      });
    } catch (reason) {
      recordFailure(
        "POST",
        "/api/sessions",
        reason,
        "Unable to save session",
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function submitResult(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;

    setError("");
    setIsBusy(true);

    try {
      await addDrillResult(selected.id, resultInput);
      const details = await getSession(selected.id);
      setSelected(details);
      setResultInput(emptyResult);
      setExchange({
        method: "POST",
        endpoint: `/api/sessions/${selected.id}/results`,
        response: "201 Created",
        message: "The drill result is now part of this session.",
        tone: "success",
      });
    } catch (reason) {
      recordFailure(
        "POST",
        `/api/sessions/${selected.id}/results`,
        reason,
        "Unable to save result",
      );
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <main>
      <header className="topbar">
        <a href="#top" aria-label="AimLedger home">
          Aim<span>/</span>Ledger
        </a>
        <span>Local practice log</span>
      </header>

      <section className="intro" id="top">
        <p>Deliberate practice, without the admin.</p>
        <h1>What are you working on?</h1>
      </section>

      {error ? (
        <div className="error-message" role="alert">
          {error}
        </div>
      ) : null}

      <section className="start-session" aria-labelledby="start-title">
        <h2 id="start-title" className="sr-only">
          Start a practice session
        </h2>
        <form onSubmit={submitSession}>
          <label className="focus-field">
            <span className="sr-only">Practice focus</span>
            <textarea
              autoFocus
              value={sessionInput.goal}
              onChange={(event) =>
                setSessionInput({ ...sessionInput, goal: event.target.value })
              }
              placeholder="e.g. Stop moving before the first bullet"
              maxLength={240}
              required
            />
          </label>

          <details className="session-options">
            <summary>
              <span>Session details</span>
              <small>
                {sessionInput.map} · {sessionInput.durationMinutes} min ·{" "}
                {formatDate(sessionInput.playedAt)}
              </small>
            </summary>
            <div>
              <label>
                Map
                <input
                  value={sessionInput.map}
                  onChange={(event) =>
                    setSessionInput({ ...sessionInput, map: event.target.value })
                  }
                  maxLength={50}
                  required
                />
              </label>
              <label>
                Duration
                <div className="unit-input">
                  <input
                    type="number"
                    min="1"
                    max="480"
                    value={sessionInput.durationMinutes}
                    onChange={(event) =>
                      setSessionInput({
                        ...sessionInput,
                        durationMinutes: Number(event.target.value),
                      })
                    }
                    required
                  />
                  <span>min</span>
                </div>
              </label>
              <label>
                Date
                <input
                  type="date"
                  value={sessionInput.playedAt}
                  onChange={(event) =>
                    setSessionInput({
                      ...sessionInput,
                      playedAt: event.target.value,
                    })
                  }
                  required
                />
              </label>
            </div>
          </details>

          <button className="primary-button" disabled={isBusy} type="submit">
            {isBusy ? "Saving…" : "Start practice"}
            <span aria-hidden="true">→</span>
          </button>
        </form>
      </section>

      {selected ? (
        <section className="active-session" aria-labelledby="active-title">
          <header>
            <div>
              <p>
                {formatDate(selected.playedAt)} · {selected.map} ·{" "}
                {selected.durationMinutes} min
              </p>
              <h2 id="active-title">{selected.goal}</h2>
            </div>
            <div className="accuracy">
              <span>{accuracy ? `${accuracy.percentage}%` : "—"}</span>
              <small>{accuracy ? "accuracy" : "no results yet"}</small>
            </div>
          </header>

          <div className="evidence-grid">
            <form className="result-form" onSubmit={submitResult}>
              <h3>Add a result</h3>
              <label>
                Drill
                <input
                  value={resultInput.drillName}
                  onChange={(event) =>
                    setResultInput({
                      ...resultInput,
                      drillName: event.target.value,
                    })
                  }
                  placeholder="Counter-strafe wall targets"
                  maxLength={100}
                  required
                />
              </label>
              <div className="score-inputs">
                <label>
                  Successes
                  <input
                    type="number"
                    min="0"
                    max={resultInput.attempts}
                    value={resultInput.successes}
                    onChange={(event) =>
                      setResultInput({
                        ...resultInput,
                        successes: Number(event.target.value),
                      })
                    }
                    required
                  />
                </label>
                <span>out of</span>
                <label>
                  Attempts
                  <input
                    type="number"
                    min="1"
                    value={resultInput.attempts}
                    onChange={(event) =>
                      setResultInput({
                        ...resultInput,
                        attempts: Number(event.target.value),
                      })
                    }
                    required
                  />
                </label>
              </div>
              <details className="note-field">
                <summary>Add an observation</summary>
                <label>
                  <span className="sr-only">Observation</span>
                  <textarea
                    value={resultInput.notes}
                    onChange={(event) =>
                      setResultInput({
                        ...resultInput,
                        notes: event.target.value,
                      })
                    }
                    placeholder="What changed or broke?"
                    maxLength={500}
                  />
                </label>
              </details>
              <button disabled={isBusy} type="submit">
                {isBusy ? "Saving…" : "Save result"}
              </button>
            </form>

            <div className="result-history">
              <h3>Evidence</h3>
              {selected.results.length === 0 ? (
                <p className="quiet-state">
                  Add one result when you finish a repeatable drill.
                </p>
              ) : (
                <ol>
                  {selected.results.map((result) => (
                    <li key={result.id}>
                      <div>
                        <strong>{result.drillName}</strong>
                        <span>
                          {result.successes}/{result.attempts}
                        </span>
                      </div>
                      {result.notes ? <p>{result.notes}</p> : null}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </section>
      ) : null}

      <section className="practice-log" aria-labelledby="log-title">
        <header>
          <h2 id="log-title">Practice log</h2>
          <span>{sessions.length}</span>
        </header>
        {sessions.length === 0 ? (
          <p className="quiet-state">
            Your completed sessions will collect here.
          </p>
        ) : (
          <div>
            {sessions.map((session) => (
              <button
                aria-pressed={selected?.id === session.id}
                className={selected?.id === session.id ? "selected" : ""}
                key={session.id}
                onClick={() => void selectSession(session.id)}
                type="button"
              >
                <span>
                  <strong>{session.goal}</strong>
                  <small>
                    {formatDate(session.playedAt)} · {session.map}
                  </small>
                </span>
                <span>{session.durationMinutes} min</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <details className="system-details">
        <summary>How AimLedger stores this</summary>
        <div>
          <p>
            React sends JSON to an Express API. Zod validates it before SQLite
            stores the session and related drill results.
          </p>
          {exchange ? (
            <div className={`exchange ${exchange.tone}`} aria-live="polite">
              <code>
                {exchange.method} {exchange.endpoint}
              </code>
              <span>{exchange.response}</span>
              <p>{exchange.message}</p>
            </div>
          ) : null}
        </div>
      </details>
    </main>
  );
}
