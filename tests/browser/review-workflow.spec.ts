import { test, expect, submitRun, openReview } from "./fixtures";

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
  const ownQueue = secondResearcher.getByRole("navigation", {
    name: "Submitted runs",
    exact: true,
  });
  await expect(
    ownQueue.getByRole("button", { name: new RegExp(`Run #${first.id}\\b`) }),
  ).toHaveCount(0);
  await expect(
    ownQueue.getByRole("button", { name: new RegExp(`Run #${second.id}\\b`) }),
  ).toHaveCount(1);
  const reviewer = await actor("Reviewer");
  await openReview(reviewer, first.id);
  await openReview(reviewer, second.id);
  await firstResearcher
    .getByRole("button", { name: "Refresh reviews", exact: true })
    .click();
  await expect(
    firstResearcher.getByText("Reviews refreshed.", { exact: true }),
  ).toBeVisible();
  await expect(
    firstResearcher
      .getByRole("navigation", { name: "Submitted runs", exact: true })
      .getByRole("button", { name: new RegExp(`Run #${second.id}\\b`) }),
  ).toHaveCount(0);
});
