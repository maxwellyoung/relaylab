import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildApplication } from "./app.js";
import { openDatabaseFromEnvironment } from "./database.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultDataDirectory = path.resolve(currentDirectory, "../../data");
const dataDirectory = process.env.RELAYLAB_DATA_DIR ?? defaultDataDirectory;
const port = Number(process.env.PORT ?? 3000);
const downstreamUrl =
  process.env.DOWNSTREAM_URL ?? "http://127.0.0.1:3001";
const timeoutMs = Number(process.env.DOWNSTREAM_TIMEOUT_MS ?? 400);
const builtClientDirectory = path.resolve(currentDirectory, "../../client/dist");
const clientDirectory = process.env.CLIENT_DIST_DIR
  ?? (existsSync(builtClientDirectory) ? builtClientDirectory : undefined);

mkdirSync(dataDirectory, { recursive: true });

const database = openDatabaseFromEnvironment({
  sqlitePath: path.join(dataDirectory, "relaylab.sqlite"),
});

const application = buildApplication({
  databasePath: path.join(dataDirectory, "relaylab.sqlite"),
  database,
  downstreamUrl,
  timeoutMs,
  databaseDriver: process.env.RELAYLAB_DATABASE_DRIVER?.trim().toLowerCase() ?? "sqlite",
  clientDirectory,
  log: (line) => console.log(`[coordinator ${new Date().toTimeString().slice(0, 8)}] ${line}`),
});

const server = application.app.listen(port, () => {
  console.log(`RelayLab coordinator listening on http://localhost:${port}`);
});

function shutdown() {
  server.close(() => {
    void application.close().finally(() => process.exit(0));
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
