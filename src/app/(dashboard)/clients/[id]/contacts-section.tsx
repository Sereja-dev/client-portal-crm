import { listClientContacts } from "@/lib/clients/contacts";
import { ContactsList, type ContactRow } from "@/components/clients/contacts-list";
import {
  createContactAction,
  updateContactAction,
  archiveContactAction,
  unarchiveContactAction,
  setPrimaryContactAction,
} from "./contact-actions";

/**
 * Multiple Contacts Phase 2 (Staff UI), embedded in the Client edit page —
 * same shape as the sibling ClientPortalAccessSection/
 * ClientAttachmentsSection: data fetched fresh here (no caching layer),
 * every per-row mutation bound to its own contact id right here in the
 * Server Component before ever reaching the Client Component (see
 * ContactRow's own comment in contacts-list.tsx for why that ordering is
 * required, not just a style choice). The caller (EditClientPage) has
 * already verified this Client belongs to the current organization, so
 * this read is scoped by clientId alone — every mutation still
 * re-verifies organizationId independently inside contact-actions.ts,
 * since that's the actual security boundary, not this read.
 */
export async function ClientContactsSection({
  clientId,
  organizationId,
}: {
  clientId: string;
  organizationId: string;
}) {
  const contacts = await listClientContacts(organizationId, clientId, { includeArchived: true });

  const rows: ContactRow[] = contacts.map((contact) => ({
    id: contact.id,
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
    role: contact.role,
    isPrimary: contact.isPrimary,
    isBilling: contact.isBilling,
    archivedAt: contact.archivedAt,
    editAction: updateContactAction.bind(null, contact.id, clientId),
    setPrimaryAction: setPrimaryContactAction.bind(null, clientId, contact.id),
    archiveAction: archiveContactAction.bind(null, contact.id, clientId),
    unarchiveAction: unarchiveContactAction.bind(null, contact.id, clientId),
  }));

  return (
    <section className="border-border-default mt-10 border-t pt-8">
      <h2 className="text-text-primary text-lg font-semibold tracking-tight">Contacts</h2>
      <p className="text-text-secondary mt-1 text-sm">
        People associated with this client — the primary contact&apos;s email stays in
        sync with the Client email above.
      </p>

      <div className="mt-4">
        <ContactsList contacts={rows} createAction={createContactAction.bind(null, clientId)} />
      </div>
    </section>
  );
}
