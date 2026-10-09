import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Product UI/UX PR 3 — proves all five staff list-page surfaces (six
 * tables — Team has two) adopt the shared mobile stacked-card pattern
 * (`RecordCardList`/`RecordCard`/`RecordCardField`/`RecordCardActions`
 * from `src/components/ui/record-list.tsx`) alongside their existing,
 * unmodified `<Table>`, with full field parity (every real data column
 * has a matching mobile field — nothing silently dropped) and every row
 * action preserved.
 *
 * Source-contract only, same repo-wide precedent as
 * file-input-contract.test.ts's own header comment explains (no DOM/
 * component-interaction harness in this repo) — never imports/renders
 * any page; `record-list.test.tsx` covers real rendering of the shared
 * primitives themselves.
 */

const PATHS = {
  clients: "src/app/(dashboard)/clients/page.tsx",
  // Tables Improvement Slice E3B — Column Customization moved the
  // desktop `<Table>` wrapper markup (previously inline in
  // clients/page.tsx) into this dedicated Client Component, which
  // picks which already-server-built header/cell slots to render based
  // on live column-visibility state. clients/page.tsx itself still owns
  // data fetching, auth, and building those slots — see
  // `tableIsWrappedHiddenOnMobile` below, now scoped to this file
  // instead for the Clients describe block specifically. Unlike
  // Invoices, Clients kept the shared `<Table>` component as-is (no
  // local sticky-header wrapper), so the existing generic check applies
  // unchanged, just against a different file.
  clientsDesktopTable: "src/components/clients/client-desktop-table.tsx",
  projects: "src/app/(dashboard)/projects/page.tsx",
  // Work Hub V1 — the Table/RecordCardList rendering moved out of the
  // page itself into its own component (row selection + bulk actions
  // needed client-component state the page, a Server Component, can't
  // hold) — this source contract now reads that component file instead.
  tasks: "src/components/tasks/task-list-with-selection.tsx",
  invoices: "src/app/(dashboard)/invoices/page.tsx",
  // Tables Improvement Slice E1 — Column Customization moved the
  // desktop `<table>`/sticky-header wrapper markup (previously inline
  // in invoices/page.tsx) into this dedicated Client Component, which
  // picks which already-server-built header/cell slots to render based
  // on live column-visibility state. invoices/page.tsx itself still
  // owns data fetching, auth, and building those slots — see
  // `invoiceTableIsWrappedHiddenOnMobile` below, now scoped to this
  // file instead.
  invoicesDesktopTable: "src/components/invoices/invoice-desktop-table.tsx",
  team: "src/app/(dashboard)/team/page.tsx",
};

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

/**
 * Counts real data-column headers — every <TableHeaderCell> OR
 * <SortableHeader> (Tables Improvement Slice A's own clickable-header
 * primitive, src/components/ui/sortable-header.tsx — delegates its own
 * `<th>` rendering to TableHeaderCell internally, so a sortable column
 * is exactly as real a data column as a plain one; counted here too so
 * Invoices' own three sortable columns aren't silently undercounted)
 * except the trailing "Actions"/"Link" one.
 */
function countDataHeaders(source: string, region?: [number, number]): number {
  const scoped = region ? source.slice(region[0], region[1]) : source;
  const all =
    [...scoped.matchAll(/<TableHeaderCell/g)].length + [...scoped.matchAll(/<SortableHeader/g)].length;
  // Exactly one trailing action header per table in this codebase's own
  // established convention (align="right", labelled "Actions" or, on
  // Team's invitations table, the conditional "Actions"/"Link" text).
  // The trailing Actions header is always a plain TableHeaderCell, never
  // a SortableHeader, so subtracting exactly one here remains correct.
  return all - 1;
}

function countCardFields(source: string, region: [number, number]): number {
  const scoped = source.slice(region[0], region[1]);
  return [...scoped.matchAll(/<RecordCardField\b/g)].length;
}

function importsSharedPrimitives(source: string): boolean {
  return /import\s*\{[^}]*RecordCardList[^}]*\}\s*from\s*["']@\/components\/ui\/record-list["']/.test(source) ||
    /import\s*\{[^}]*RecordCard\b[^}]*\}\s*from\s*["']@\/components\/ui\/record-list["']/.test(source);
}

/**
 * Tables Improvement Slice A — Invoices' own sticky-header pilot
 * replaced the shared `<Table>` component with a local, bounded-height
 * (`max-h-[70vh]`) inner-scroll wrapper — the shared `<Table>` component
 * itself, and every other page still using it, are completely untouched
 * (see tableIsWrappedHiddenOnMobile below, still used by Clients/
 * Projects/Tasks/Team). This is the Invoices-specific equivalent check:
 * same "hidden below xl, visible at xl and up" outer gate, just a
 * different (still local, still proven) inner implementation.
 *
 * Tables Improvement Slice E1 — this wrapper markup now lives in
 * `invoice-desktop-table.tsx` (see `PATHS.invoicesDesktopTable`'s own
 * comment above for why), copied verbatim from invoices/page.tsx during
 * that slice — this check moved with it, unchanged in what it actually
 * verifies.
 */
