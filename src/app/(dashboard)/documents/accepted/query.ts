import { parseSearchParam, type RawSearchParams } from "@/lib/list-params";

/**
 * Documents Slice D — Accepted documents. Deliberately thin, mirroring
 * contracts/query.ts's own identical "archived" boolean parsing exactly
 * (`?archived=1`) — Active/Archived is the only filter this V1 list
 * exposes (locked spec §16), consistent with Contracts' own list
 * semantics rather than inventing a separate archive model.
 */
export type AcceptedDocumentsListParams = {
  archived: boolean;
};

export function parseAcceptedDocumentsListParams(searchParams: RawSearchParams): AcceptedDocumentsListParams {
  return { archived: parseSearchParam(searchParams.archived) === "1" };
}
