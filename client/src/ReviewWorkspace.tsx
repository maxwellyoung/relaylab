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
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showList, setShowList] = useState(true);
  const [requiresRefresh, setRequiresRefresh] = useState(false);

  function receiveReviews(next: RunReview[]) {
    setReviews(next);
    setRequiresRefresh(false);
    setSelectedId((current) => next.some((review) => review.id === current) ? current : next.find((review) => review.status === "pending")?.id ?? next[0]?.id ?? null);
  }

  function reportFailure(reason: unknown) {
    setError(reason instanceof TypeError ? "Could not reach the coordinator. Showing the last retrieved reviews; refresh to retry." : reason instanceof Error ? reason.message : "Unable to load reviews. Try again.");
    if (reason instanceof TypeError || reason instanceof ApiError && reason.status >= 500) setRequiresRefresh(true);
    if (reason instanceof ApiError && reason.status === 401) {
      setSession(null);
      setReviews([]);
      setDrafts({});
      setSelectedId(null);
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
    setSelectedId(null); setShowList(true); setRequiresRefresh(false);
    onRoleChange(null);
    try {
      // Retire the old tab's demo token before selecting another identity.
      if (session) await endDemoSession(session.token).catch(() => undefined);
      const next = await createDemoSession(actorId);
      setSession(next);
      onRoleChange(next.actor.role);
      receiveReviews(await listReviews(next.token));
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
      receiveReviews(await listReviews(session.token));
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
      setSelectedId(review.id); setShowList(false);
      setNotice(`Run #${latestRun.id} submitted for review.`);
    } catch (reason) {
      reportFailure(reason);
    } finally {
      setBusy(false);
    }
  }

  async function decide(reviewId: number, status: "approved" | "rejected") {
    if (!session || busy || requiresRefresh) return;
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
        try { receiveReviews(await listReviews(session.token)); } catch (refreshReason) { reportFailure(refreshReason); }
      }
    } finally {
      setBusy(false);
    }
  }

  function openReview(id: number) {
    setSelectedId(id); setShowList(false);
    requestAnimationFrame(() => document.getElementById(`review-${id}`)?.focus());
  }

  const submitted = latestRun && reviews.some((review) => review.runId === latestRun.id);
  const selected = reviews.find((review) => review.id === selectedId);
  const nextPending = reviews.find((review) => review.status === "pending" && review.id !== selectedId);
  const ReviewHeading = session?.actor.role === "reviewer" ? "h2" : "h3";
  return <section className="review-workspace" aria-labelledby="review-title" aria-busy={busy}>
    <div className="workspace-controls">
      <div className="review-accounts" aria-label="Demo accounts">
        {accounts.map((account) => <button key={account.id} type="button" aria-pressed={session?.actor.id === account.id} disabled={busy || runBusy} onClick={() => void chooseAccount(account.id)}>{account.name}</button>)}
      </div>
      <details className="demo-guide"><summary>About this demo</summary><p>Local demo accounts — anyone can select a role. Use separate tabs to try the handoff. These are not password-protected accounts.</p></details>
    </div>
    <header className="review-heading">
      <div>
        {session?.actor.role === "reviewer" ? <h1 id="review-title">Reviewer queue</h1> : <h2 id="review-title">Run reviews</h2>}
        <p className="review-identity">{session ? session.actor.role === "reviewer" ? `${reviews.filter((review) => review.status === "pending").length} waiting for feedback` : `${session.actor.name} · your submissions` : "Choose a demo role to submit or review a run."}</p>
      </div>
      {session && <button className="quiet-control" aria-label="Refresh reviews" type="button" disabled={busy} onClick={() => void refresh()}>Refresh</button>}
    </header>
    {error && <p className="error-message" role="alert">{error}</p>}
    <p className="review-notice" role="status">{busy ? "Loading reviews…" : notice}</p>
    {session?.actor.role === "researcher" && <div className="review-submit">
      {latestRun ? <>
        <p>Selected run <strong>#{latestRun.id}</strong> · {latestRun.outcome.replaceAll("_", " ")}</p>
        <button type="button" disabled={busy || runBusy || Boolean(submitted)} onClick={() => void submit()}>{submitted ? `Run #${latestRun.id} submitted` : `Submit run #${latestRun.id} for review`}</button>
      </> : <p>Run or reopen an experiment below, then submit its latest result for review.</p>}
    </div>}
    {session && !busy && !error && reviews.length === 0 && <div className="review-empty"><span className="empty-mark" aria-hidden="true">↗</span><p>{session.actor.role === "reviewer" ? "No runs awaiting review." : "No submitted runs yet."}</p><small>Run evidence and feedback will stay together here.</small></div>}
    {session && reviews.length > 0 && <div className={`review-body ${showList ? "show-list" : "show-detail"}`}>
      <nav className="review-list" aria-label="Submitted runs">
        <p className="queue-caption">{session.actor.role === "reviewer" ? "Submitted runs" : "Your review ledger"}<span>{reviews.length}</span></p>
        {reviews.map((review) => <button key={review.id} type="button" className={`queue-item ${review.id === selectedId ? "active" : ""}`} aria-pressed={review.id === selectedId} id={`queue-${review.id}`} onClick={() => openReview(review.id)}>
          <span className="queue-item-top"><span className={`queue-dot ${review.status}`} aria-hidden="true" /><span>Run #{review.runId}</span><time dateTime={review.submittedAt}>{new Date(review.submittedAt).toLocaleDateString("en-NZ", { day: "numeric", month: "short" })}</time></span>
          <strong>{review.experimentName}</strong>
          <span className="queue-item-meta">{review.status === "pending" ? "Awaiting feedback" : `${review.status === "approved" ? "Approved" : "Rejected"} review`}<span aria-hidden="true">↗</span></span>
        </button>)}
      </nav>
      {selected && <article className="review-detail" aria-labelledby={`review-${selected.id}`}>
        <button className="mobile-back quiet-control" type="button" onClick={() => { setShowList(true); requestAnimationFrame(() => document.getElementById(`queue-${selected.id}`)?.focus()); }}>← All reviews</button>
        <div className="receipt-heading">
          <span className="receipt-id">Run #{selected.runId} · {new Date(selected.submittedAt).toLocaleString("en-NZ", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>
          <strong className={`review-status ${selected.status}`}>{statusLabels[selected.status]}</strong>
        </div>
        <ReviewHeading tabIndex={-1} id={`review-${selected.id}`} aria-label={`${selected.experimentName} · Run #${selected.runId}`}>{selected.experimentName}</ReviewHeading>
        <p className="receipt-submitter">Submitted by {selected.researcherId.replaceAll("-", " ")}</p>
        <dl className="run-receipt">
          <div><dt>Execution</dt><dd className={selected.run.outcome === "success" ? "execution-good" : ""}>{selected.run.outcome.replaceAll("_", " ")}</dd></div>
          <div><dt>Duration</dt><dd>{selected.run.durationMs} <span>ms</span></dd></div>
          <div><dt>Transport</dt><dd>{selected.run.response && typeof selected.run.response === "object" && selected.run.response.transport === "grpc" ? `gRPC ${selected.run.response.grpcStatus ?? "unknown"}` : `HTTP ${selected.run.httpStatus ?? "—"}`}</dd></div>
        </dl>
        <details className="review-evidence"><summary>Inspect run evidence</summary><pre>{selected.run.response === null ? "No response body was received." : typeof selected.run.response === "string" ? selected.run.response : JSON.stringify(selected.run.response, null, 2)}</pre></details>
        {selected.feedback !== null && <div className="saved-feedback">
          <h4>Reviewer feedback</h4><p>{selected.feedback}</p>
          <small>Decided by {selected.reviewerId} · {selected.decidedAt && new Date(selected.decidedAt).toLocaleString("en-NZ", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</small>
        </div>}
        {session.actor.role === "reviewer" && selected.status === "pending" && <div className="review-decision">
          <label htmlFor={`feedback-${selected.id}`}>Feedback for run #{selected.runId} (required)</label>
          <p>What does this run tell the researcher?</p>
          <textarea id={`feedback-${selected.id}`} placeholder="Leave a useful note…" maxLength={2000} value={drafts[selected.id] ?? ""} disabled={busy} onChange={(event) => setDrafts((current) => ({ ...current, [selected.id]: event.target.value }))} />
          <div className="review-actions">
            <span>{requiresRefresh ? "Refresh to confirm the current status." : "Decisions are final."}</span>
            <button className="reject-action" type="button" disabled={busy || requiresRefresh} onClick={() => void decide(selected.id, "rejected")}>Reject run #{selected.runId}</button>
            <button className="approve-action" type="button" disabled={busy || requiresRefresh} onClick={() => void decide(selected.id, "approved")}>Approve run #{selected.runId}</button>
          </div>
        </div>}
        {session.actor.role === "reviewer" && selected.status !== "pending" && nextPending && <button className="next-review" type="button" onClick={() => openReview(nextPending.id)}>Open next pending run →</button>}
      </article>}
    </div>}
  </section>;
}
