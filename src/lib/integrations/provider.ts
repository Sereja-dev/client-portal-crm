/**
 * Integrations V1 (Slack Incoming Webhook only). Shared string constants
 * for `IntegrationConnection.provider`/`.status` and
 * `IntegrationDelivery.status` — both columns are plain Strings, not
 * Prisma enums (see each model's own schema.prisma doc comment), so
 * these are the single source of truth every module imports from rather
 * than repeating string literals.
 */

export const SLACK_PROVIDER = "SLACK_INCOMING_WEBHOOK" as const;

export const CONNECTION_STATUS = {
  CONNECTED: "CONNECTED",
  DISCONNECTED: "DISCONNECTED",
  ERROR: "ERROR",
} as const;
export type ConnectionStatus = (typeof CONNECTION_STATUS)[keyof typeof CONNECTION_STATUS];

export const DELIVERY_STATUS = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  DELIVERED: "DELIVERED",
  FAILED: "FAILED",
  CANCELED: "CANCELED",
} as const;
export type DeliveryStatus = (typeof DELIVERY_STATUS)[keyof typeof DELIVERY_STATUS];
