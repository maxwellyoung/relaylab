import { useState } from "react";
import {
  ApiError, createDemoSession, endDemoSession, listReviews, submitReview, decideReview,
  type DemoActorId, type DemoSession, type ExperimentRun, type RunReview,
} from "./api";

const accounts: { id: DemoActorId; name: string }[] = [
  { id: "researcher-a", name: "Researcher A" },
  { id: "researcher-b", name: "Researcher B" },
  { id: "reviewer", name: "Reviewer" },
];
const statusLabels = { pending: "Pending review", approved: "Approved", rejected: "Rejected" };

export default function ReviewWorkspace({ latestRun, runBusy, onRoleChange }: {
  latestRun: ExperimentRun | null;
  runBusy: boolean;
  onRoleChange: (role: "researcher" | "reviewer" | null) => void;
}) {
  const [session, setSession] = useState<DemoSession | null>(null);
  const [reviews, setReviews] = useState<RunReview[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function reportFailure(reason: unknown) {
    setError(reason instanceof Error ? reason.message : "Unable to load reviews. Try again.");
    if (reason instanceof ApiError && reason.status === 401) {
      setSession(null);
      setReviews([]);
      setDrafts({});
      onRoleChange(null);
    }
  }

  async function chooseAccount(actorId: DemoActorId) {
    if (busy || runBusy) return;
    setBusy(true);
    setError("");
    setNotice("");
    setReviews([]);
    setDrafts({});
    setSession(null);
    onRoleChange(null);
    try {
      // Retire the old tab's demo token before selecting another identity.
      if (session) await endDemoSession(session.token).catch(() => undefined);
      const next = await createDemoSession(actorId);
      setSession(next);
      onRoleChange(next.actor.role);
      setReviews(await listReviews(next.token));
    } catch (reason) {
      reportFailure(reason);
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    if (!session || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setReviews(await listReviews(session.token));
      setNotice("Reviews refreshed.");
    } catch (reason) {
      reportFailure(reason);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!session || !latestRun || busy || runBusy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const review = await submitReview(session.token, latestRun.id);
      setReviews((current) => [review, ...current]);
      setNotice(`Run #${latestRun.id} submitted for review.`);
    } catch (reason) {
      reportFailure(reason);
    } finally {
      setBusy(false);
    }
  }

  async function decide(reviewId: number, status: "approved" | "rejected") {
    if (!session || busy) return;
    const feedback = drafts[reviewId]?.trim() ?? "";
    if (!feedback) {
      setError("Provide feedback before approving or rejecting a run.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const updated = await decideReview(session.token, reviewId, status, feedback);
      setReviews((current) => current.map((review) => review.id === reviewId ? updated : review));
      setNotice(`Run #${updated.runId} ${status}.`);
    } catch (reason) {
      reportFailure(reason);
      // A competing decision is final; fetch it rather than offering an overwrite.
      if (reason instanceof ApiError && reason.status === 409) {
        try { setReviews(await listReviews(session.token)); } catch (refreshReason) { reportFailure(refreshReason); }
      }
    } finally {
      setBusy(false);
    }
  }

  const submitted = latestRun && reviews.some((review) => review.runId === latestRun.id);
  const ReviewHeading = session?.actor.role === "reviewer" ? "h2" : "h3";
  return <section className="review-workspace" aria-labelledby="review-title" aria-busy={busy}>
    <header className="review-heading">
      {session?.actor.role === "reviewer" ? <h1 id="review-title">Reviewer queue</h1> : <h2 id="review-title">Run reviews</h2>}
      {session && <button type="button" disabled={busy} onClick={() => void refresh()}>Refresh reviews</button>}
    </header>
    <p className="review-demo-note">Local demo accounts — anyone can select a role. Use separate tabs to try the handoff.</p>
    <div className="review-accounts" aria-label="Demo accounts">
      {accounts.map((account) => <button key={account.id} type="button" aria-pressed={session?.actor.id === account.id} disabled={busy || runBusy} onClick={() => void chooseAccount(account.id)}>{account.name}</button>)}
    </div>
    {session && <p className="review-identity">Using {session.actor.name}. {session.actor.role === "researcher" ? "You see your own submissions." : "Pending submissions need a decision."}</p>}
    {error && <p className="error-message" role="alert">{error}</p>}
    <p className="review-notice" role="status">{busy ? "Loading reviews…" : notice}</p>
    {session?.actor.role === "researcher" && <div className="review-submit">
      {latestRun ? <>
        <p>Selected run #{latestRun.id}: execution outcome <strong>{latestRun.outcome.replaceAll("_", " ")}</strong>.</p>
        <button type="button" disabled={busy || runBusy || Boolean(submitted)} onClick={() => void submit()}>{submitted ? `Run #${latestRun.id} submitted` : `Submit run #${latestRun.id} for review`}</button>
      </> : <p>Run or reopen an experiment below, then submit its latest result for review.</p>}
    </div>}
    {session && !busy && !error && reviews.length === 0 && <p>{session.actor.role === "reviewer" ? "No runs awaiting review." : "No submitted runs yet."}</p>}
    {session && <div className="review-list">
      {reviews.map((review) => <article key={review.id} className="review-row" aria-labelledby={`review-${review.id}`}>
        <header>
          <ReviewHeading id={`review-${review.id}`}>{review.experimentName} · Run #{review.runId}</ReviewHeading>
          <strong className={`review-status ${review.status}`}>{statusLabels[review.status]}</strong>
        </header>
        <p>Submitted by {review.researcherId} · {new Date(review.submittedAt).toLocaleString("en-NZ")}</p>
        <p>Execution: <strong>{review.run.outcome.replaceAll("_", " ")}</strong> · {review.run.durationMs} ms · {review.run.response && typeof review.run.response === "object" && review.run.response.transport === "grpc" ? `gRPC status ${review.run.response.grpcStatus ?? "unknown"}` : `HTTP ${review.run.httpStatus ?? "no response"}`}</p>
        <details><summary>Inspect run evidence</summary><pre>{review.run.response === null ? "No response body was received." : typeof review.run.response === "string" ? review.run.response : JSON.stringify(review.run.response, null, 2)}</pre></details>
        {review.feedback !== null && <>
          <p className="review-feedback"><strong>Reviewer feedback:</strong> {review.feedback}</p>
          <p>Decided by {review.reviewerId} · {review.decidedAt && new Date(review.decidedAt).toLocaleString("en-NZ")}</p>
        </>}
        {session.actor.role === "reviewer" && review.status === "pending" && <div className="review-decision">
          <label htmlFor={`feedback-${review.id}`}>Feedback for run #{review.runId} (required)</label>
          <textarea id={`feedback-${review.id}`} maxLength={2000} value={drafts[review.id] ?? ""} disabled={busy} onChange={(event) => setDrafts((current) => ({ ...current, [review.id]: event.target.value }))} />
          <div className="review-actions">
            <button type="button" disabled={busy} onClick={() => void decide(review.id, "approved")}>Approve run #{review.runId}</button>
            <button type="button" disabled={busy} onClick={() => void decide(review.id, "rejected")}>Reject run #{review.runId}</button>
          </div>
        </div>}
      </article>)}
    </div>}
  </section>;
}
