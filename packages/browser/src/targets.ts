import { BrowserError } from "./errors.js";
import type { BrowserTarget, PlaywrightLocator, PlaywrightPage, SnapshotRefInfo } from "./types.js";

const REF_PATTERN = /^e\d+$/u;

export function assertValidRef(ref: string): string {
  if (typeof ref !== "string" || !REF_PATTERN.test(ref)) {
    throw new BrowserError("ERR_PRISM_BROWSER_TARGET", `Invalid snapshot ref: ${String(ref).slice(0, 64)}`);
  }
  return ref;
}

/**
 * Parse AI-mode aria snapshot YAML into a bounded ref table.
 * Refs are snapshot-scoped; callers invalidate the table after mutations.
 */
export function parseSnapshotRefs(ariaSnapshot: string, maxRefs: number): {
  refs: Map<string, SnapshotRefInfo>;
  truncatedByRefs: boolean;
} {
  const refs = new Map<string, SnapshotRefInfo>();
  let truncatedByRefs = false;
  for (const line of ariaSnapshot.split("\n")) {
    const refMatch = /\[ref=(e\d+)\]/u.exec(line);
    if (!refMatch) continue;
    if (refs.size >= maxRefs) {
      truncatedByRefs = true;
      break;
    }
    const ref = refMatch[1]!;
    if (refs.has(ref)) continue;
    const roleMatch = /^\s*-\s+([A-Za-z][A-Za-z0-9_-]*)/u.exec(line);
    const nameMatch = /"((?:\\.|[^"\\])*)"/u.exec(line);
    refs.set(ref, {
      ref,
      role: roleMatch?.[1],
      name: nameMatch ? unescapeYamlString(nameMatch[1]!) : undefined,
    });
  }
  return { refs, truncatedByRefs };
}

function unescapeYamlString(value: string): string {
  return value.replace(/\\(["\\])/gu, "$1");
}

export function normalizeTarget(raw: unknown): BrowserTarget {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new BrowserError("ERR_PRISM_BROWSER_TARGET", "target must be an object");
  }
  const obj = raw as Record<string, unknown>;
  const keys = Object.keys(obj);
  if ("css" in obj || "xpath" in obj || "selector" in obj || "evaluate" in obj) {
    throw new BrowserError("ERR_PRISM_BROWSER_TARGET", "CSS/XPath/selector/evaluate targets are not supported");
  }
  if (typeof obj.ref === "string") {
    if (keys.some((k) => k !== "ref")) {
      throw new BrowserError("ERR_PRISM_BROWSER_TARGET", "ref target must only include ref");
    }
    return { ref: assertValidRef(obj.ref) };
  }
  if (typeof obj.role === "string") {
    const name = obj.name === undefined ? undefined : String(obj.name);
    const exact = obj.exact === true;
    return { role: obj.role, ...(name !== undefined ? { name } : {}), exact };
  }
  if (typeof obj.label === "string") {
    return { label: obj.label, exact: obj.exact === true };
  }
  if (typeof obj.testId === "string") {
    return { testId: obj.testId };
  }
  if (typeof obj.text === "string") {
    return { text: obj.text, exact: obj.exact === true };
  }
  throw new BrowserError(
    "ERR_PRISM_BROWSER_TARGET",
    "target must be one of ref, role(+name), label, testId, or text",
  );
}

/**
 * Resolve a target against a page. Ref targets require a live snapshot table and
 * use Playwright's built-in `aria-ref=` selector engine (same mechanism as MCP).
 */
export async function resolveTargetLocator(
  page: PlaywrightPage,
  target: BrowserTarget,
  refs: ReadonlyMap<string, SnapshotRefInfo> | undefined,
  snapshotId: string | undefined,
): Promise<PlaywrightLocator> {
  if ("ref" in target) {
    if (!snapshotId || !refs) {
      throw new BrowserError("ERR_PRISM_BROWSER_TARGET", "ref actions require a current snapshotId");
    }
    assertValidRef(target.ref);
    if (!refs.has(target.ref)) {
      throw new BrowserError(
        "ERR_PRISM_BROWSER_TARGET",
        `Stale or unknown ref ${target.ref} for snapshot ${snapshotId}`,
      );
    }
    return page.locator(`aria-ref=${target.ref}`);
  }
  if ("role" in target) {
    return page.getByRole(target.role, {
      ...(target.name !== undefined ? { name: target.name } : {}),
      exact: target.exact === true,
    });
  }
  if ("label" in target) {
    return page.getByLabel(target.label, { exact: target.exact === true });
  }
  if ("testId" in target) {
    return page.getByTestId(target.testId);
  }
  return page.getByText(target.text, { exact: target.exact === true });
}

/** Enforce strict single-match semantics before acting. */
export async function requireUniqueLocator(locator: PlaywrightLocator): Promise<PlaywrightLocator> {
  const count = await locator.count();
  if (count === 0) {
    throw new BrowserError("ERR_PRISM_BROWSER_TARGET", "No element matched the target");
  }
  if (count > 1) {
    throw new BrowserError(
      "ERR_PRISM_BROWSER_TARGET",
      `Ambiguous target matched ${count} elements; refine role/name/label/testId or use a snapshot ref`,
    );
  }
  return locator.first();
}
