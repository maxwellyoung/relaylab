import { describe, expect, it } from "vitest";
import {
  MAX_DATABASE_CONNECTIONS,
  buildMySqlPoolOptions,
  openDatabaseFromEnvironment,
} from "../src/database.js";

describe("lecturer database configuration", () => {
  it("hard-limits the MySQL connection pool to five connections", () => {
    const options = buildMySqlPoolOptions({
      host: "database.example.test",
      port: 3306,
      database: "student_schema",
      user: "student_user",
      password: "local-secret",
    });

    expect(MAX_DATABASE_CONNECTIONS).toBe(5);
    expect(options).toMatchObject({
      host: "database.example.test",
      port: 3306,
      database: "student_schema",
      user: "student_user",
      password: "local-secret",
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
    });
  });

  it("keeps SQLite as the credential-free default", async () => {
    const database = openDatabaseFromEnvironment({
      sqlitePath: ":memory:",
      environment: {},
    });

    expect(await database.listExperiments()).toEqual([]);
    await database.close();
  });

  it("fails closed when MySQL credentials are incomplete", () => {
    expect(() => openDatabaseFromEnvironment({
      sqlitePath: ":memory:",
      environment: { RELAYLAB_DATABASE_DRIVER: "mysql" },
    })).toThrow("RELAYLAB_DB_HOST is required");
  });
});
