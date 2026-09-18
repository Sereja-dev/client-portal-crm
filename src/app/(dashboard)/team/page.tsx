import Link from "next/link";
import { getCurrentMembership } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/enums";
import { StatusBadge } from "@/components/ui/status-badge";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableHead,
  TableHeaderCell,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  RecordCardList,
  RecordCard,
  RecordCardField,
  RecordCardActions,
} from "@/components/ui/record-list";
import { CopyLinkButton } from "@/components/team/copy-link-button";
import { InviteForm } from "@/components/team/invite-form";
import { ResendInvitationForm } from "@/components/team/resend-invitation-form";
import { CancelInvitationButton } from "@/components/team/cancel-invitation-button";
import { RoleSelect } from "@/components/team/role-select";
import { TransferOwnershipButton } from "@/components/team/transfer-ownership-button";
import { RemoveMemberButton } from "@/components/team/remove-member-button";
import { LeaveOrganizationButton } from "@/components/team/leave-organization-button";
import {
  inviteMemberAction,
  resendInvitationAction,
  cancelInvitationAction,
  changeRoleAction,
  removeMemberAction,
  leaveOrganizationAction,
} from "./actions";

export default async function TeamPage() {
  const { user, organizationId, membership } = await getCurrentMembership();

  const [memberships, invitations] = await Promise.all([
    prisma.membership.findMany({
      where: { organizationId },
      // Role's declaration order in the schema (OWNER, ADMIN, MEMBER) is
      // also its Postgres enum ordinal order, so sorting ascending on the
      // enum column alone already yields OWNER -> ADMIN -> MEMBER.
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      include: { user: { select: { name: true, email: true } } },
    }),
    prisma.invitation.findMany({
      where: { organizationId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      include: { invitedBy: { select: { name: true, email: true } } },
    }),
  ]);

  const canManage = membership.role === Role.OWNER || membership.role === Role.ADMIN;
  const isOwner = membership.role === Role.OWNER;

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-text-primary text-2xl font-semibold tracking-tight">
            Team
          </h1>
          <p className="text-text-secondary mt-1 text-sm">
            Manage who has access to your organization.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Roles / Permissions V1 — small Team-page link affordance
              rather than a new secondary-nav framework (locked spec
              §10). OWNER-only, matching /team/permissions' own
              independent, real access check — this link's visibility is
              discoverability only, never the security boundary. */}
          {isOwner && (
            <Link
              href="/team/permissions"
              className="border-border-strong text-text-primary focus-visible:ring-focus-ring inline-flex items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            >
              Roles &amp; permissions
            </Link>
          )}
          <LeaveOrganizationButton
            action={leaveOrganizationAction}
            disabled={isOwner}
            disabledReason={
              isOwner
                ? "You're the only owner — transfer ownership to someone else first."
                : undefined
            }
          />
        </div>
      </div>

      <section>
        <h2 className="text-text-primary text-lg font-semibold tracking-tight">
          Members
        </h2>
        <div className="hidden xl:block">
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Email</TableHeaderCell>
                <TableHeaderCell>Role</TableHeaderCell>
                <TableHeaderCell>Joined</TableHeaderCell>
                {isOwner && <TableHeaderCell align="right">Actions</TableHeaderCell>}
              </tr>
            </TableHead>
            <TableBody>
              {memberships.map((m) => {
                const isSelf = m.userId === user.id;
                return (
                  <TableRow key={m.id}>
                    <TableCell emphasis>
                      {m.user.name}
                      {isSelf && (
                        <span className="text-text-muted ml-2 text-xs font-normal">
                          (You)
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{m.user.email}</TableCell>
                    <TableCell>
                      {isOwner && !isSelf ? (
                        <RoleSelect
                          membershipId={m.id}
                          currentRole={m.role as "ADMIN" | "MEMBER"}
                          action={changeRoleAction}
                        />
                      ) : (
                        <StatusBadge status={m.role} />
                      )}
                    </TableCell>
                    <TableCell>{m.createdAt.toLocaleDateString()}</TableCell>
                    {isOwner && (
                      <TableCell align="right">
                        {!isSelf && (
                          <div className="flex items-center justify-end gap-4">
                            <TransferOwnershipButton
                              memberName={m.user.name}
                              onConfirm={changeRoleAction.bind(null, m.id, Role.OWNER)}
                            />
                            <RemoveMemberButton
                              action={removeMemberAction.bind(null, m.id)}
                              memberName={m.user.name}
                            />
                          </div>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <RecordCardList>
          {memberships.map((m) => {
            const isSelf = m.userId === user.id;
            return (
              <RecordCard key={m.id}>
                <RecordCardField
                  label="Name"
                  emphasis
                  value={
                    <>
                      {m.user.name}
                      {isSelf && (
                        <span className="text-text-muted ml-2 text-xs font-normal">(You)</span>
                      )}
                    </>
                  }
                />
                <RecordCardField label="Email" value={m.user.email} />
                <RecordCardField
                  label="Role"
                  value={
                    isOwner && !isSelf ? (
                      <RoleSelect
                        membershipId={m.id}
                        currentRole={m.role as "ADMIN" | "MEMBER"}
                        action={changeRoleAction}
                      />
                    ) : (
                      <StatusBadge status={m.role} />
                    )
                  }
                />
                <RecordCardField label="Joined" value={m.createdAt.toLocaleDateString()} />
                {isOwner && !isSelf && (
                  <RecordCardActions>
                    <TransferOwnershipButton
                      memberName={m.user.name}
                      onConfirm={changeRoleAction.bind(null, m.id, Role.OWNER)}
                    />
                    <RemoveMemberButton
                      action={removeMemberAction.bind(null, m.id)}
                      memberName={m.user.name}
                    />
                  </RecordCardActions>
                )}
              </RecordCard>
            );
          })}
        </RecordCardList>
      </section>

      <section>
        <h2 className="text-text-primary text-lg font-semibold tracking-tight">
          Pending invitations
        </h2>
        {invitations.length === 0 ? (
          <EmptyState
            title="No pending invitations"
            description="Invite someone below to add them to your organization."
          />
        ) : (
          <>
            <div className="hidden xl:block">
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Email</TableHeaderCell>
                    <TableHeaderCell>Role</TableHeaderCell>
                    <TableHeaderCell>Invited by</TableHeaderCell>
                    <TableHeaderCell>Expires</TableHeaderCell>
                    <TableHeaderCell align="right">
                      {canManage ? "Actions" : "Link"}
                    </TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {invitations.map((invitation) => (
                    <TableRow key={invitation.id}>
                      <TableCell emphasis>{invitation.email}</TableCell>
                      <TableCell>
                        <StatusBadge status={invitation.role} />
                      </TableCell>
                      <TableCell>
                        {invitation.invitedBy?.name ??
                          invitation.invitedBy?.email ??
                          "—"}
                      </TableCell>
                      <TableCell>{invitation.expiresAt.toLocaleDateString()}</TableCell>
                      <TableCell align="right">
                        {canManage ? (
                          <div className="flex items-center justify-end gap-4">
                            <ResendInvitationForm
                              action={resendInvitationAction.bind(null, invitation.id)}
                              initialToken={invitation.token}
                            />
                            <CancelInvitationButton
                              action={cancelInvitationAction.bind(null, invitation.id)}
                              email={invitation.email}
                            />
                          </div>
                        ) : (
                          <CopyLinkButton token={invitation.token} />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <RecordCardList>
              {invitations.map((invitation) => (
                <RecordCard key={invitation.id}>
                  <RecordCardField label="Email" value={invitation.email} emphasis />
                  <RecordCardField label="Role" value={<StatusBadge status={invitation.role} />} />
                  <RecordCardField
                    label="Invited by"
                    value={invitation.invitedBy?.name ?? invitation.invitedBy?.email ?? "—"}
                  />
                  <RecordCardField label="Expires" value={invitation.expiresAt.toLocaleDateString()} />
                  <RecordCardActions>
                    {canManage ? (
                      <>
                        <ResendInvitationForm
                          action={resendInvitationAction.bind(null, invitation.id)}
                          initialToken={invitation.token}
                        />
                        <CancelInvitationButton
                          action={cancelInvitationAction.bind(null, invitation.id)}
                          email={invitation.email}
                        />
                      </>
                    ) : (
                      <CopyLinkButton token={invitation.token} />
                    )}
                  </RecordCardActions>
                </RecordCard>
              ))}
            </RecordCardList>
          </>
        )}
      </section>

      {canManage && (
        <section>
          <h2 className="text-text-primary text-lg font-semibold tracking-tight">
            Invite a member
          </h2>
          <div className={`mt-4 max-w-md p-6 ${CARD_SURFACE_CLASSES}`}>
            <InviteForm action={inviteMemberAction} />
          </div>
        </section>
      )}
    </div>
  );
}