function invoiceTableIsWrappedHiddenOnMobile(source: string): boolean {
  // No fixed character window (the sticky-header wrapper's own doc
  // comment between the two is long) — just confirm all three signals
  // exist, in the expected order: the xl:block gate wraps the bounded-
  // height scroll wrapper, which wraps the real <table>.
  const hiddenIndex = source.indexOf('className="hidden xl:block"');
  const maxHeightIndex = source.indexOf("max-h-[70vh]");
  const tableIndex = source.indexOf("<table ");
  return (
    hiddenIndex !== -1 &&
    maxHeightIndex !== -1 &&
    tableIndex !== -1 &&
    hiddenIndex < maxHeightIndex &&
    maxHeightIndex < tableIndex
  );
}

function tableIsWrappedHiddenOnMobile(source: string): boolean {
  // Correction PR (production breakpoint-gap defect) — the safe cutover
  // is `xl` (1280px), not `md` (768px); see
  // test/e2e/responsive-list-tables-breakpoint.spec.ts's own header
  // comment for the real measured widths behind this change. The
  // existing <Table> block must sit inside a wrapper that is hidden
  // below xl and a block (or table) at xl and up — never removed
  // outright, and never left at the old, too-early md cutover.
  const tableIndex = source.indexOf("<Table>");
  if (tableIndex === -1) return false;
  const preceding = source.slice(Math.max(0, tableIndex - 200), tableIndex);
  return /className="[^"]*\bhidden\b[^"]*\bxl:(block|table)\b[^"]*"/.test(preceding);
}

