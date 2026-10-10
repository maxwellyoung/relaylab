import { lazy, Suspense, useState, type ReactNode } from "react";

const Guide = lazy(() => import("./Guide"));
import {
  ApiError,
  createDemoSession,
  endDemoSession,
  listReviews,
  submitReview,
  decideReview,
  type DemoActorId,
  type DemoSession,
  type ExperimentRun,
  type RunReview,
} from "./api";

const accounts: { id: DemoActorId; name: string }[] = [
  { id: "researcher-a", name: "Researcher A" },
  { id: "researcher-b", name: "Researcher B" },
  { id: "reviewer", name: "Reviewer" },
];
const statusLabels = {
  pending: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
};

export default function ReviewWorkspace({
  latestRun,
  runBusy,
  onRoleChange,
  experimentPanel,
}: {
  experimentPanel?: ReactNode;
  latestRun: ExperimentRun | null;
  runBusy: boolean;
  onRoleChange: (role: "researcher" | "reviewer" | null) => void;
}) {
  const [view, setView] = useState<"experiments" | "reviews" | "guide">(
    experimentPanel ? "experiments" : "reviews",
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
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
    setSelectedId((current) =>
      next.some((review) => review.id === current)
        ? current
        : (next.find((review) => review.status === "pending")?.id ??
          next[0]?.id ??
          null),
    );
  }

  function reportFailure(reason: unknown) {
    setError(
      reason instanceof TypeError
        ? "Could not reach the coordinator. Showing the last retrieved reviews; refresh to retry."
        : reason instanceof Error
          ? reason.message
          : "Unable to load reviews. Try again.",
    );
    if (
      reason instanceof TypeError ||
      (reason instanceof ApiError && reason.status >= 500)
    )
      setRequiresRefresh(true);
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
    setSelectedId(null);
    setShowList(true);
    setRequiresRefresh(false);
    onRoleChange(null);
    try {
      // Retire the old tab's demo token before selecting another identity.
      if (session) await endDemoSession(session.token).catch(() => undefined);
      const next = await createDemoSession(actorId);
      setSession(next);
      setView("reviews");
      setQuery("");
      setFilter("all");
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
      setSelectedId(review.id);
      setShowList(false);
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
      const updated = await decideReview(
        session.token,
        reviewId,
        status,
        feedback,
      );
      setReviews((current) =>
        current.map((review) => (review.id === reviewId ? updated : review)),
      );
      setNotice(`Run #${updated.runId} ${status}.`);
    } catch (reason) {
      reportFailure(reason);
      // A competing decision is final; fetch it rather than offering an overwrite.
      if (reason instanceof ApiError && reason.status === 409) {
        try {
          receiveReviews(await listReviews(session.token));
        } catch (refreshReason) {
          reportFailure(refreshReason);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  function openReview(id: number) {
    setSelectedId(id);
    setShowList(false);
    requestAnimationFrame(() =>
      document.getElementById(`review-${id}`)?.focus(),
    );
  }

  const submitted =
    latestRun && reviews.some((review) => review.runId === latestRun.id);
  const nextPending = reviews.find(
    (review) => review.status === "pending" && review.id !== selectedId,
  );
  const visibleReviews = reviews.filter(
    (review) =>
      (filter === "all" || review.status === filter) &&
      `${review.experimentName} ${review.runId} ${review.status}`
        .toLowerCase()
        .includes(query.toLowerCase().trim()),
  );
  const selected =
    visibleReviews.find((review) => review.id === selectedId) ??
    visibleReviews[0];
  const ReviewHeading = session?.actor.role === "reviewer" ? "h2" : "h3";
  return (
    <main id="main-content" className="workspace" tabIndex={-1}>
      <aside className="workspace-sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ↗
          </span>
          RelayLab<span className="workspace-tag">Lab</span>
        </div>
        <nav className="workspace-nav" aria-label="Workspace">
          {experimentPanel && session?.actor.role !== "reviewer" && (
            <button
              type="button"
              aria-current={view === "experiments" ? "page" : undefined}
              onClick={() => setView("experiments")}
            >
              <span aria-hidden="true">◈</span>Experiments
            </button>
          )}
          <button
            type="button"
            aria-label="Open run reviews"
            aria-current={view === "reviews" ? "page" : undefined}
            onClick={() => setView("reviews")}
          >
            <span aria-hidden="true">▤</span>Run reviews
            <span className="nav-count">
              {reviews.filter((r) => r.status === "pending").length || ""}
            </span>
          </button>
          <button
            type="button"
            aria-current={view === "guide" ? "page" : undefined}
            onClick={() => setView("guide")}
          >
            <span aria-hidden="true">≡</span>How it works
          </button>
        </nav>
        <div className="sidebar-footer">
          <p className="sidebar-label">Demo identity</p>
          <div className="review-accounts" aria-label="Demo accounts">
            {accounts.map((account) => (
              <button
                key={account.id}
                type="button"
                aria-pressed={session?.actor.id === account.id}
                disabled={busy || runBusy}
                onClick={() => void chooseAccount(account.id)}
              >
                <span className="account-avatar" aria-hidden="true">
                  {account.id === "reviewer"
                    ? "R"
                    : account.id.endsWith("a")
                      ? "A"
                      : "B"}
                </span>
                {account.name}
                <span className="account-check" aria-hidden="true">
                  {session?.actor.id === account.id ? "✓" : ""}
                </span>
              </button>
            ))}
          </div>
          <details className="demo-guide">
            <summary>About this demo</summary>
            <p>
              Anyone can select a role. Use separate tabs to try the handoff.
              These are not password-protected accounts.
            </p>
          </details>
        </div>
      </aside>
      <div className="work-area">
        <header className="viewbar">
          <span>
            Workspace <span aria-hidden="true">/</span>{" "}
            <strong>
              {view === "experiments"
                ? "Experiments"
                : view === "reviews"
                  ? "Run reviews"
                  : "How it works"}
            </strong>
          </span>
          <span className="viewbar-note">
            {session ? session.actor.name : "Local workspace"}
          </span>
        </header>
        {experimentPanel && (
          <div className="experiment-view" hidden={view !== "experiments"}>
            {experimentPanel}
          </div>
        )}
        {view === "guide" && (
          <Suspense
            fallback={
              <p className="guide-loading" role="status">
                Opening the guide…
              </p>
            }
          >
            <Guide />
          </Suspense>
        )}
        <section
          hidden={view !== "reviews"}
          className="review-workspace"
          aria-labelledby="review-title"
          aria-busy={busy}
        >
          <header className="review-heading">
            <div>
              {session?.actor.role === "reviewer" ? (
                <h1 id="review-title">Reviewer queue</h1>
              ) : (
                <h2 id="review-title">Run reviews</h2>
              )}
              <p className="review-identity">
                {session
                  ? session.actor.role === "reviewer"
                    ? `${reviews.filter((review) => review.status === "pending").length} waiting for feedback`
                    : `${session.actor.name} · your submissions`
                  : "Choose a demo role to submit or review a run."}
              </p>
            </div>
            {session && (
              <button
                className="quiet-control"
                aria-label="Refresh reviews"
                type="button"
                disabled={busy}
                onClick={() => void refresh()}
              >
                Refresh
              </button>
            )}
          </header>
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          <p className="review-notice" role="status">
            {busy ? "Loading reviews…" : notice}
          </p>
          {session?.actor.role === "researcher" && (
            <div className="review-submit">
              {latestRun ? (
                <>
                  <p>
                    Selected run <strong>#{latestRun.id}</strong> ·{" "}
                    {latestRun.outcome.replaceAll("_", " ")}
                  </p>
                  <button
                    type="button"
                    disabled={busy || runBusy || Boolean(submitted)}
                    onClick={() => void submit()}
                  >
                    {submitted
                      ? `Run #${latestRun.id} submitted`
                      : `Submit run #${latestRun.id} for review`}
                  </button>
                </>
              ) : (
                <p>
                  Open Experiments and run or reopen an experiment, then submit
                  its latest result for review.
                </p>
              )}
            </div>
          )}
          {session && !busy && !error && reviews.length === 0 && (
            <div className="review-empty">
              <span className="empty-mark" aria-hidden="true">
                ↗
              </span>
              <p>
                {session.actor.role === "reviewer"
                  ? "No runs awaiting review."
                  : "No submitted runs yet."}
              </p>
              <small>Run evidence and feedback will stay together here.</small>
            </div>
          )}
          {session && reviews.length > 0 && (
            <div className="queue-tools">
              <label>
                <span className="sr-only">Search runs</span>
                <input
                  type="search"
                  placeholder="Search runs…"
                  aria-label="Search runs"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setShowList(true);
                  }}
                />
              </label>
              <label>
                <span className="sr-only">Review status</span>
                <select
                  aria-label="Review status"
                  value={filter}
                  onChange={(event) => {
                    setFilter(event.target.value);
                    setShowList(true);
                  }}
                >
                  <option value="all">All statuses</option>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved reviews</option>
                  <option value="rejected">Rejected reviews</option>
                </select>
              </label>
              <span>
                {visibleReviews.length} of {reviews.length}
              </span>
            </div>
          )}
          {session && reviews.length > 0 && (
            <div
              className={`review-body ${showList ? "show-list" : "show-detail"}`}
            >
              <nav className="review-list" aria-label="Submitted runs">
                <p className="queue-caption">
                  {session.actor.role === "reviewer"
                    ? "Submitted runs"
                    : "Your review ledger"}
                  <span>{reviews.length}</span>
                </p>
                {visibleReviews.length === 0 && (
                  <p className="filter-empty">
                    No matching runs. Change the search or status.
                  </p>
                )}
                {visibleReviews.map((review) => (
                  <button
                    key={review.id}
                    type="button"
                    className={`queue-item ${review.id === selected?.id ? "active" : ""}`}
                    aria-pressed={review.id === selected?.id}
                    id={`queue-${review.id}`}
                    onClick={() => openReview(review.id)}
                  >
                    <span className="queue-item-top">
                      <span
                        className={`queue-dot ${review.status}`}
                        aria-hidden="true"
                      />
                      <span>Run #{review.runId}</span>
                      <time dateTime={review.submittedAt}>
                        {new Date(review.submittedAt).toLocaleDateString(
                          "en-NZ",
                          { day: "numeric", month: "short" },
                        )}
                      </time>
                    </span>
                    <strong>{review.experimentName}</strong>
                    <span className="queue-item-meta">
                      {review.status === "pending"
                        ? "Awaiting feedback"
                        : `${review.status === "approved" ? "Approved" : "Rejected"} review`}
                      <span aria-hidden="true">↗</span>
                    </span>
                  </button>
                ))}
              </nav>
              {selected && (
                <article
                  className="review-detail"
                  aria-labelledby={`review-${selected.id}`}
                >
                  <button
                    className="mobile-back quiet-control"
                    type="button"
                    onClick={() => {
                      setShowList(true);
                      requestAnimationFrame(() =>
                        document
                          .getElementById(`queue-${selected.id}`)
                          ?.focus(),
                      );
                    }}
                  >
                    ← All reviews
                  </button>
                  <div className="receipt-heading">
                    <span className="receipt-id">
                      Run #{selected.runId} ·{" "}
                      {new Date(selected.submittedAt).toLocaleString("en-NZ", {
                        day: "numeric",
                        month: "short",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                    <strong className={`review-status ${selected.status}`}>
                      {statusLabels[selected.status]}
                    </strong>
                  </div>
                  <ReviewHeading
                    tabIndex={-1}
                    id={`review-${selected.id}`}
                    aria-label={`${selected.experimentName} · Run #${selected.runId}`}
                  >
                    {selected.experimentName}
                  </ReviewHeading>
                  <p className="receipt-submitter">
                    Submitted by {selected.researcherId.replaceAll("-", " ")}
                  </p>
                  <dl className="run-receipt">
                    <div>
                      <dt>Execution</dt>
                      <dd
                        className={
                          selected.run.outcome === "success"
                            ? "execution-good"
                            : ""
                        }
                      >
                        {selected.run.outcome.replaceAll("_", " ")}
                      </dd>
                    </div>
                    <div>
                      <dt>Duration</dt>
                      <dd>
                        {selected.run.durationMs} <span>ms</span>
                      </dd>
                    </div>
                    <div>
                      <dt>Transport</dt>
                      <dd>
                        {selected.run.response &&
                        typeof selected.run.response === "object" &&
                        selected.run.response.transport === "grpc"
                          ? `gRPC ${selected.run.response.grpcStatus ?? "unknown"}`
                          : `HTTP ${selected.run.httpStatus ?? "—"}`}
                      </dd>
                    </div>
                  </dl>
                  <details className="review-evidence">
                    <summary>Inspect run evidence</summary>
                    <pre>
                      {selected.run.response === null
                        ? "No response body was received."
                        : typeof selected.run.response === "string"
                          ? selected.run.response
                          : JSON.stringify(selected.run.response, null, 2)}
                    </pre>
                  </details>
                  {selected.feedback !== null && (
                    <div className="saved-feedback">
                      <h4>Reviewer feedback</h4>
                      <p>{selected.feedback}</p>
                      <small>
                        Decided by {selected.reviewerId} ·{" "}
                        {selected.decidedAt &&
                          new Date(selected.decidedAt).toLocaleString("en-NZ", {
                            day: "numeric",
                            month: "short",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                      </small>
                    </div>
                  )}
                  {session.actor.role === "reviewer" &&
                    selected.status === "pending" && (
                      <div className="review-decision">
                        <label htmlFor={`feedback-${selected.id}`}>
                          Feedback for run #{selected.runId} (required)
                        </label>
                        <p>What does this run tell the researcher?</p>
                        <textarea
                          id={`feedback-${selected.id}`}
                          placeholder="Leave a useful note…"
                          maxLength={2000}
                          value={drafts[selected.id] ?? ""}
                          disabled={busy}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [selected.id]: event.target.value,
                            }))
                          }
                        />
                        <div className="review-actions">
                          <span>
                            {requiresRefresh
                              ? "Refresh to confirm the current status."
                              : "Decisions are final."}
                          </span>
                          <button
                            className="reject-action"
                            type="button"
                            disabled={busy || requiresRefresh}
                            onClick={() => void decide(selected.id, "rejected")}
                            aria-label={`Reject run #${selected.runId}`}
                          >
                            Reject
                          </button>
                          <button
                            className="approve-action"
                            type="button"
                            disabled={busy || requiresRefresh}
                            onClick={() => void decide(selected.id, "approved")}
                            aria-label={`Approve run #${selected.runId}`}
                          >
                            Approve
                          </button>
                        </div>
                      </div>
                    )}
                  {session.actor.role === "reviewer" &&
                    selected.status !== "pending" &&
                    nextPending && (
                      <button
                        className="next-review"
                        type="button"
                        onClick={() => openReview(nextPending.id)}
                      >
                        Open next pending run →
                      </button>
                    )}
                </article>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
