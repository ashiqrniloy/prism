export function retryableAdmission(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const admission = value as { readonly status?: unknown; readonly reason?: unknown };
  return (
    admission.status === "denied" &&
    (admission.reason === "capacity" || admission.reason === "unavailable" || admission.reason === "stopped")
  );
}
