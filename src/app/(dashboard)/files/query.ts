import { parseSearchParam, parseEnumParam, type RawSearchParams } from "@/lib/list-params";
import type { AttachmentEntityType } from "@/generated/prisma/enums";

// Documents Slice D — Global Files V1. Exactly the three supported
// entity types (locked spec §5/§6) — never CONTRACT.
const FILE_ENTITY_TYPE_FILTER_VALUES = ["CLIENT", "PROJECT", "INVOICE"] as const;
export const FILE_ENTITY_TYPE_FILTER_OPTIONS = FILE_ENTITY_TYPE_FILTER_VALUES;

export type FilesListParams = {
  q: string;
  entityType?: AttachmentEntityType;
};

export function parseFilesListParams(searchParams: RawSearchParams): FilesListParams {
  const q = parseSearchParam(searchParams.q);
  const entityType = parseEnumParam(searchParams.type, FILE_ENTITY_TYPE_FILTER_VALUES);
  return { q, entityType };
}
