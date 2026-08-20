/**
 * Opt-in coding-tool projection for ACP (F7 / plan 028 Task 14).
 *
 * Default ACP mapping is deny-by-default: tool diffs/locations leave the host
 * only through `AgUiProjection.toolDiff` / `toolLocations`. This factory is the
 * turnkey allow-list for first-party `edit` / `write` results from
 * `@arnilo/prism-coding-agent`. Hosts pass it as `projection`; without it,
 * behavior is unchanged.
 *
 * Shapes recognized (success results only; errors → nothing):
 * - `edit`: metadata `{ path, patch|diff, firstChangedLine? }` → diff block
 *   (`newText` = unified patch) + location at `firstChangedLine`.
 * - `write`: metadata `{ path }` → location only (result carries no file body,
 *   so no honest oldText/newText; use `file_changed` + `fileDiff` for bodies).
 * - `delete`: metadata `{ path }` → location only.
 * - `move`: metadata `{ to }` (falling back to `{ from }`) → destination location only;
 *   moves never emit a fake diff.
 *
 * Redaction and the hard `acpDiffBytes` / `acpLocationsPerUpdate` caps still
 * run in the mapper after this returns. Optional `maxDiffBytes` pre-truncates
 * the patch text so a slightly-oversize edit is shortened instead of dropped.
 */
import type { ToolResult } from "@arnilo/prism";
import type { AgUiProjection } from "../projection.js";

export interface CodingToolProjectionOptions {
  /** Pre-truncate patch text to this many UTF-8 bytes before the mapper's `acpDiffBytes` check. */
  readonly maxDiffBytes?: number;
}

function metaString(result: ToolResult, key: string): string | undefined {
  const value = result.metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function metaLine(result: ToolResult, key: string): number | undefined {
  const value = result.metadata?.[key];
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function truncateBytes(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  let out = "";
  let bytes = 0;
  for (const char of value) {
    const size = Buffer.byteLength(char, "utf8");
    if (bytes + size > maxBytes) break;
    bytes += size;
    out += char;
  }
  return out;
}

/** Opt-in `AgUiProjection` hooks for first-party coding `edit`/`write` results. */
export function createCodingToolProjection(options: CodingToolProjectionOptions = {}): AgUiProjection {
  const maxDiffBytes = options.maxDiffBytes;
  return {
    toolDiff(result) {
      if (result.error || result.name !== "edit") return undefined;
      const path = metaString(result, "path");
      const patch = metaString(result, "patch") ?? metaString(result, "diff");
      if (!path || !patch) return undefined;
      return {
        path,
        newText: maxDiffBytes === undefined ? patch : truncateBytes(patch, maxDiffBytes),
      };
    },
    toolLocations(result) {
      if (result.error || !["edit", "write", "delete", "move"].includes(result.name)) return undefined;
      const path = result.name === "move" ? (metaString(result, "to") ?? metaString(result, "from")) : metaString(result, "path");
      if (!path) return undefined;
      const line = result.name === "edit" ? metaLine(result, "firstChangedLine") : undefined;
      return [{ path, ...(line === undefined ? {} : { line }) }];
    },
  };
}
