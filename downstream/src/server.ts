import { buildDownstreamService } from "./app.js";

const port = Number(process.env.DOWNSTREAM_PORT ?? 3001);
const service = buildDownstreamService();

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
