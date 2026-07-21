import { randomBytes } from "node:crypto";
import { BrowserError } from "./errors.js";
import type { ResolvedBrowserLimits } from "./limits.js";
import { parseSnapshotRefs } from "./targets.js";
import type { BrowserSnapshotResult, PlaywrightPage, SnapshotRefInfo } from "./types.js";

export interface LiveSnapshot {
  readonly snapshotId: string;
  readonly pageId: string;
  readonly url: string;
  readonly title: string;
  readonly ariaSnapshot: string;
  readonly refs: ReadonlyMap<string, SnapshotRefInfo>;
  readonly truncated: boolean;
  readonly truncatedBy?: "bytes" | "refs" | "depth";
  readonly createdAt: number;
}

export function createSnapshotId(): string {
  return `snap_${randomBytes(8).toString("hex")}`;
}

export async function captureAriaSnapshot(
  page: PlaywrightPage,
  pageId: string,
  limits: ResolvedBrowserLimits,
): Promise<LiveSnapshot> {
  let yaml: string;
  try {
    yaml = await page.ariaSnapshot({
      mode: "ai",
      depth: limits.maxSnapshotDepth,
      timeout: limits.actionTimeoutMs,
    });
  } catch (error) {
    throw new BrowserError(
      "ERR_PRISM_BROWSER",
      `ariaSnapshot failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (typeof yaml !== "string") {
    throw new BrowserError("ERR_PRISM_BROWSER", "ariaSnapshot returned a non-string value");
  }

  let truncated = false;
  let truncatedBy: LiveSnapshot["truncatedBy"];
  const bytes = Buffer.byteLength(yaml, "utf8");
  if (bytes > limits.maxSnapshotBytes) {
    yaml = Buffer.from(yaml, "utf8").subarray(0, limits.maxSnapshotBytes).toString("utf8");
    // Avoid cutting mid-line for readability.
    const lastNl = yaml.lastIndexOf("\n");
    if (lastNl > 0) yaml = yaml.slice(0, lastNl);
    truncated = true;
    truncatedBy = "bytes";
  }

  const parsed = parseSnapshotRefs(yaml, limits.maxSnapshotRefs);
  if (parsed.truncatedByRefs) {
    truncated = true;
    truncatedBy = truncatedBy ?? "refs";
  }

  let url = "";
  let title = "";
  try {
    url = page.url();
  } catch {
    url = "";
  }
  try {
    title = await page.title();
  } catch {
    title = "";
  }

  return {
    snapshotId: createSnapshotId(),
    pageId,
    url: boundText(url, 2_048),
    title: boundText(title, 1_024),
    ariaSnapshot: yaml,
    refs: parsed.refs,
    truncated,
    truncatedBy,
    createdAt: Date.now(),
  };
}

export function toSnapshotResult(snapshot: LiveSnapshot): BrowserSnapshotResult {
  return {
    snapshotId: snapshot.snapshotId,
    pageId: snapshot.pageId,
    url: snapshot.url,
    title: snapshot.title,
    ariaSnapshot: snapshot.ariaSnapshot,
    refCount: snapshot.refs.size,
    truncated: snapshot.truncated,
    ...(snapshot.truncatedBy ? { truncatedBy: snapshot.truncatedBy } : {}),
  };
}

function boundText(value: string, maxBytes: number): string {
  const buf = Buffer.from(value, "utf8");
  if (buf.byteLength <= maxBytes) return value;
  return buf.subarray(0, maxBytes).toString("utf8");
}
