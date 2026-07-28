import Database from "better-sqlite3";

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

type PracticeSessionRow = {
  id: number;
  played_at: string;
  map: string;
  goal: string;
  duration_minutes: number;
  created_at: string;
};

type DrillResultRow = {
  id: number;
  session_id: number;
  drill_name: string;
  attempts: number;
  successes: number;
  notes: string;
  created_at: string;
};

function toPracticeSession(row: PracticeSessionRow): PracticeSession {
  return {
    id: row.id,
    playedAt: row.played_at,
    map: row.map,
    goal: row.goal,
    durationMinutes: row.duration_minutes,
    createdAt: row.created_at,
  };
}

function toDrillResult(row: DrillResultRow): DrillResult {
  return {
    id: row.id,
    sessionId: row.session_id,
    drillName: row.drill_name,
    attempts: row.attempts,
    successes: row.successes,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export function openDatabase(databasePath: string) {
  const database = new Database(databasePath);
  database.pragma("foreign_keys = ON");
  database.pragma("journal_mode = WAL");
  database.exec(`
    CREATE TABLE IF NOT EXISTS practice_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      played_at TEXT NOT NULL,
      map TEXT NOT NULL,
      goal TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS drill_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      drill_name TEXT NOT NULL,
      attempts INTEGER NOT NULL,
      successes INTEGER NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id)
        REFERENCES practice_sessions(id)
        ON DELETE CASCADE
    );
  `);

  const insertSession = database.prepare<
    {
      playedAt: string;
      map: string;
      goal: string;
      durationMinutes: number;
    },
    PracticeSessionRow
  >(`
    INSERT INTO practice_sessions (
      played_at,
      map,
      goal,
      duration_minutes
    ) VALUES (
      @playedAt,
      @map,
      @goal,
      @durationMinutes
    )
    RETURNING *
  `);

  const listSessions = database.prepare<[], PracticeSessionRow>(`
    SELECT *
    FROM practice_sessions
    ORDER BY played_at DESC, id DESC
  `);

  const findSession = database.prepare<[number], PracticeSessionRow>(`
    SELECT *
    FROM practice_sessions
    WHERE id = ?
  `);

  const insertResult = database.prepare<
    {
      sessionId: number;
      drillName: string;
      attempts: number;
      successes: number;
      notes: string;
    },
    DrillResultRow
  >(`
    INSERT INTO drill_results (
      session_id,
      drill_name,
      attempts,
      successes,
      notes
    ) VALUES (
      @sessionId,
      @drillName,
      @attempts,
      @successes,
      @notes
    )
    RETURNING *
  `);

  const listResults = database.prepare<[number], DrillResultRow>(`
    SELECT *
    FROM drill_results
    WHERE session_id = ?
    ORDER BY id ASC
  `);

  return {
    createSession(
      input: Omit<PracticeSession, "id" | "createdAt">,
    ): PracticeSession {
      const row = insertSession.get(input);
      if (!row) {
        throw new Error("SQLite did not return the created practice session");
      }
      return toPracticeSession(row);
    },
    listSessions(): PracticeSession[] {
      return listSessions.all().map(toPracticeSession);
    },
    getSession(sessionId: number): PracticeSessionDetails | undefined {
      const session = findSession.get(sessionId);
      if (!session) {
        return undefined;
      }

      return {
        ...toPracticeSession(session),
        results: listResults.all(sessionId).map(toDrillResult),
      };
    },
    createResult(input: Omit<DrillResult, "id" | "createdAt">): DrillResult {
      const row = insertResult.get(input);
      if (!row) {
        throw new Error("SQLite did not return the created drill result");
      }
      return toDrillResult(row);
    },
    close() {
      database.close();
    },
  };
}

export type AimLedgerDatabase = ReturnType<typeof openDatabase>;
