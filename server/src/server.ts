import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildApplication } from "./app.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultDataDirectory = path.resolve(currentDirectory, "../../data");
const dataDirectory = process.env.RELAYLAB_DATA_DIR ?? defaultDataDirectory;
const port = Number(process.env.PORT ?? 3000);
const downstreamUrl =
  process.env.DOWNSTREAM_URL ?? "http://127.0.0.1:3001";
const timeoutMs = Number(process.env.DOWNSTREAM_TIMEOUT_MS ?? 400);
const clientDirectory = process.env.CLIENT_DIST_DIR;

mkdirSync(dataDirectory, { recursive: true });

const application = buildApplication({
  databasePath: path.join(dataDirectory, "relaylab.sqlite"),
  downstreamUrl,
  timeoutMs,
  clientDirectory,
});

const server = application.app.listen(port, () => {
  console.log(`RelayLab coordinator listening on http://localhost:${port}`);
});

function shutdown() {
  server.close(() => {
    application.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
