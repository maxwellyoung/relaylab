import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_DATABASE_CONNECTIONS,
  buildMySqlPoolOptions,
  mySqlSslFromEnvironment,
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
      // A bounded queue and connect timeout surface a stalled shared server.
      queueLimit: 20,
      connectTimeout: 10_000,
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

  it("verifies MySQL TLS against a configured CA bundle", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "relaylab-ca-"));
    const bundle = path.join(directory, "bundle.pem");
    await writeFile(bundle, "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----\n");
    try {
      expect(mySqlSslFromEnvironment({})).toBeUndefined();
      expect(mySqlSslFromEnvironment({ RELAYLAB_DB_SSL: "true" })).toEqual({ rejectUnauthorized: true });
      expect(mySqlSslFromEnvironment({ RELAYLAB_DB_SSL: "true", RELAYLAB_DB_SSL_CA: bundle })).toEqual({
        rejectUnauthorized: true,
        ca: "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----\n",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("fails closed when MySQL credentials are incomplete", () => {
    expect(() => openDatabaseFromEnvironment({
      sqlitePath: ":memory:",
      environment: { RELAYLAB_DATABASE_DRIVER: "mysql" },
    })).toThrow("RELAYLAB_DB_HOST is required");
  });
});
