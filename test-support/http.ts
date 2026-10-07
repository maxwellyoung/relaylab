import { createServer, type RequestListener } from "node:http";
import { once } from "node:events";

export async function listenHttp(app: RequestListener, closeApplication: () => Promise<void> = async () => {}) {
  const server = createServer(app);
  // Supertest's URL is IPv4. On macOS, a default IPv6 listener can share its
  // port with a different IPv4 server, sending a test to the wrong application.
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  let closing: Promise<void> | undefined;
  return {
    app: server,
    close() {
      return closing ??= new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())).finally(closeApplication);
    },
  };
}
