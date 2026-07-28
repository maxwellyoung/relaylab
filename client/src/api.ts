export const experimentBehaviors = [
  "healthy",
  "slow",
  "unavailable",
  "malformed",
] as const;

export type ExperimentBehavior = (typeof experimentBehaviors)[number];

export type RunOutcome =
  | "success"
  | "downstream_error"
  | "timeout"
  | "invalid_response"
  | "unreachable";

export type Experiment = {
  id: number;
  name: string;
  behavior: ExperimentBehavior;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type ExperimentRun = {
  id: number;
  experimentId: number;
  outcome: RunOutcome;
  httpStatus: number | null;
  durationMs: number;
  response: Record<string, unknown> | string | null;
  createdAt: string;
};

export type ExperimentDetails = Experiment & {
  runs: ExperimentRun[];
};

export type ExperimentInput = Pick<
  Experiment,
  "name" | "behavior" | "payload"
>;

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? `Request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function listExperiments(): Promise<Experiment[]> {
  return request("/api/experiments");
}

export function createExperiment(
  input: ExperimentInput,
): Promise<Experiment> {
  return request("/api/experiments", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getExperiment(
  experimentId: number,
): Promise<ExperimentDetails> {
  return request(`/api/experiments/${experimentId}`);
}

export function runExperiment(
  experimentId: number,
): Promise<ExperimentRun> {
  return request(`/api/experiments/${experimentId}/runs`, {
    method: "POST",
  });
}
