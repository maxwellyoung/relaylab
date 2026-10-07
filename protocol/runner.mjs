import { loadPackageDefinition } from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";
import { fileURLToPath } from "node:url";

const definition = loadSync(fileURLToPath(new URL("./runner.proto", import.meta.url)), {
  keepCase: false, longs: String, enums: String, defaults: true, oneofs: true,
});
export const RunnerClient = loadPackageDefinition(definition).relaylab.runner.v1.Runner;
export const runnerDefinition = RunnerClient.service;
