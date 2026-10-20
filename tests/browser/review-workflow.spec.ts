import { test, expect, submitRun, openReview, refreshQueue } from "./fixtures";

test("researcher receives the reviewer's saved approval in a separate browser session", async ({
  actor,
}, testInfo) => {
  const researcher = await actor("Researcher A");
  const reviewer = await actor("Reviewer");
  const run = await submitRun(researcher);
  const receipt = await openReview(reviewer, run.id);
  await expect(
    receipt.getByText("Pending review", { exact: true }),
  ).toBeVisible();
  await reviewer
    .getByLabel(`Feedback for run #${run.id} (required)`, { exact: true })
    .fill("The execution evidence matches the submitted experiment.");
  await reviewer
    .getByRole("button", { name: `Approve run #${run.id}`, exact: true })
    .click();
  await expect(receipt.getByText("Approved", { exact: true })).toBeVisible();
  const researcherReceipt = await openReview(researcher, run.id);
  await expect(
    researcherReceipt.getByText("Approved", { exact: true }),
  ).toBeVisible();
  await expect(
    researcherReceipt.getByText(
      "The execution evidence matches the submitted experiment.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    researcherReceipt.getByText(run.outcome, { exact: true }),
  ).toBeVisible();
  await researcher.screenshot({
    path: testInfo.outputPath("researcher-approved.png"),
  });
});

test("reviewer must provide feedback and can reject a timeout without changing its execution outcome", async ({
  actor,
}) => {
  const researcher = await actor("Researcher A");
  const reviewer = await actor("Reviewer");
  const run = await submitRun(researcher, "slow");
  expect(run.outcome).toBe("timeout");
  const receipt = await openReview(reviewer, run.id);
  const reject = reviewer.getByRole("button", {
    name: `Reject run #${run.id}`,
    exact: true,
  });
  await reject.click();
  await expect(reviewer.getByRole("alert")).toContainText("Provide feedback");
  await expect(
    receipt.getByText("Pending review", { exact: true }),
  ).toBeVisible();
  const feedback =
    "Repeat the experiment with the deadline conditions explained.";
  await reviewer
    .getByLabel(`Feedback for run #${run.id} (required)`, { exact: true })
    .fill(feedback);
  await reject.click();
  await expect(receipt.getByText("Rejected", { exact: true })).toBeVisible();
  const researcherReceipt = await openReview(researcher, run.id);
  await expect(
    researcherReceipt.getByText("Rejected", { exact: true }),
  ).toBeVisible();
  await expect(
    researcherReceipt.getByText(feedback, { exact: true }),
  ).toBeVisible();
  await expect(
    researcherReceipt.getByText("timeout", { exact: true }),
  ).toBeVisible();
});

test("researcher review lists stay separate while the reviewer can inspect both submissions", async ({
  actor,
}) => {
  const firstResearcher = await actor("Researcher A");
  const first = await submitRun(firstResearcher);
  const secondResearcher = await actor("Researcher B");
  await expect(
    secondResearcher.getByText("No submitted runs yet.", { exact: true }),
  ).toBeVisible();
  const second = await submitRun(secondResearcher);
  const ownQueue = await refreshQueue(secondResearcher);
  await expect(
    ownQueue.getByRole("button", { name: new RegExp(`Run #${first.id}\\b`) }),
  ).toHaveCount(0);
  await expect(
    ownQueue.getByRole("button", { name: new RegExp(`Run #${second.id}\\b`) }),
  ).toHaveCount(1);
  const reviewer = await actor("Reviewer");
  await openReview(reviewer, first.id);
  await openReview(reviewer, second.id);
  const firstQueue = await refreshQueue(firstResearcher);
  await expect(
    firstQueue.getByRole("button", { name: new RegExp(`Run #${first.id}\\b`) }),
  ).toHaveCount(1);
  await expect(
    firstQueue.getByRole("button", {
      name: new RegExp(`Run #${second.id}\\b`),
    }),
  ).toHaveCount(0);
});

test("reviewer keeps per-run drafts and requires a successful refresh after a browser network outage", async ({
  actor,
}, testInfo) => {
  const researcher = await actor("Researcher A");
  const first = await submitRun(researcher);
  const reviewer = await actor("Reviewer");
  const firstReceipt = await openReview(reviewer, first.id);
  const firstFeedback = reviewer.getByLabel(
    `Feedback for run #${first.id} (required)`,
    { exact: true },
  );
  await firstFeedback.fill("Draft for the first run.");
  const second = await submitRun(researcher);
  await reviewer
    .getByRole("button", { name: "Refresh reviews", exact: true })
    .click();
  await expect(
    reviewer.getByText("Reviews refreshed.", { exact: true }),
  ).toBeVisible();
  await expect(firstFeedback).toHaveValue("Draft for the first run.");
  await openReview(reviewer, second.id);
  await reviewer
    .getByLabel(`Feedback for run #${second.id} (required)`, { exact: true })
    .fill("A separate draft for the second run.");
  await openReview(reviewer, first.id);
  await expect(firstFeedback).toHaveValue("Draft for the first run.");

  // Only this browser context loses connectivity; all successful calls still use the real API.
  await reviewer.context().setOffline(true);
  await reviewer
    .getByRole("button", { name: "Refresh reviews", exact: true })
    .click();
  await expect(reviewer.getByRole("alert")).toContainText(
    "Showing the last retrieved reviews",
  );
  await expect(firstFeedback).toBeEditable();
  const approve = reviewer.getByRole("button", {
    name: `Approve run #${first.id}`,
    exact: true,
  });
  await expect(approve).toBeDisabled();
  const feedback =
    "Draft preserved through the outage and then verified against current evidence.";
  await firstFeedback.fill(feedback);
  await reviewer.screenshot({
    path: testInfo.outputPath("reviewer-offline.png"),
  });
  await reviewer.context().setOffline(false);
  await reviewer
    .getByRole("button", { name: "Refresh reviews", exact: true })
    .click();
  await expect(
    reviewer.getByText("Reviews refreshed.", { exact: true }),
  ).toBeVisible();
  await expect(approve).toBeEnabled();
  await expect(firstFeedback).toHaveValue(feedback);

  await reviewer
    .getByRole("button", { name: "How it works", exact: true })
    .click();
  await expect(
    reviewer.getByRole("heading", { name: "How RelayLab works", exact: true }),
  ).toBeVisible();
  await reviewer
    .getByRole("button", { name: "Open run reviews", exact: true })
    .click();
  await expect(firstFeedback).toHaveValue(feedback);
  await approve.click();
  await expect(
    firstReceipt.getByText("Approved", { exact: true }),
  ).toBeVisible();
  const researcherReceipt = await openReview(researcher, first.id);
  await expect(
    researcherReceipt.getByText(feedback, { exact: true }),
  ).toBeVisible();
});

test("a stale reviewer sees the winning decision instead of overwriting it", async ({
  actor,
}) => {
  const researcher = await actor("Researcher A");
  const run = await submitRun(researcher);
  const firstReviewer = await actor("Reviewer");
  const secondReviewer = await actor("Reviewer");
  const firstReceipt = await openReview(firstReviewer, run.id);
  await openReview(secondReviewer, run.id);
  await secondReviewer
    .getByLabel(`Feedback for run #${run.id} (required)`, { exact: true })
    .fill("A stale competing rejection.");
  const feedback = "This is the first saved decision.";
  await firstReviewer
    .getByLabel(`Feedback for run #${run.id} (required)`, { exact: true })
    .fill(feedback);
  await firstReviewer
    .getByRole("button", { name: `Approve run #${run.id}`, exact: true })
    .click();
  await expect(
    firstReceipt.getByText("Approved", { exact: true }),
  ).toBeVisible();
  await secondReviewer
    .getByRole("button", { name: `Reject run #${run.id}`, exact: true })
    .click();
  await expect(secondReviewer.getByRole("alert")).toContainText(
    "already been reviewed",
  );
  const secondReceipt = secondReviewer.getByRole("article", {
    name: new RegExp(` · Run #${run.id}$`),
  });
  await expect(
    secondReceipt.getByText("Approved", { exact: true }),
  ).toBeVisible();
  await expect(
    secondReceipt.getByText(feedback, { exact: true }),
  ).toBeVisible();
  await expect(
    secondReviewer.getByLabel(`Feedback for run #${run.id} (required)`, {
      exact: true,
    }),
  ).toHaveCount(0);
  const researcherReceipt = await openReview(researcher, run.id);
  await expect(
    researcherReceipt.getByText(feedback, { exact: true }),
  ).toBeVisible();
});
