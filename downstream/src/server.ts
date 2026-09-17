import { buildDownstreamService } from "./app.js";

const port = Number(process.env.DOWNSTREAM_PORT ?? 3001);
const service = buildDownstreamService({
  log: (line) => console.log(`[downstream  ${new Date().toTimeString().slice(0, 8)}] ${line}`),
});

const server = service.listen(port, () => {
  console.log(`RelayLab downstream listening on http://localhost:${port}`);
});

function shutdown() {
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