describe("Clients list page — responsive stacked-card adoption", () => {
  const source = read(PATHS.clients);

  it("imports the shared RecordCardList/RecordCard/RecordCardField primitives", () => {
    expect(importsSharedPrimitives(source)).toBe(true);
  });

  it("wraps the existing, unmodified desktop <Table> (now inside Slice E3B's own ClientDesktopTable, which the page itself renders) so it is hidden below md and visible at md and up", () => {
    expect(tableIsWrappedHiddenOnMobile(read(PATHS.clientsDesktopTable))).toBe(true);
    // The page still actually renders that component, not just leaves
    // it unused — confirms the two files are genuinely connected.
    expect(source).toMatch(/<ClientDesktopTable\b/);
  });

  it("renders a RecordCardList mapping the same `clients` collection", () => {
    expect(source).toMatch(/<RecordCardList>[\s\S]*?\{clients\.map/);
  });

  it("every real data column (Name, Company, Email, Phone, Status, Tags, Created) has a matching RecordCardField — no field silently dropped", () => {
    const listStart = source.indexOf("<RecordCardList>");
    const listEnd = source.indexOf("</RecordCardList>");
    expect(listStart).toBeGreaterThan(-1);
    expect(listEnd).toBeGreaterThan(listStart);
    const dataHeaders = countDataHeaders(source);
    const cardFields = countCardFields(source, [listStart, listEnd]);
    // Tags V2 added a Tags column after this contract was first written
    // (7 data columns today, not the original 6) — see this describe
    // block's own field-parity intent above: the count itself must track
    // the real table, not be pinned to whatever it was on day one.
    expect(dataHeaders).toBe(7);
    expect(cardFields).toBe(dataHeaders);
  });

  it("preserves the Edit link and DeleteButton inside the card (same bound action, same itemName)", () => {
    const listStart = source.indexOf("<RecordCardList>");
    const listEnd = source.indexOf("</RecordCardList>");
    const region = source.slice(listStart, listEnd);
    expect(region).toMatch(/href=\{`\/clients\/\$\{client\.id\}\/edit`\}/);
    expect(region).toMatch(/deleteClientAction\.bind\(null, client\.id\)/);
  });
});

describe("Projects list page — responsive stacked-card adoption", () => {
  const source = read(PATHS.projects);

  it("imports the shared RecordCardList/RecordCard/RecordCardField primitives", () => {
    expect(importsSharedPrimitives(source)).toBe(true);
  });

  it("wraps the existing, unmodified desktop <Table> so it is hidden below md and visible at md and up", () => {
    expect(tableIsWrappedHiddenOnMobile(source)).toBe(true);
  });

  it("renders a RecordCardList mapping the same `projects` collection", () => {
    expect(source).toMatch(/<RecordCardList>[\s\S]*?\{projects\.map/);
  });

  it("every real data column (Name, Client, Status, Start date, End date, Created) has a matching RecordCardField", () => {
    const listStart = source.indexOf("<RecordCardList>");
    const listEnd = source.indexOf("</RecordCardList>");
    expect(listStart).toBeGreaterThan(-1);
    const dataHeaders = countDataHeaders(source);
    const cardFields = countCardFields(source, [listStart, listEnd]);
    expect(dataHeaders).toBe(6);
    expect(cardFields).toBe(dataHeaders);
  });

  it("preserves the Edit link and DeleteButton inside the card", () => {
    const listStart = source.indexOf("<RecordCardList>");
    const listEnd = source.indexOf("</RecordCardList>");
    const region = source.slice(listStart, listEnd);
    expect(region).toMatch(/href=\{`\/projects\/\$\{project\.id\}\/edit`\}/);
    expect(region).toMatch(/deleteProjectAction\.bind\(null, project\.id\)/);
  });
});

describe("Tasks list page — responsive stacked-card adoption", () => {
  const source = read(PATHS.tasks);

  it("imports the shared RecordCardList/RecordCard/RecordCardField primitives", () => {
    expect(importsSharedPrimitives(source)).toBe(true);
  });

  it("wraps the existing, unmodified desktop <Table> so it is hidden below md and visible at md and up", () => {
    expect(tableIsWrappedHiddenOnMobile(source)).toBe(true);
  });

  it("renders a RecordCardList mapping the same `tasks` collection", () => {
    expect(source).toMatch(/<RecordCardList>[\s\S]*?\{tasks\.map/);
  });

  it("every real data column (Title, Project, Client, Assignee, Status, Priority, Due date, Completed, Created) has a matching RecordCardField", () => {
    // Work Hub V1 — Assignee is a new real data column; the selection
    // checkbox (desktop <th> and mobile <label>) is deliberately NOT a
    // TableHeaderCell/RecordCardField (it's a control, not a data field),
    // so it doesn't perturb this count either way.
    const listStart = source.indexOf("<RecordCardList>");
    const listEnd = source.indexOf("</RecordCardList>");
    expect(listStart).toBeGreaterThan(-1);
    const dataHeaders = countDataHeaders(source);
    const cardFields = countCardFields(source, [listStart, listEnd]);
    expect(dataHeaders).toBe(9);
    expect(cardFields).toBe(dataHeaders);
  });

  it("preserves the Edit link and DeleteButton inside the card", () => {
    const listStart = source.indexOf("<RecordCardList>");
    const listEnd = source.indexOf("</RecordCardList>");
    const region = source.slice(listStart, listEnd);
    expect(region).toMatch(/href=\{`\/tasks\/\$\{task\.id\}\/edit`\}/);
    expect(region).toMatch(/deleteTaskAction\.bind\(null, task\.id\)/);
  });
});

describe("Invoices list page — responsive stacked-card adoption", () => {
  const source = read(PATHS.invoices);

  it("imports the shared RecordCardList/RecordCard/RecordCardField primitives", () => {
    expect(importsSharedPrimitives(source)).toBe(true);
  });

  it("wraps the desktop table (now a local sticky-header wrapper, not the shared <Table>) so it is hidden below xl and visible at xl and up -- Slice E1's own InvoiceDesktopTable, which the page itself renders", () => {
    expect(invoiceTableIsWrappedHiddenOnMobile(read(PATHS.invoicesDesktopTable))).toBe(true);
    // The page still actually renders that component, not just leaves
    // it unused — confirms the two files are genuinely connected.
    expect(source).toMatch(/<InvoiceDesktopTable\b/);
  });

  it("renders a RecordCardList mapping the same `invoices` collection", () => {
    expect(source).toMatch(/<RecordCardList>[\s\S]*?\{invoices\.map/);
  });

  it("every real data column (Invoice #, Project, Client, Amount, Status, Due date, Created) has a matching RecordCardField — three of the seven (Amount/Due date/Created) are now sortable headers, counted identically", () => {
    const listStart = source.indexOf("<RecordCardList>");
    const listEnd = source.indexOf("</RecordCardList>");
    expect(listStart).toBeGreaterThan(-1);
    const dataHeaders = countDataHeaders(source);
    const cardFields = countCardFields(source, [listStart, listEnd]);
    expect(dataHeaders).toBe(7);
    expect(cardFields).toBe(dataHeaders);
  });

  it("preserves the DRAFT-conditional Edit+overflow-menu-Delete vs. View action — Delete still exists, now inside RowActionMenu rather than inline", () => {
    const listStart = source.indexOf("<RecordCardList>");
    const listEnd = source.indexOf("</RecordCardList>");
    const region = source.slice(listStart, listEnd);
    expect(region).toMatch(/invoice\.status === "DRAFT"/);
    expect(region).toMatch(/deleteInvoiceAction\.bind\(null, invoice\.id\)/);
    expect(region).toMatch(/<RowActionMenu[\s>]/);
    expect(region).toMatch(/>\s*View\s*</);
  });

  it("no empty overflow menu is ever rendered for a non-DRAFT row — RowActionMenu only appears inside the DRAFT branch", () => {
    const listStart = source.indexOf("<RecordCardList>");
    const listEnd = source.indexOf("</RecordCardList>");
    const region = source.slice(listStart, listEnd);
    // `[\s>]` after the name — not just `/<RowActionMenu/` — so this
    // never also matches the unrelated `<RowActionMenuItem>` (a real,
    // separate component whose own name happens to start with the same
    // substring).
    const rowActionMenuCount = [...region.matchAll(/<RowActionMenu[\s>]/g)].length;
    // Exactly one RowActionMenu in the whole mobile card region — the one
    // inside the `invoice.status === "DRAFT"` branch; the `else` (View)
    // branch never renders one at all.
    expect(rowActionMenuCount).toBe(1);
  });
});

describe("Team list page — responsive stacked-card adoption (both tables)", () => {
  const source = read(PATHS.team);

  it("imports the shared RecordCardList/RecordCard/RecordCardField primitives", () => {
    expect(importsSharedPrimitives(source)).toBe(true);
  });

  it("exactly two RecordCardList regions exist — one per existing table (Members, Pending invitations)", () => {
    const occurrences = [...source.matchAll(/<RecordCardList>/g)].length;
    expect(occurrences).toBe(2);
  });

  it("both existing <Table> blocks (Members, Pending invitations) are hidden below xl and visible at xl and up", () => {
    const tableOpens = [...source.matchAll(/<Table>/g)].map((m) => m.index!);
    expect(tableOpens).toHaveLength(2);
    for (const idx of tableOpens) {
      const preceding = source.slice(Math.max(0, idx - 200), idx);
      expect(preceding).toMatch(/className="[^"]*\bhidden\b[^"]*\bxl:(block|table)\b[^"]*"/);
    }
  });

  it("the Members card list maps the same `memberships` collection and preserves the isSelf/(You) marker, the isOwner-conditional RoleSelect vs. StatusBadge, and the isOwner&&!isSelf-conditional Transfer/Remove actions", () => {
    const firstListStart = source.indexOf("<RecordCardList>");
    const firstListEnd = source.indexOf("</RecordCardList>", firstListStart);
    const region = source.slice(firstListStart, firstListEnd);
    expect(region).toMatch(/\{memberships\.map/);
    expect(region).toMatch(/\(You\)/);
    expect(region).toMatch(/isOwner && !isSelf/);
    expect(region).toMatch(/<RoleSelect/);
    expect(region).toMatch(/<StatusBadge status=\{m\.role\}/);
    expect(region).toMatch(/TransferOwnershipButton/);
    expect(region).toMatch(/RemoveMemberButton/);
  });

  it("the Members card fields cover Name, Email, Role, and Joined — no field silently dropped", () => {
    const firstListStart = source.indexOf("<RecordCardList>");
    const firstListEnd = source.indexOf("</RecordCardList>", firstListStart);
    const region = source.slice(firstListStart, firstListEnd);
    const fieldLabels = [...region.matchAll(/label="([^"]+)"/g)].map((m) => m[1]);
    expect(fieldLabels).toEqual(expect.arrayContaining(["Name", "Email", "Role", "Joined"]));
  });

  it("the Pending invitations card list maps the same `invitations` collection and preserves the canManage-conditional Resend/Cancel vs. CopyLinkButton actions", () => {
    const secondListStart = source.indexOf("<RecordCardList>", source.indexOf("</RecordCardList>") + 1);
    const secondListEnd = source.indexOf("</RecordCardList>", secondListStart);
    const region = source.slice(secondListStart, secondListEnd);
    expect(region).toMatch(/\{invitations\.map/);
    expect(region).toMatch(/canManage/);
    expect(region).toMatch(/ResendInvitationForm/);
    expect(region).toMatch(/CancelInvitationButton/);
    expect(region).toMatch(/CopyLinkButton/);
  });

  it("the Pending invitations card fields cover Email, Role, Invited by, and Expires", () => {
    const secondListStart = source.indexOf("<RecordCardList>", source.indexOf("</RecordCardList>") + 1);
    const secondListEnd = source.indexOf("</RecordCardList>", secondListStart);
    const region = source.slice(secondListStart, secondListEnd);
    const fieldLabels = [...region.matchAll(/label="([^"]+)"/g)].map((m) => m[1]);
    expect(fieldLabels).toEqual(expect.arrayContaining(["Email", "Role", "Invited by", "Expires"]));
  });
});
