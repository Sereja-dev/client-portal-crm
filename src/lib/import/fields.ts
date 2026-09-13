/**
 * CSV Import Phase 2 — the one canonical list of mappable Aqenra fields
 * per entity, for both the mapping-UI's own option list and server-side
 * mapping validation (a submitted mapping may only ever target a key
 * from this list — see mapping.ts's own validateImportMapping). Every
 * field explicitly excluded by the locked Phase 2 scope (Tags, Custom
 * Fields, Status/Stage, ids, timestamps, assignee, any other internal/
 * system field) simply never appears here, so it can never become a
 * mapping target no matter what a CSV's own header row says.
 */

export type ClientImportFieldKey =
  | "name"
  | "company"
  | "email"
  | "phone"
  | "notes"
  | "billingLegalName"
  | "taxId"
  | "streetAddress"
  | "city"
  | "state"
  | "postalCode"
  | "country";

export type LeadImportFieldKey = "name" | "company" | "email" | "phone" | "source" | "value" | "notes";

export type ImportFieldDefinition<Key extends string> = {
  key: Key;
  label: string;
  required: boolean;
  /** Normalized (lowercased, punctuation/whitespace-stripped) header aliases this field auto-suggests from — see mapping.ts's own normalizeHeaderName. Always includes the field's own label. */
  headerAliases: string[];
};

export const CLIENT_IMPORT_FIELDS: readonly ImportFieldDefinition<ClientImportFieldKey>[] = [
  { key: "name", label: "Name", required: true, headerAliases: ["name", "fullname", "clientname"] },
  { key: "company", label: "Company", required: false, headerAliases: ["company", "companyname", "organization"] },
  { key: "email", label: "Email", required: false, headerAliases: ["email", "emailaddress"] },
  { key: "phone", label: "Phone", required: false, headerAliases: ["phone", "phonenumber", "telephone"] },
  { key: "notes", label: "Notes", required: false, headerAliases: ["notes", "note", "comments"] },
  {
    key: "billingLegalName",
    label: "Billing Legal Name",
    required: false,
    headerAliases: ["billinglegalname", "legalname", "billingname"],
  },
  { key: "taxId", label: "Tax ID", required: false, headerAliases: ["taxid", "vatid", "taxnumber"] },
  {
    key: "streetAddress",
    label: "Street Address",
    required: false,
    headerAliases: ["streetaddress", "address", "street"],
  },
  { key: "city", label: "City", required: false, headerAliases: ["city", "town"] },
  { key: "state", label: "State", required: false, headerAliases: ["state", "province", "region"] },
  { key: "postalCode", label: "Postal Code", required: false, headerAliases: ["postalcode", "zip", "zipcode"] },
  { key: "country", label: "Country", required: false, headerAliases: ["country"] },
] as const;

export const LEAD_IMPORT_FIELDS: readonly ImportFieldDefinition<LeadImportFieldKey>[] = [
  { key: "name", label: "Name", required: true, headerAliases: ["name", "fullname", "leadname"] },
  { key: "company", label: "Company", required: false, headerAliases: ["company", "companyname", "organization"] },
  { key: "email", label: "Email", required: false, headerAliases: ["email", "emailaddress"] },
  { key: "phone", label: "Phone", required: false, headerAliases: ["phone", "phonenumber", "telephone"] },
  { key: "source", label: "Source", required: false, headerAliases: ["source", "leadsource"] },
  { key: "value", label: "Value", required: false, headerAliases: ["value", "dealvalue", "amount"] },
  { key: "notes", label: "Notes", required: false, headerAliases: ["notes", "note", "comments"] },
] as const;
