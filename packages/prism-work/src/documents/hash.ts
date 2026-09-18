import { createHash } from "node:crypto";

/**
 * Computes a standard 64-character lowercase SHA-256 hex digest over binary bytes.
 */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
