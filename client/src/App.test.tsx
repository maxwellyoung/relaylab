import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import {
  createExperiment,
  deleteExperiment,
  getExperiment,
  listExperiments,
  runExperiment,
  type Experiment,
  type ExperimentDetails,
  type ExperimentRun,
} from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    createExperiment: vi.fn(),
    deleteExperiment: vi.fn(),
    getExperiment: vi.fn(),
    listExperiments: vi.fn(),
    runExperiment: vi.fn(),
  };
});

const mockedCreateExperiment = vi.mocked(createExperiment);
const mockedGetExperiment = vi.mocked(getExperiment);
const mockedListExperiments = vi.mocked(listExperiments);
const mockedRunExperiment = vi.mocked(runExperiment);
const mockedDeleteExperiment = vi.mocked(deleteExperiment);

const createdAt = "2026-08-11T00:00:00.000Z";

function experiment(overrides: Partial<Experiment> = {}): Experiment {
  return {
    id: 1,
    name: "Unavailable dependency",
    behavior: "unavailable",
    payload: { orderId: "ORDER-42", quantity: 2 },
    createdAt,
    ...overrides,
  };
}

function run(overrides: Partial<ExperimentRun> = {}): ExperimentRun {
  return {
    id: 7,
    experimentId: 1,
    outcome: "downstream_error",
    httpStatus: 200,
    durationMs: 31,
    response: {
      jsonrpc: "2.0",
      id: "trace-7",
      error: { code: -32001, message: "Dependency unavailable" },
    },
    createdAt,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedListExperiments.mockResolvedValue([]);
});

