import { DiagramsOriginError } from "./errors.js";

/**
 * Validates and normalizes an origin string for the draw.io embed client.
 *
 * Security rules:
 * - Must be an explicit, non-empty origin string.
 * - Wildcards ("*") are strictly rejected.
 * - Must be a valid URL with "https:" or "http:" protocol.
 * - Must have no path components (no trailing slash), no search query, no hash fragment, and no embedded credentials.
 * - Returns the exact normalized origin matching url.origin.
 */
export function validateDiagramsOrigin(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DiagramsOriginError("An explicit, non-empty origin string is required to embed draw.io");
  }

  const trimmed = value.trim();
  if (trimmed === "*") {
    throw new DiagramsOriginError('Wildcard origin "*" is prohibited for draw.io embed security');
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new DiagramsOriginError(`Invalid origin URL: "${trimmed}"`);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new DiagramsOriginError(`Origin must use "https:" or "http:" protocol, received: "${url.protocol}"`);
  }

  if (url.username || url.password) {
    throw new DiagramsOriginError("Origin must not contain embedded user credentials");
  }

  if (url.search || url.hash) {
    throw new DiagramsOriginError("Origin must not contain query parameters or hash fragments");
  }

  if (url.pathname !== "" && url.pathname !== "/") {
    throw new DiagramsOriginError(`Origin must not contain path components, received pathname: "${url.pathname}"`);
  }

  // Ensure byte-exact match with url.origin (no trailing slash)
  if (trimmed !== url.origin) {
    throw new DiagramsOriginError(`Origin must match exact origin format "${url.origin}" (no trailing slashes or paths)`);
  }

  return url.origin;
}
