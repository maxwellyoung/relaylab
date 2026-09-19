import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  experimentResponseV1Schema,
  experimentRunResponseV1Schema,
} from "../src/public-contract.js";

const root = fileURLToPath(new URL("../..", import.meta.url));

async function readJson(relativePath: string): Promise<unknown> {
  return JSON.parse(await readFile(`${root}/${relativePath}`, "utf8")) as unknown;
}

describe("browser-facing REST contract", () => {
  it("documents only the five frozen resource operations and their status codes", async () => {
    const document = await readJson("docs/openapi.json") as {
      openapi: string;
      paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
    };

    expect(document.openapi).toBe("3.1.0");
    expect(Object.keys(document.paths).sort()).toEqual([
      "/api/experiments",
      "/api/experiments/{experimentId}",
      "/api/experiments/{experimentId}/runs",
    ]);
    expect(Object.keys(document.paths["/api/experiments"]).sort()).toEqual(["get", "post"]);
    expect(Object.keys(document.paths["/api/experiments"].post.responses).sort()).toEqual(["201", "400", "503"]);
    expect(Object.keys(document.paths["/api/experiments"].get.responses).sort()).toEqual(["200", "503"]);
    expect(Object.keys(document.paths["/api/experiments/{experimentId}"]).sort()).toEqual(["delete", "get"]);
    expect(Object.keys(document.paths["/api/experiments/{experimentId}"].delete.responses).sort()).toEqual(["204", "404", "503"]);
    expect(Object.keys(document.paths["/api/experiments/{experimentId}"].get.responses).sort()).toEqual(["200", "404", "503"]);
    expect(Object.keys(document.paths["/api/experiments/{experimentId}/runs"]).sort()).toEqual(["post"]);
    expect(Object.keys(document.paths["/api/experiments/{experimentId}/runs"].post.responses).sort()).toEqual(["200", "201", "404", "503"]);
  });

  it("keeps an old client compatible with an additive response field", async () => {
    const baseline = await readJson("docs/contract-fixtures/experiment-v1.json");
    const additive = await readJson("docs/contract-fixtures/experiment-v1-additive.json");

    expect(experimentResponseV1Schema.parse(baseline)).toEqual(baseline);
    expect(experimentResponseV1Schema.parse(additive)).toEqual(baseline);
  });

  it("rejects a response that renames a required field", async () => {
    const breaking = await readJson("docs/contract-fixtures/experiment-v1-breaking.json");

    expect(experimentResponseV1Schema.safeParse(breaking).success).toBe(false);
  });

  it("describes the durable run shape independently from private RPC details", () => {
    const parsed = experimentRunResponseV1Schema.parse({
      id: 8,
      experimentId: 4,
      outcome: "success",
      httpStatus: 200,
      durationMs: 37,
      response: {
        jsonrpc: "2.0",
        id: "8aa1128c-b70c-4d9f-8961-3177090b8517",
        result: { accepted: true },
      },
      createdAt: "2026-08-18T04:00:00.000Z",
    });

    expect(parsed.outcome).toBe("success");
    expect(parsed.response).toMatchObject({ jsonrpc: "2.0" });
  });
});
