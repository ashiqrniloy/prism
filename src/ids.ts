import { randomUUID } from "node:crypto";

/** Cryptographically unpredictable identifier for internal Prism records. */
export function createId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}
