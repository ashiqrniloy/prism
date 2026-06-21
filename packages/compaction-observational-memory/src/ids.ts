import { createHash } from "node:crypto";
import { isMemoryId } from "./types.js";

export { isMemoryId };

export function createMemoryId(...parts: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 12);
}
