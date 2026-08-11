import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import {
  createExperiment,
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
    getExperiment: vi.fn(),
    listExperiments: vi.fn(),
    runExperiment: vi.fn(),
  };
});

const mockedCreateExperiment = vi.mocked(createExperiment);
const mockedGetExperiment = vi.mocked(getExperiment);
const mockedListExperiments = vi.mocked(listExperiments);
const mockedRunExperiment = vi.mocked(runExperiment);

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
});
