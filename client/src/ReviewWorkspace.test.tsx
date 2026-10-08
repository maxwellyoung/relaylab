import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import ReviewWorkspace from "./ReviewWorkspace";
import { ApiError, createDemoSession, listReviews, submitReview, decideReview, type RunReview } from "./api";

vi.mock("./api", async (original) => ({
  ...await original<typeof import("./api")>(),
  createDemoSession: vi.fn(), listReviews: vi.fn(), submitReview: vi.fn(), decideReview: vi.fn(), endDemoSession: vi.fn(),
}));
const review: RunReview = {
  id: 1, runId: 7, researcherId: "researcher-a", status: "pending", feedback: null, reviewerId: null,
  submittedAt: "2026-10-08T00:00:00.000Z", decidedAt: null, experimentName: "Unavailable dependency",
  run: { id: 7, experimentId: 1, outcome: "unreachable", httpStatus: null, durationMs: 2, response: null, createdAt: "2026-10-08T00:00:00.000Z" },
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listReviews).mockResolvedValue([]);
  vi.mocked(createDemoSession).mockImplementation(async (id) => ({ token: `demo-${id}`, actor: { id, name: id === "reviewer" ? "Reviewer" : "Researcher A", role: id === "reviewer" ? "reviewer" : "researcher" } }));
});

it("submits the selected run and displays its independent pending review status", async () => {
  const user = userEvent.setup();
  vi.mocked(submitReview).mockResolvedValue(review);
  render(<ReviewWorkspace latestRun={review.run} runBusy={false} onRoleChange={() => {}} />);
  await user.click(screen.getByRole("button", { name: "Researcher A" }));
  await screen.findByText("No submitted runs yet.");
  await user.click(screen.getByRole("button", { name: "Submit run #7 for review" }));
  await screen.findByRole("heading", { name: "Unavailable dependency · Run #7" });
  expect(screen.getByText("Pending review")).toBeVisible();
  expect(vi.mocked(submitReview)).toHaveBeenCalledWith("demo-researcher-a", 7);
});

