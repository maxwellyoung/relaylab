import { test, expect, submitRun, openReview } from "./fixtures";

test("phone queue navigation restores keyboard focus and keeps decision controls reachable", async ({
  actor,
}, testInfo) => {
  const researcher = await actor("Researcher A");
  await researcher
    .getByRole("button", { name: "Experiments", exact: true })
    .click();
  await researcher.getByText("Edit request payload", { exact: true }).click();
  const payload = researcher.getByRole("textbox", {
    name: "JSON request payload",
    exact: true,
  });
  await payload.fill("[");
  await researcher
    .getByRole("button", { name: "Run experiment", exact: true })
    .click();
  await expect(researcher.getByRole("alert")).toContainText(
    "Payload must be a valid JSON object",
  );
  await payload.fill('{"sample":"phone acceptance"}');
  const run = await submitRun(researcher);
  await researcher
    .getByRole("button", { name: "← All reviews", exact: true })
    .click();
  const row = researcher
    .getByRole("navigation", { name: "Submitted runs", exact: true })
    .getByRole("button", { name: new RegExp(`Run #${run.id}\\b`) });
  await row.focus();
  await row.press("Enter");
  await expect(
    researcher.getByRole("heading", { name: new RegExp(` · Run #${run.id}$`) }),
  ).toBeFocused();
  await researcher
    .getByRole("button", { name: "← All reviews", exact: true })
    .click();
  await expect(row).toBeFocused();
  await researcher
    .getByRole("searchbox", { name: "Search runs", exact: true })
    .fill("no matching receipt");
  await expect(
    researcher.getByText("No matching runs. Change the search or status.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(researcher.getByRole("article")).toHaveCount(0);
  expect(
    await researcher.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);

  const reviewer = await actor("Reviewer");
  await openReview(reviewer, run.id);
  await reviewer
    .getByLabel(`Feedback for run #${run.id} (required)`, { exact: true })
    .fill("Phone controls are reachable and the draft remains readable.");
  const approve = reviewer.getByRole("button", {
    name: `Approve run #${run.id}`,
    exact: true,
  });
  await approve.scrollIntoViewIfNeeded();
  expect((await approve.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  expect(
    await reviewer.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
  await reviewer.screenshot({
    path: testInfo.outputPath("phone-review-actions.png"),
  });
});
