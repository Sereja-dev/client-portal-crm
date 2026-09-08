"use client";

import { useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableHead,
  TableHeaderCell,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { AddContactButton } from "./add-contact-button";
import {
  PrimaryBadge,
  BillingBadge,
  EditContactButton,
  SetPrimaryButton,
  ArchiveContactButton,
  UnarchiveContactButton,
} from "./contact-row-actions";
import type { ClientContactFormState } from "@/types";

export type ContactRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  isPrimary: boolean;
  isBilling: boolean;
  archivedAt: Date | null;
  // Bound Server Actions, one per contact — computed in the parent Server
  // Component (contacts-section.tsx), the same "bind server-side, pass the
  // already-bound action down as a prop" shape ClientPortalAccessSection's
  // own portalUsers.map(...) already establishes. A plain closure that
  // merely *returns* a bound action is not itself a Server Action
  // reference and cannot cross the Server/Client boundary — every action
  // here must already be the final, bound reference by the time it
  // reaches this Client Component.
  editAction: (
    prevState: ClientContactFormState,
    formData: FormData,
  ) => Promise<ClientContactFormState>;
  setPrimaryAction: () => Promise<void>;
  archiveAction: () => Promise<void>;
  unarchiveAction: () => Promise<void>;
};

/**
 * Multiple Contacts Phase 2 (Staff UI). Client Component only for the
 * "show archived" toggle's own local state — both active and archived
 * contacts are fetched once, server-side, by the parent Section (a single
 * cheap query; per-Client contact counts are small), and simply filtered
 * here rather than round-tripping the server again for what's ultimately
 * a client-only view toggle. Kept self-contained to this one Client edit
 * page section rather than a URL searchParam (Quotes/Leads' own list-page
 * convention) — this toggle affects one section on a page with several
 * others, not a whole page's own primary view.
 */
export function ContactsList({
  contacts,
  createAction,
}: {
  contacts: ContactRow[];
  createAction: (
    prevState: ClientContactFormState,
    formData: FormData,
  ) => Promise<ClientContactFormState>;
}) {
  const [showArchived, setShowArchived] = useState(false);

  const activeContacts = contacts.filter((c) => c.archivedAt === null);
  const archivedContacts = contacts.filter((c) => c.archivedAt !== null);
  const visibleContacts = showArchived ? archivedContacts : activeContacts;

  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {(archivedContacts.length > 0 || showArchived) && (
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              className="text-text-secondary hover:text-text-primary focus-visible:ring-focus-ring rounded text-sm font-medium transition-colors hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            >
              {showArchived ? "Show active" : `Show archived (${archivedContacts.length})`}
            </button>
          )}
        </div>
        {activeContacts.length > 0 && !showArchived && (
          <AddContactButton action={createAction} />
        )}
      </div>

      {visibleContacts.length === 0 ? (
        showArchived ? (
          <EmptyState title="No archived contacts" description="Archived contacts will appear here." />
        ) : (
          <EmptyState
            title="No contacts yet"
            description="Add a contact to keep track of who you work with at this client."
            action={<AddContactButton action={createAction} variant="primary" />}
          />
        )
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>Contact</TableHeaderCell>
              <TableHeaderCell>Email</TableHeaderCell>
              {/* Contacts UI Polish — priority order (name+badges, email,
                  actions always visible; phone medium, role lowest):
                  Role hides first, below lg (1024px, "tablet" width in
                  this task's own 834px check), well before Phone does. */}
              <TableHeaderCell className="hidden sm:table-cell">Phone</TableHeaderCell>
              <TableHeaderCell className="hidden lg:table-cell">Role</TableHeaderCell>
              <TableHeaderCell align="right">Actions</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {visibleContacts.map((contact) => (
              <TableRow key={contact.id}>
                <TableCell emphasis>
                  <div className="flex flex-wrap items-center gap-2">
                    <span>{contact.name}</span>
                    {contact.isPrimary && contact.archivedAt === null && <PrimaryBadge />}
                    {contact.isBilling && <BillingBadge />}
                  </div>
                </TableCell>
                <TableCell className="break-words">{contact.email ?? "—"}</TableCell>
                <TableCell className="hidden sm:table-cell">{contact.phone ?? "—"}</TableCell>
                <TableCell className="hidden lg:table-cell">{contact.role ?? "—"}</TableCell>
                <TableCell align="right">
                  {/* flex-wrap (Contacts UI Polish) — up to three actions
                      (Edit/Set primary/Archive) never get horizontally
                      squeezed or clipped at a narrow width; they wrap
                      onto their own line as whole buttons instead (each
                      button's own label is whitespace-nowrap, so a label
                      itself never breaks word-by-word). */}
                  <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
                    {contact.archivedAt === null ? (
                      <>
                        <EditContactButton
                          action={contact.editAction}
                          defaultValues={{
                            name: contact.name,
                            email: contact.email,
                            phone: contact.phone,
                            role: contact.role,
                            isBilling: contact.isBilling,
                          }}
                          isPrimaryContact={contact.isPrimary}
                        />
                        {!contact.isPrimary && (
                          <SetPrimaryButton
                            action={contact.setPrimaryAction}
                            contactName={contact.name}
                          />
                        )}
                        <ArchiveContactButton
                          action={contact.archiveAction}
                          contactName={contact.name}
                          isPrimaryContact={contact.isPrimary}
                        />
                      </>
                    ) : (
                      <UnarchiveContactButton
                        action={contact.unarchiveAction}
                        contactName={contact.name}
                      />
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
