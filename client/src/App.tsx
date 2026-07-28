import { FormEvent, useEffect, useState } from "react";
import {
  addDrillResult,
  createSession,
  getSession,
  listSessions,
  type PracticeSession,
  type PracticeSessionDetails,
} from "./api";

const today = new Date().toISOString().slice(0, 10);

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

export default function App() {
  const [sessions, setSessions] = useState<PracticeSession[]>([]);
  const [selected, setSelected] = useState<PracticeSessionDetails | null>(null);
  const [sessionInput, setSessionInput] = useState(emptySession);
  const [resultInput, setResultInput] = useState(emptyResult);
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    void refreshSessions();
  }, []);

  async function refreshSessions() {
    try {
      setSessions(await listSessions());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load sessions");
    }
  }

  async function selectSession(sessionId: number) {
    setError("");
    try {
      setSelected(await getSession(sessionId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load session");
    }
  }

  async function submitSession(event: FormEvent) {
    event.preventDefault();
    setError("");
    setIsBusy(true);

    try {
      const created = await createSession(sessionInput);
      setSessionInput({ ...emptySession, playedAt: today, goal: "" });
      await refreshSessions();
      await selectSession(created.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save session");
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
      setResultInput(emptyResult);
      await selectSession(selected.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save result");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <main>
      <header className="hero">
        <p className="eyebrow">COMP713 · Option A</p>
        <h1>
          AIM<span>/</span>LEDGER
        </h1>
        <p className="lede">
          Turn “I played for a while” into one deliberate practice record.
        </p>
      </header>

      {error ? (
        <div className="error-banner" role="alert">
          {error}
        </div>
      ) : null}

      <div className="workspace">
        <section className="panel">
          <div className="section-heading">
            <p>01</p>
            <h2>Record the intention</h2>
          </div>

          <form onSubmit={submitSession}>
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
              Practice goal
              <textarea
                value={sessionInput.goal}
                onChange={(event) =>
                  setSessionInput({ ...sessionInput, goal: event.target.value })
                }
                placeholder="e.g. Stop moving before the first bullet"
                maxLength={240}
                required
              />
            </label>
            <label>
              Duration in minutes
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
            </label>
            <button disabled={isBusy} type="submit">
              Save practice session
            </button>
          </form>
        </section>

        <section className="panel">
          <div className="section-heading">
            <p>02</p>
            <h2>Review the evidence</h2>
          </div>

          {sessions.length === 0 ? (
            <p className="empty-state">
              No sessions yet. Create the smallest honest record.
            </p>
          ) : (
            <div className="session-list">
              {sessions.map((session) => (
                <button
                  className={selected?.id === session.id ? "selected" : ""}
                  key={session.id}
                  onClick={() => void selectSession(session.id)}
                  type="button"
                >
                  <span>{session.playedAt}</span>
                  <strong>{session.map}</strong>
                  <small>{session.goal}</small>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      {selected ? (
        <section className="detail-panel">
          <div className="detail-summary">
            <p className="eyebrow">Selected session</p>
            <h2>{selected.map}</h2>
            <p>{selected.goal}</p>
            <dl>
              <div>
                <dt>Duration</dt>
                <dd>{selected.durationMinutes} min</dd>
              </div>
              <div>
                <dt>Drills logged</dt>
                <dd>{selected.results.length}</dd>
              </div>
            </dl>
          </div>

          <div>
            <h3>Add drill evidence</h3>
            <form className="result-form" onSubmit={submitResult}>
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
              <div className="split-fields">
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
                <label>
                  Successes
                  <input
                    type="number"
                    min="0"
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
              </div>
              <label>
                Observation
                <textarea
                  value={resultInput.notes}
                  onChange={(event) =>
                    setResultInput({ ...resultInput, notes: event.target.value })
                  }
                  placeholder="What changed or broke?"
                  maxLength={500}
                />
              </label>
              <button disabled={isBusy} type="submit">
                Add drill result
              </button>
            </form>
          </div>

          <div className="result-list">
            <h3>Recorded results</h3>
            {selected.results.length === 0 ? (
              <p className="empty-state">No drill evidence recorded yet.</p>
            ) : (
              selected.results.map((result) => (
                <article key={result.id}>
                  <div>
                    <strong>{result.drillName}</strong>
                    <span>
                      {result.successes} / {result.attempts}
                    </span>
                  </div>
                  {result.notes ? <p>{result.notes}</p> : null}
                </article>
              ))
            )}
          </div>
        </section>
      ) : null}
    </main>
  );
}
