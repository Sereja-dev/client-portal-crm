import { createServer, type Server, type IncomingMessage } from "node:http";
import { E2E_SLACK_FIXTURE_PORT } from "../../support/e2e-ports";

/**
 * Integrations V1 (Slack Incoming Webhook only, locked spec §37). A
 * genuine local HTTP server standing in for Slack's own Incoming Webhook
 * endpoint — bound to a fixed loopback port
 * (test/support/e2e-ports.ts's own E2E_SLACK_FIXTURE_PORT), started/
 * stopped directly inside a Playwright spec file's own beforeAll/afterAll
 * (this module imports nothing from the app itself — no Prisma, no Next
 * — so, unlike test/e2e/db-server.ts's own ESM-import limitation, it
 * needs no separate tsx subprocess).
 *
 * The app process under test never learns this server's address from
 * anything other than TEST_SLACK_FIXTURE_BASE_URL (playwright.config.ts's
 * own webServer env, read only under TEST_MODE) — the production URL
 * validator (src/lib/integrations/slack-url.ts) still requires
 * hooks.slack.com in every environment; only the outbound transport's own
 * destination is swapped, at the lowest possible layer
 * (src/lib/integrations/slack-client.ts's own resolveSendTarget). This is
 * a genuine advantage of the Slack-Incoming-Webhook-only V1 scope: no
 * OAuth handshake exists to fake, so a plain HTTP POST receiver is a
 * complete, faithful stand-in — no real Slack credentials are used
 * anywhere in this E2E suite.
 */

export type CapturedSlackRequest = { method: string; path: string; contentType: string | undefined; body: string };

let server: Server | null = null;
let captured: CapturedSlackRequest[] = [];
let nextStatus = 200;
let nextBody = "ok";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export async function startSlackFixtureServer(): Promise<void> {
  if (server) return;
  server = createServer((req, res) => {
    readBody(req)
      .then((body) => {
        captured.push({ method: req.method ?? "", path: req.url ?? "", contentType: req.headers["content-type"], body });
        res.writeHead(nextStatus, { "content-type": "text/plain" }).end(nextBody);
      })
      .catch(() => {
        res.writeHead(500).end();
      });
  });
  await new Promise<void>((resolve, reject) => {
    server!.once("error", reject);
    server!.listen(E2E_SLACK_FIXTURE_PORT, "127.0.0.1", () => resolve());
  });
}

export async function stopSlackFixtureServer(): Promise<void> {
  if (!server) return;
  const toClose = server;
  server = null;
  await new Promise<void>((resolve, reject) => toClose.close((err) => (err ? reject(err) : resolve())));
}

export function getCapturedSlackRequests(): readonly CapturedSlackRequest[] {
  return captured;
}

export function clearCapturedSlackRequests(): void {
  captured = [];
}

/** Default is 200 "ok" (a successful Slack delivery) — call this to simulate a failure for one test. */
export function setNextSlackFixtureResponse(status: number, body = "ok"): void {
  nextStatus = status;
  nextBody = body;
}

export function resetSlackFixtureServer(): void {
  clearCapturedSlackRequests();
  setNextSlackFixtureResponse(200, "ok");
}
