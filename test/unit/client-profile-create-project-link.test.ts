import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// First-Time User Experience V2, Slice A. After "Add client" the user lands
// on the Client Profile, whose primary action must stay "Create project"
// linking to the Project form with the client preselected. No DOM harness
// exists in this repo, so this is a source-contract proxy over the real
// files (same convention as the other *-contract tests); the behavior is
// proven end to end in test/e2e/first-value-moment.spec.ts.

const header = readFileSync("src/app/(dashboard)/clients/[id]/profile-header.tsx", "utf8");
const projectPage = readFileSync("src/app/(dashboard)/projects/new/page.tsx", "utf8");
const createAction = readFileSync("src/app/(dashboard)/clients/new/actions.ts", "utf8");

describe("Client Profile → Project form hand-off", () => {
  it("the Profile's primary action is 'Create project' linking to /projects/new?clientId=<client id>", () => {
    expect(header).toMatch(
      /<Link href=\{`\/projects\/new\?clientId=\$\{client\.id\}`\} className=\{PRIMARY_LINK_CLASSES\}>\s*Create project\s*<\/Link>/,
    );
  });

  it("the Project form resolves ?clientId through the organization-scoped prefill resolver and preselects it", () => {
    expect(projectPage).toContain("resolveClientPrefill(organizationId, parseSearchParam(resolvedSearchParams.clientId))");
    expect(projectPage).toContain("defaultValues={prefillClient ? { clientId: prefillClient.id } : undefined}");
  });

  it("the create action redirects to the new Client Profile with the unchanged toast, not the list", () => {
    expect(createAction).toContain("`/clients/${createdClientId}`");
    expect(createAction).toContain('"Client created"');
    expect(createAction).not.toMatch(/redirect\(withToast\("\/clients", "Client created"\)\)/);
  });
});
