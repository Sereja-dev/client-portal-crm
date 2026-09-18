// Controllable fake for @/lib/integrations/slack-client (which imports
// "server-only" and would otherwise throw outside Next's own build, and
// whose real implementation makes a live outbound HTTP call — see
// test/integration/setup-mocks.ts for the vi.mock() that swaps it in, the
// same "the ONLY things mocked... needs a live external network call"
// convention storage-mock.ts/logo-storage-mock.ts already establish).
// This never reaches a real Slack endpoint; it only lets Integrations
// tests exercise the REAL connection.ts/deliver.ts/retry-integration-
// deliveries.ts Prisma+Activity logic, including error-path handling.

import type { SlackSendOutcome, SlackErrorCode } from "@/lib/integrations/slack-client";

export type CapturedSlackSend = { url: string; text: string };

let outcome: SlackSendOutcome = { outcome: "success" };
export const capturedSends: CapturedSlackSend[] = [];

export function setSlackSendOutcome(next: SlackSendOutcome): void {
  outcome = next;
}

export function setSlackSendSuccess(): void {
  outcome = { outcome: "success" };
}

export function setSlackSendRetryable(code: SlackErrorCode = "SLACK_SERVER_ERROR"): void {
  outcome = { outcome: "retryable", code };
}

export function setSlackSendPermanent(code: SlackErrorCode = "SLACK_CLIENT_ERROR"): void {
  outcome = { outcome: "permanent", code };
}

export function resetSlackMock(): void {
  outcome = { outcome: "success" };
  capturedSends.length = 0;
}

export async function mockSendSlackMessage(url: string, text: string): Promise<SlackSendOutcome> {
  capturedSends.push({ url, text });
  return outcome;
}
