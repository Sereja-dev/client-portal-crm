import type { ActivityEntityType } from "@/generated/prisma/enums";
import type { IntegrationEventKey } from "./events";

/**
 * Integrations V1 (Slack Incoming Webhook only -- architecture lock
 * validation, locked spec §27). Plain-text messages only, no Block Kit —
 * a small, dedicated formatter per event key, deliberately not a reuse
 * of src/lib/activity/format-activity.ts's own buildModel(): that
 * module's actionLabel/entityLabel strings are phrased for the in-app
 * Activity feed's own reading context ("created a lead"), while a Slack
 * message needs a self-contained, single-line announcement ("[Aqenra]
 * New lead: Jane Doe") — a small dedicated builder keeps that phrasing
 * independently testable and free to diverge, without coupling this
 * feature's wording to format-activity.ts's own evolving copy. It reads
 * the exact same safe metadata fields format-activity.ts already treats
 * as safe for those entities (name/invoiceNumber/title), never the full
 * metadata blob.
 *
 * Every user-controlled string (a Lead/Client name, an Invoice number, a
 * Contract title) is escaped for Slack's `mrkdwn` special characters and
 * truncated before inclusion — this is what stops a maliciously-named
 * record from injecting `<!channel>`/`<!here>`/a disguised link/mention
 * into the outgoing message.
 */

const MAX_FIELD_LENGTH = 200;

/** Slack mrkdwn requires exactly these three characters escaped, in this order (& first, so escaping < and > doesn't get re-escaped). */
export function escapeSlackMrkdwn(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Strips control/newline characters (a message is always one line) and
 * hard-caps length, applied BEFORE escaping so the cap counts real
 * characters, not escape-sequence bytes. Ordinary spaces and hyphens are
 * left untouched — only C0 control characters (including \r, \n, \t) and
 * DEL are treated as whitespace to collapse.
 */
function sanitizeField(value: string): string {
  const withoutControlChars = value.replace(/[\x00-\x1F\x7F]+/g, " ");
  const collapsed = withoutControlChars.replace(/\s+/g, " ").trim();
  const truncated = collapsed.length > MAX_FIELD_LENGTH ? `${collapsed.slice(0, MAX_FIELD_LENGTH - 1)}…` : collapsed;
  return escapeSlackMrkdwn(truncated);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

const DEEP_LINK_PATH: Record<ActivityEntityType, (entityId: string) => string> = {
  LEAD: (id) => `/leads/${id}/edit`,
  CLIENT: (id) => `/clients/${id}/edit`,
  INVOICE: (id) => `/invoices/${id}/edit`,
  CONTRACT: (id) => `/contracts/${id}`,
} as Record<ActivityEntityType, (entityId: string) => string>;

/** Same reasoning as deliver-notification-email.ts's/retry-notification-deliveries.ts's own copies — never derived from a request header, kept as its own copy per this app's established convention. */
export function getAppBaseUrl(): string {
  const explicit = process.env.APP_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");

  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) return `https://${vercelUrl}`.replace(/\/+$/, "");

  return "http://localhost:3000";
}

export type BuildSlackMessageParams = {
  eventKey: IntegrationEventKey;
  entityType: ActivityEntityType;
  entityId: string;
  metadata: unknown;
};

/** Returns null if the Activity's metadata is missing the field this event key requires — callers treat that as "cannot build a safe message" and fail the delivery permanently rather than sending a broken/empty message. */
export function buildSlackMessage(params: BuildSlackMessageParams): string | null {
  const metadata = isRecord(params.metadata) ? params.metadata : {};
  const linkPath = DEEP_LINK_PATH[params.entityType]?.(params.entityId) ?? `/`;
  const deepLink = `${getAppBaseUrl()}${linkPath}`;

  switch (params.eventKey) {
    case "LEAD_CREATED": {
      const name = str(metadata.name);
      if (!name) return null;
      return `[Aqenra] New lead: ${sanitizeField(name)}\nOpen in Aqenra: ${deepLink}`;
    }
    case "CLIENT_CREATED": {
      const name = str(metadata.name);
      if (!name) return null;
      return `[Aqenra] New client: ${sanitizeField(name)}\nOpen in Aqenra: ${deepLink}`;
    }
    case "INVOICE_SENT": {
      const invoiceNumber = str(metadata.invoiceNumber);
      if (!invoiceNumber) return null;
      return `[Aqenra] Invoice sent: ${sanitizeField(invoiceNumber)}\nOpen in Aqenra: ${deepLink}`;
    }
    case "CONTRACT_ACCEPTED": {
      const name = str(metadata.name);
      if (!name) return null;
      return `[Aqenra] Contract signed: ${sanitizeField(name)}\nOpen in Aqenra: ${deepLink}`;
    }
  }
}
