import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRunner } from "./app.js";

const directory = process.env.RUNNER_DATA_DIR ?? fileURLToPath(new URL("../../data/", import.meta.url));
mkdirSync(directory, { recursive: true });
const target = `127.0.0.1:${process.env.RUNNER_PORT ?? "50051"}`;
const runner = buildRunner({ databasePath: path.join(directory, "runner.sqlite"), slowDelayMs: Number(process.env.RUNNER_SLOW_DELAY_MS ?? 800), log: (line) => console.log(`[runner] ${line}`) });
const port = await runner.bind(target);
console.log(`RelayLab gRPC runner listening on 127.0.0.1:${port}`);
process.send?.({ type: "runner-ready", port });
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  void runner.close().then(() => process.exit(0), () => process.exit(1));
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
