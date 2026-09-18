import type { SlackErrorCode } from "./slack-client";

/**
 * Integrations V1 (Slack Incoming Webhook only). The full safe,
 * non-identifying error-code vocabulary any Integrations failure is ever
 * recorded/returned as — never a raw Slack response body, never a raw
 * exception message, never anything containing the webhook URL. Extends
 * slack-client.ts's own transport-level codes with the credential-level
 * codes a connection/delivery attempt can also fail with before ever
 * reaching the HTTP layer.
 */
export type IntegrationErrorCode =
  | SlackErrorCode
  | "SLACK_CREDENTIAL_INVALID"
  | "SLACK_CREDENTIAL_DECRYPT_FAILED"
  | "INTEGRATION_MESSAGE_BUILD_FAILED"
  | "INTEGRATION_TENANT_MISMATCH";
