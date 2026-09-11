import { relativeTime } from "@/lib/notifications/relative-time";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import type { ClientRequestMessageViewModel } from "@/lib/client-requests/format-message";

/**
 * Client Requests / Tickets Phase 2A — the conversation thread, shared by
 * both the Staff and Portal detail pages. Byte-for-byte simplified
 * mirror of comments/comment-list.tsx + comment-item.tsx's own shape:
 * same surface/divide classes, same author-name + relative-time header.
 * Simpler than Comment on purpose — messages are immutable in this phase
 * (no edit, no delete, no mentions), so there is no per-row client
 * state at all; this can stay a plain Server Component.
 *
 * `authorType` gets its own small badge so Staff vs Portal is visually
 * distinct at a glance (Section: "Conversation renders Staff vs Portal
 * authors distinctly") — never inferred from the name alone, which
 * could be ambiguous or (after an author's identity is later deleted)
 * generic.
 */
export function MessageList({ messages }: { messages: ClientRequestMessageViewModel[] }) {
  if (messages.length === 0) {
    return <p className="text-text-muted text-sm">No messages yet.</p>;
  }

  return (
    <ul className={`divide-border-subtle divide-y ${CARD_SURFACE_CLASSES}`}>
      {messages.map((message) => (
        <li key={message.id} className="px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <div className="flex min-w-0 items-center gap-2">
              <p className="text-text-primary truncate text-sm font-medium">{message.authorName}</p>
              <span
                className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${
                  message.authorType === "STAFF" ? "bg-info-subtle text-info" : "bg-surface-muted text-text-secondary"
                }`}
              >
                {message.authorType === "STAFF" ? "Staff" : "Client"}
              </span>
            </div>
            <time
              dateTime={message.createdAt.toISOString()}
              title={message.createdAt.toLocaleString()}
              className="text-text-muted shrink-0 text-xs"
            >
              {relativeTime(message.createdAt)}
            </time>
          </div>
          <p className="text-text-primary mt-1 text-sm whitespace-pre-wrap">{message.body}</p>
        </li>
      ))}
    </ul>
  );
}
