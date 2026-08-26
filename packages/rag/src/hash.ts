/**
 * Document hashes are supplied by the host (never computed over unbounded bytes inside the
 * engine). Accept any hex digest of 32..128 characters so hosts can pick the algorithm;
 * comparison is exact-match on the normalized lowercase form.
 */
export function isValidContentHash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{32,128}$/.test(value);
}
