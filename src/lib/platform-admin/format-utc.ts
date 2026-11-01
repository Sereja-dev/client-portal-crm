/**
 * Platform Admin Growth V1. The one timezone convention for everything on
 * the Growth page: UTC, always labelled. Platform-wide figures have no
 * single local timezone to anchor to (the same reasoning
 * platform-dashboard.ts's startOfUtcDay documents), and rendering with the
 * viewer's locale would make the same record read differently on two
 * machines.
 */

/** "2026-11-01 05:04 UTC" */
export function formatUtcDateTime(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** "2026-11-01" */
export function formatUtcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