describe("RelayLab browser workflow", () => {
  it("cannot run the previous experiment while a new selection is loading", async () => {
    const user = userEvent.setup();
    const first = experiment({ id: 1, name: "First experiment" });
    const second = experiment({ id: 2, name: "Second experiment", behavior: "healthy" });
    let resolveSelection!: (value: ExperimentDetails) => void;
    const pending = new Promise<ExperimentDetails>((resolve) => { resolveSelection = resolve; });
    mockedListExperiments.mockResolvedValue([first, second]);
    mockedGetExperiment
      .mockResolvedValueOnce({ ...first, runs: [run()] })
      .mockReturnValueOnce(pending)
      .mockResolvedValue({ ...second, runs: [run({ experimentId: 2, outcome: "success" })] });
    mockedRunExperiment.mockResolvedValue(run({ experimentId: 2, outcome: "success" }));
    render(<App />);
    await screen.findByRole("heading", { name: "RPC method failed" });
    await user.click(screen.getByText("Saved experiments"));
    await user.click(screen.getByRole("button", { name: "Open Second experiment" }));
    const loading = screen.getByRole("button", { name: "Loading…" });
    expect(loading).toBeDisabled();
    expect(screen.getByLabelText("Dependency behavior")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Open First experiment" })).toBeDisabled();
    await user.click(loading);
    expect(mockedRunExperiment).not.toHaveBeenCalled();
    resolveSelection({ ...second, runs: [] });
    await waitFor(() => expect(screen.getByRole("button", { name: "Run again" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Run again" }));
    await waitFor(() => expect(mockedRunExperiment).toHaveBeenCalledWith(2));
    expect(mockedRunExperiment).toHaveBeenCalledTimes(1);
  });

  it("deletes a saved experiment and clears it from the list", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const saved = experiment({ id: 3, name: "Disposable experiment" });
    mockedListExperiments.mockResolvedValueOnce([saved]).mockResolvedValueOnce([]);
    mockedGetExperiment.mockResolvedValue({ ...saved, runs: [run({ experimentId: 3 })] });
    mockedDeleteExperiment.mockResolvedValue(undefined);
    render(<App />);
    await screen.findByRole("heading", { name: "RPC method failed" });
    await user.click(screen.getByText("Saved experiments"));

    await user.click(screen.getByRole("button", { name: /Delete Disposable experiment/ }));

    await waitFor(() => expect(mockedDeleteExperiment).toHaveBeenCalledWith(3));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Open Disposable experiment" })).toBeNull());
    expect(screen.getByText("Your first completed request will be stored here.")).toBeVisible();
  });

  it("keeps the experiment when the delete confirmation is declined", async () => {
    const user = userEvent.setup();
    const saved = experiment({ id: 5, name: "Keep me" });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    mockedListExperiments.mockResolvedValue([saved]);
    mockedGetExperiment.mockResolvedValue({ ...saved, runs: [run({ experimentId: 5 })] });
    render(<App />);
    await screen.findByRole("heading", { name: "RPC method failed" });
    await user.click(screen.getByText("Saved experiments"));

    await user.click(screen.getByRole("button", { name: /Delete Keep me/ }));

    expect(confirm).toHaveBeenCalled();
    expect(mockedDeleteExperiment).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Open Keep me" })).toBeVisible();
  });

  it("shows the correlation ID the coordinator returned for a run", async () => {
    const user = userEvent.setup();
    const saved = experiment({ id: 4, behavior: "healthy", name: "Correlated" });
    mockedListExperiments.mockResolvedValue([saved]);
    mockedGetExperiment.mockResolvedValue({ ...saved, runs: [] });
    mockedRunExperiment.mockResolvedValue(run({
      experimentId: 4,
      outcome: "success",
      httpStatus: 200,
      correlationId: "4f2b91ac-7a10-4c0e-9f2f-1d7c2b8e5a33",
    }));
    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: /^Run/ })).toBeEnabled());

    await user.click(screen.getByRole("button", { name: /^Run/ }));

    const correlation = await screen.findByText("4f2b91ac");
    expect(correlation).toBeVisible();
  });

  it("creates, runs, and renders durable failure evidence", async () => {
    const user = userEvent.setup();
    const savedExperiment = experiment();
    const savedRun = run();
    const details: ExperimentDetails = {
      ...savedExperiment,
      runs: [savedRun],
    };

    mockedCreateExperiment.mockResolvedValue(savedExperiment);
    mockedRunExperiment.mockResolvedValue(savedRun);
    mockedGetExperiment.mockResolvedValue(details);
    mockedListExperiments
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([savedExperiment]);

    render(<App />);

    await waitFor(() => expect(mockedListExperiments).toHaveBeenCalled());
    await user.click(screen.getByText("Saved experiments"));
    expect(
      screen.getByText("Your first completed request will be stored here."),
    ).toBeVisible();

    await user.selectOptions(
      screen.getByLabelText("Dependency behavior"),
      "unavailable",
    );
    await user.click(screen.getByRole("button", { name: "Run experiment" }));

    const result = await screen.findByRole("heading", {
      name: "RPC method failed",
    });
    const resultCard = result.closest("article");
    expect(resultCard).not.toBeNull();
    expect(within(resultCard!).getByText("−32001")).toBeVisible();
    expect(within(resultCard!).getByText("31 ms")).toBeVisible();
    expect(screen.getByText("1 saved · 1 in selected")).toBeVisible();

    expect(mockedCreateExperiment).toHaveBeenCalledWith({
      name: "Unavailable dependency",
      behavior: "unavailable",
      payload: { orderId: "ORDER-42", quantity: 2 },
    });
    expect(mockedRunExperiment).toHaveBeenCalledWith(1);
    expect(mockedGetExperiment).toHaveBeenCalledWith(1);
  });

  it("rejects invalid JSON before making a persistence request", async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(mockedListExperiments).toHaveBeenCalled());
    await user.click(screen.getByText("Saved experiments"));
    expect(
      screen.getByText("Your first completed request will be stored here."),
    ).toBeVisible();

    await user.click(screen.getByText("Edit request payload"));
    const payload = screen.getByLabelText("JSON request payload");
    await user.clear(payload);
    await user.type(payload, "not json");
    await user.click(screen.getByRole("button", { name: "Run experiment" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Payload must be a valid JSON object.",
    );
    expect(mockedCreateExperiment).not.toHaveBeenCalled();
    expect(mockedRunExperiment).not.toHaveBeenCalled();
  });

  it("loads a saved experiment and reopens its latest run", async () => {
    const savedExperiment = experiment({
      id: 2,
      name: "Healthy dependency",
      behavior: "healthy",
    });
    const savedRun = run({
      id: 8,
      experimentId: 2,
      outcome: "success",
      httpStatus: 200,
      durationMs: 18,
      response: {
        jsonrpc: "2.0",
        id: "trace-8",
        result: {
          accepted: true,
          experimentId: 2,
          echo: { orderId: "ORDER-42", quantity: 2 },
          processedAt: createdAt,
        },
      },
    });

    mockedListExperiments.mockResolvedValue([savedExperiment]);
    mockedGetExperiment.mockResolvedValue({
      ...savedExperiment,
      runs: [savedRun],
    });

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Request completed" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Run again" })).toBeVisible();
    expect(screen.getByText("1 saved · 1 in selected")).toBeVisible();
    expect(mockedGetExperiment).toHaveBeenCalledWith(2);
  });

  it("labels a rejected method result as invalid RPC evidence", async () => {
    const savedExperiment = experiment({
      id: 3,
      name: "Malformed dependency",
      behavior: "malformed",
    });
    const savedRun = run({
      id: 9,
      experimentId: 3,
      outcome: "invalid_response",
      httpStatus: 200,
      response: {
        jsonrpc: "2.0",
        id: "trace-9",
        result: "upstream said maybe",
      },
    });

    mockedListExperiments.mockResolvedValue([savedExperiment]);
    mockedGetExperiment.mockResolvedValue({
      ...savedExperiment,
      runs: [savedRun],
    });

    render(<App />);

    const heading = await screen.findByRole("heading", {
      name: "Contract rejected",
    });
    const resultCard = heading.closest("article");
    expect(resultCard).not.toBeNull();
    expect(within(resultCard!).getByText("invalid")).toBeVisible();
  });
});