it("requires feedback, shows evidence, and saves the reviewer's rejection", async () => {
  const user = userEvent.setup();
  vi.mocked(listReviews).mockResolvedValue([review]);
  vi.mocked(decideReview).mockResolvedValue({ ...review, status: "rejected", feedback: "Repeat with the dependency running.", reviewerId: "reviewer", decidedAt: "2026-10-08T00:01:00.000Z" });
  const roleChanged = vi.fn();
  render(<ReviewWorkspace latestRun={null} runBusy={false} onRoleChange={roleChanged} />);
  await user.click(screen.getByRole("button", { name: "Reviewer" }));
  await screen.findByRole("heading", { name: "Reviewer queue" });
  await user.click(screen.getByText("Inspect run evidence"));
  expect(screen.getByText("No response body was received.")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Reject run #7" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Provide feedback");
  expect(decideReview).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText("Feedback for run #7 (required)"), "Repeat with the dependency running.");
  await user.click(screen.getByRole("button", { name: "Reject run #7" }));
  await screen.findByText("Rejected");
  expect(screen.getByText("Repeat with the dependency running.", { exact: false })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Reject run #7" })).toBeNull();
  expect(decideReview).toHaveBeenCalledWith("demo-reviewer", 1, "rejected", "Repeat with the dependency running.");
  expect(roleChanged).toHaveBeenCalledWith("reviewer");
});

it("keeps the previous data visible after a failed refresh and retries successfully", async () => {
  const user = userEvent.setup();
  vi.mocked(listReviews).mockResolvedValueOnce([review]).mockRejectedValueOnce(new ApiError("Persistence temporarily unavailable", 503)).mockResolvedValueOnce([{ ...review, status: "approved", feedback: "Good evidence", reviewerId: "reviewer" }]);
  render(<ReviewWorkspace latestRun={review.run} runBusy={false} onRoleChange={() => {}} />);
  await user.click(screen.getByRole("button", { name: "Researcher A" }));
  await screen.findByText("Pending review");
  await user.click(screen.getByRole("button", { name: "Refresh reviews" }));
  await screen.findByRole("alert");
  expect(screen.getByText("Pending review")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Refresh reviews" }));
  await screen.findByText("Approved");
  expect(screen.queryByRole("alert")).toBeNull();
});

it("clears private review rows and role state when a session expires", async () => {
  const user = userEvent.setup();
  const roleChanged = vi.fn();
  vi.mocked(listReviews).mockResolvedValueOnce([review]).mockRejectedValueOnce(new ApiError("Choose a demo account again", 401));
  render(<ReviewWorkspace latestRun={null} runBusy={false} onRoleChange={roleChanged} />);
  await user.click(screen.getByRole("button", { name: "Researcher A" }));
  await screen.findByText("Pending review");
  await user.click(screen.getByRole("button", { name: "Refresh reviews" }));
  await screen.findByRole("alert");
  expect(screen.queryByText("Pending review")).toBeNull();
  expect(roleChanged).toHaveBeenLastCalledWith(null);
});

it("loads the competing decision after a stale reviewer submission is refused", async () => {
  const user = userEvent.setup();
  vi.mocked(listReviews).mockResolvedValueOnce([review]).mockResolvedValueOnce([{ ...review, status: "approved", feedback: "Already decided", reviewerId: "reviewer" }]);
  vi.mocked(decideReview).mockRejectedValue(new ApiError("Already reviewed; refresh", 409));
  render(<ReviewWorkspace latestRun={null} runBusy={false} onRoleChange={() => {}} />);
  await user.click(screen.getByRole("button", { name: "Reviewer" }));
  await screen.findByText("Pending review");
  await user.type(screen.getByLabelText("Feedback for run #7 (required)"), "My decision");
  await user.click(screen.getByRole("button", { name: "Reject run #7" }));
  await screen.findByText("Approved");
  expect(screen.getByRole("alert")).toHaveTextContent("Already reviewed");
  expect(screen.queryByLabelText("Feedback for run #7 (required)")).toBeNull();
});

it("blocks submission and identity changes while the selected experiment is changing", async () => {
  const user = userEvent.setup();
  const { rerender } = render(<ReviewWorkspace latestRun={review.run} runBusy={false} onRoleChange={() => {}} />);
  await user.click(screen.getByRole("button", { name: "Researcher A" }));
  await screen.findByText("No submitted runs yet.");
  rerender(<ReviewWorkspace latestRun={review.run} runBusy={true} onRoleChange={() => {}} />);
  expect(screen.getByRole("button", { name: "Submit run #7 for review" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Reviewer" })).toBeDisabled();
});

it("keeps each run's feedback draft while switching focused receipts", async () => {
  const user = userEvent.setup();
  const second = { ...review, id: 2, runId: 8, experimentName: "Healthy execution", run: { ...review.run, id: 8 } };
  vi.mocked(listReviews).mockResolvedValue([review, second]);
  render(<ReviewWorkspace latestRun={null} runBusy={false} onRoleChange={() => {}} />);
  await user.click(screen.getByRole("button", { name: "Reviewer" }));
  await user.type(await screen.findByLabelText("Feedback for run #7 (required)"), "Keep this draft with run seven.");
  await user.click(screen.getByRole("button", { name: /Run #8.*Healthy execution/ }));
  expect(screen.getByLabelText("Feedback for run #8 (required)")).toHaveValue("");
  await user.click(screen.getByRole("button", { name: /Run #7.*Unavailable dependency/ }));
  expect(screen.getByLabelText("Feedback for run #7 (required)")).toHaveValue("Keep this draft with run seven.");
  expect(decideReview).not.toHaveBeenCalled();
});

it("preserves the focused receipt when a refresh reorders the queue", async () => {
  const user = userEvent.setup();
  const second = { ...review, id: 2, runId: 8, experimentName: "Healthy execution", run: { ...review.run, id: 8 } };
  vi.mocked(listReviews).mockResolvedValueOnce([review, second]).mockResolvedValueOnce([second, review]);
  render(<ReviewWorkspace latestRun={null} runBusy={false} onRoleChange={() => {}} />);
  await user.click(screen.getByRole("button", { name: "Reviewer" }));
  await user.type(await screen.findByLabelText("Feedback for run #7 (required)"), "Continue reviewing the same receipt.");
  await user.click(screen.getByRole("button", { name: "Refresh reviews" }));
  await screen.findByText("Reviews refreshed.");
  expect(screen.getByLabelText("Feedback for run #7 (required)")).toHaveValue("Continue reviewing the same receipt.");
  expect(screen.queryByLabelText("Feedback for run #8 (required)")).toBeNull();
});

it("keeps drafts editable but requires a successful refresh before deciding from stale evidence", async () => {
  const user = userEvent.setup();
  vi.mocked(listReviews).mockResolvedValueOnce([review]).mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce([review]);
  render(<ReviewWorkspace latestRun={null} runBusy={false} onRoleChange={() => {}} />);
  await user.click(screen.getByRole("button", { name: "Reviewer" }));
  const feedback = await screen.findByLabelText("Feedback for run #7 (required)");
  await user.type(feedback, "Keep my draft during the outage.");
  await user.click(screen.getByRole("button", { name: "Refresh reviews" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("last retrieved reviews");
  expect(feedback).toBeEnabled();
  expect(feedback).toHaveValue("Keep my draft during the outage.");
  expect(screen.getByRole("button", { name: "Approve run #7" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Refresh reviews" }));
  await screen.findByText("Reviews refreshed.");
  expect(screen.getByRole("button", { name: "Approve run #7" })).toBeEnabled();
  expect(feedback).toHaveValue("Keep my draft during the outage.");
});
