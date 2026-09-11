"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/select";
import { formatStatusLabel } from "@/lib/format";
import { CLIENT_REQUEST_STATUSES, CLIENT_REQUEST_PRIORITIES } from "@/lib/validation/client-request";

/**
 * Client Requests / Tickets Phase 2A — the Staff list page's own simple
 * status/priority/assignee filter bar (§"STAFF LIST": "Support simple
 * filters if straightforward... Do not build a complex search engine in
 * this phase"). Plain `?status=&priority=&assignedTo=` URL params, no
 * client-side state of its own — each select just navigates on change,
 * the same "URL is the only source of truth" shape every other filtered
 * list in this app (Leads pipeline view, Settings entity tabs) already
 * uses.
 */
export function StaffRequestFilters({ members }: { members: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.push(params.size > 0 ? `${pathname}?${params.toString()}` : pathname);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select
        aria-label="Filter by status"
        value={searchParams.get("status") ?? ""}
        onChange={(event) => updateParam("status", event.target.value)}
        className="w-auto"
      >
        <option value="">All statuses</option>
        {CLIENT_REQUEST_STATUSES.map((value) => (
          <option key={value} value={value}>
            {formatStatusLabel(value)}
          </option>
        ))}
      </Select>

      <Select
        aria-label="Filter by priority"
        value={searchParams.get("priority") ?? ""}
        onChange={(event) => updateParam("priority", event.target.value)}
        className="w-auto"
      >
        <option value="">All priorities</option>
        {CLIENT_REQUEST_PRIORITIES.map((value) => (
          <option key={value} value={value}>
            {formatStatusLabel(value)}
          </option>
        ))}
      </Select>

      <Select
        aria-label="Filter by assignee"
        value={searchParams.get("assignedTo") ?? ""}
        onChange={(event) => updateParam("assignedTo", event.target.value)}
        className="w-auto"
      >
        <option value="">All assignees</option>
        {members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name}
          </option>
        ))}
      </Select>
    </div>
  );
}
