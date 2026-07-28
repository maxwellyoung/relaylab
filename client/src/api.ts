export type PracticeSession = {
  id: number;
  playedAt: string;
  map: string;
  goal: string;
  durationMinutes: number;
  createdAt: string;
};

export type DrillResult = {
  id: number;
  sessionId: number;
  drillName: string;
  attempts: number;
  successes: number;
  notes: string;
  createdAt: string;
};

export type PracticeSessionDetails = PracticeSession & {
  results: DrillResult[];
};

export type SessionInput = Pick<
  PracticeSession,
  "playedAt" | "map" | "goal" | "durationMinutes"
>;

export type DrillResultInput = Pick<
  DrillResult,
  "drillName" | "attempts" | "successes" | "notes"
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

export function listSessions(): Promise<PracticeSession[]> {
  return request("/api/sessions");
}

export function createSession(input: SessionInput): Promise<PracticeSession> {
  return request("/api/sessions", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getSession(
  sessionId: number,
): Promise<PracticeSessionDetails> {
  return request(`/api/sessions/${sessionId}`);
}

export function addDrillResult(
  sessionId: number,
  input: DrillResultInput,
): Promise<DrillResult> {
  return request(`/api/sessions/${sessionId}/results`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
