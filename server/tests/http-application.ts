import { buildApplication } from "../src/app.js";
import { listenHttp } from "../../test-support/http.js";

export async function buildHttpApplication(options: Parameters<typeof buildApplication>[0]) {
  const application = buildApplication(options);
  return listenHttp(application.app, application.close);
}
