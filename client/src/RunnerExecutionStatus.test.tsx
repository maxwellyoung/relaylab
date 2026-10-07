import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import RunnerExecutionStatus from "./RunnerExecutionStatus";
import { getRunnerExecution, ApiError } from "./api";
vi.mock("./api", async (original) => ({ ...await original<typeof import("./api")>(), getRunnerExecution: vi.fn() }));

it("inspects live runner state separately from the immutable recorded attempt", async () => {
  vi.mocked(getRunnerExecution).mockResolvedValue({ executionId: "job-1", operationId: "op-1", experimentRef: "experiment-1", state: "COMPLETED", outcome: "success", resultJson: '{"accepted":true}', startedAt: "2026-10-08T00:00:00.000Z", completedAt: "2026-10-08T00:00:01.000Z" });
  const user = userEvent.setup();
  render(<RunnerExecutionStatus runId={1} disabled={false} />);
  await user.click(screen.getByRole("button", { name: "Check runner execution" }));
  await screen.findByText("Runner state: COMPLETED · success");
  expect(screen.getByText("The recorded attempt above stays unchanged.")).toBeVisible();
  expect(getRunnerExecution).toHaveBeenCalledWith(1);
});

it("keeps the last runner result visible during a failed refresh and lets the caller retry", async () => {
  vi.mocked(getRunnerExecution).mockResolvedValueOnce({ executionId: "job-2", operationId: "op-2", experimentRef: "experiment-2", state: "RUNNING", outcome: "", resultJson: "", startedAt: "2026-10-08T00:00:00.000Z", completedAt: "" })
    .mockRejectedValueOnce(new ApiError("Runner unavailable", 503))
    .mockResolvedValueOnce({ executionId: "job-2", operationId: "op-2", experimentRef: "experiment-2", state: "COMPLETED", outcome: "success", resultJson: '{"accepted":true}', startedAt: "2026-10-08T00:00:00.000Z", completedAt: "2026-10-08T00:00:01.000Z" });
  const user = userEvent.setup();
  render(<RunnerExecutionStatus runId={2} disabled={false} />);
  await user.click(screen.getByRole("button", { name: "Check runner execution" }));
  await screen.findByText("Runner state: RUNNING");
  await user.click(screen.getByRole("button", { name: "Check runner execution" }));
  await screen.findByRole("alert");
  expect(screen.getByText("Last retrieved runner state: RUNNING")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Check runner execution" }));
  await screen.findByText("Runner state: COMPLETED · success");
  expect(screen.queryByRole("alert")).toBeNull();
});
