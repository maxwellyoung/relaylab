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
  rpcErrorCode?: number | null;
  /** From the X-Correlation-Id response header, not the stored row. */
  correlationId?: string | null;
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

export type CoordinatorHealth = {
  status: string;
  service: string;
  database: string;
  downstreamTimeoutMs: number;
};

export function getHealth(): Promise<CoordinatorHealth> {
  return request("/health");
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

export async function runExperiment(
  experimentId: number,
): Promise<ExperimentRun> {
  // One id per click: it becomes the JSON-RPC exchange id the dependency logs,
  // and the idempotency key that lets a repeated request replay safely.
  const exchangeId = crypto.randomUUID();
  const response = await fetch(`${apiBaseUrl}/api/experiments/${experimentId}/runs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Request-Id": exchangeId,
      "Idempotency-Key": exchangeId,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed with ${response.status}`);
  }
  const run = (await response.json()) as ExperimentRun;
  // The coordinator returns the JSON-RPC id, which also appears in both logs.
  return { ...run, correlationId: response.headers.get("X-Correlation-Id") };
}

export async function deleteExperiment(experimentId: number): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/api/experiments/${experimentId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
  }
}
