/**
 * Appends a one-shot toast message to a redirect target. The destination
 * page's <ToastListener /> reads and strips these params on mount.
 */
export function withToast(
  path: string,
  message: string,
  variant: "success" | "error" = "success",
): string {
  const params = new URLSearchParams({ toast: message });
  if (variant === "error") {
    params.set("toastVariant", "error");
  }
  // A path that already carries a query (e.g. `/projects/<id>?tab=tasks`)
  // keeps it intact; the toast params are appended after it.
  return `${path}${path.includes("?") ? "&" : "?"}${params.toString()}`;
}
