import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentMembership } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { ClientForm } from "@/components/clients/client-form";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { updateClientAction } from "./actions";
import { ClientAttachmentsSection } from "./attachments-section";
import { ClientContactsSection } from "./contacts-section";
import { ClientPortalAccessSection } from "./portal-access-section";

export default async function EditClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { organizationId, membership } = await getCurrentMembership();

  const client = await prisma.client.findFirst({
    where: { id, organizationId },
  });

  if (!client) {
    notFound();
  }

  const boundUpdateClientAction = updateClientAction.bind(null, client.id);

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-text-primary text-2xl font-semibold tracking-tight">
          Edit client
        </h1>
        <Link href="/clients" className={ACTION_LINK_CLASSES}>
          Cancel
        </Link>
      </div>
      <div className={`p-6 ${CARD_SURFACE_CLASSES}`}>
        <ClientForm
          action={boundUpdateClientAction}
          defaultValues={client}
          submitLabel="Save changes"
          pendingLabel="Saving…"
        />
        <ClientContactsSection clientId={client.id} organizationId={organizationId} />
        <ClientAttachmentsSection clientId={client.id} organizationId={organizationId} />
        <ClientPortalAccessSection clientId={client.id} role={membership.role} />
      </div>
    </div>
  );
}
