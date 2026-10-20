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
