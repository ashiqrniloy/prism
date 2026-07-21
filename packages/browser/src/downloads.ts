/**
 * Bounded download quarantine: stream → hash/MIME/name metadata → host release approval.
 */
import { createHash, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, open, rm } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { BrowserError } from "./errors.js";
import type { ResolvedBrowserLimits } from "./limits.js";
import type { PlaywrightDownload } from "./types.js";

export interface BrowserDownloadOptions {
  /** Absolute quarantine directory (typically sandbox `/downloads` on host or bind). */
  readonly quarantine: string;
  /** Per-file byte cap override (still clamped by resolved limits). */
  readonly maxBytes?: number;
  /**
   * Host callback required before a quarantined download may leave quarantine.
   * Returning false keeps the file quarantined (and eligible for cleanup).
   */
  readonly approveRelease?: (meta: DownloadMetadata) => boolean | Promise<boolean>;
}

export interface DownloadMetadata {
  readonly downloadId: string;
  readonly suggestedName: string;
  readonly safeName: string;
  readonly quarantinePath: string;
  readonly url: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly mimeType?: string;
  readonly released: boolean;
}

export interface DownloadBudget {
  count: number;
  aggregateBytes: number;
  readonly items: Map<string, DownloadMetadata & { released: boolean }>;
}

export function createDownloadBudget(): DownloadBudget {
  return { count: 0, aggregateBytes: 0, items: new Map() };
}

export function sanitizeDownloadName(name: string): string {
  const base = basename(name || "download.bin").replace(/[\u0000-\u001f\u007f]/g, "");
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "");
  const trimmed = cleaned.slice(0, 128) || "download.bin";
  if (trimmed === "." || trimmed === ".." || trimmed.includes("/") || trimmed.includes("\\")) {
    return "download.bin";
  }
  return trimmed;
}

function sniffMime(buf: Buffer): string | undefined {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return "image/png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 4 && buf.toString("ascii", 0, 4) === "%PDF") return "application/pdf";
  if (buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b) return "application/zip";
  return undefined;
}

async function* boundedChunks(
  source: AsyncIterable<unknown>,
  caps: {
    perFileCap: number;
    aggregateCap: number;
    aggregateUsed: number;
    signal?: AbortSignal;
    onHead: (buf: Buffer) => void;
    onBytes: (n: number) => void;
    hash: { update(buf: Buffer): void };
  },
): AsyncGenerator<Buffer> {
  let bytes = 0;
  let sawHead = false;
  for await (const chunk of source) {
    if (caps.signal?.aborted) {
      throw new BrowserError("ERR_PRISM_BROWSER", "download aborted");
    }
    const buf = Buffer.isBuffer(chunk)
      ? chunk
      : chunk instanceof Uint8Array
        ? Buffer.from(chunk)
        : Buffer.from(String(chunk));
    bytes += buf.byteLength;
    if (bytes > caps.perFileCap) {
      throw new BrowserError(
        "ERR_PRISM_BROWSER_LIMIT",
        `download exceeds maxDownloadBytes ${caps.perFileCap}`,
      );
    }
    if (caps.aggregateUsed + bytes > caps.aggregateCap) {
      throw new BrowserError(
        "ERR_PRISM_BROWSER_LIMIT",
        `download exceeds maxDownloadAggregateBytes ${caps.aggregateCap}`,
      );
    }
    if (!sawHead) {
      caps.onHead(buf.subarray(0, Math.min(buf.byteLength, 16)));
      sawHead = true;
    }
    caps.hash.update(buf);
    caps.onBytes(bytes);
    yield buf;
  }
}

export async function quarantineDownload(
  download: PlaywrightDownload,
  options: BrowserDownloadOptions,
  limits: ResolvedBrowserLimits,
  budget: DownloadBudget,
  signal?: AbortSignal,
): Promise<DownloadMetadata> {
  if (!isAbsolute(options.quarantine)) {
    throw new BrowserError("ERR_PRISM_BROWSER_INPUT", "downloads.quarantine must be absolute");
  }
  if (budget.count >= limits.maxDownloads) {
    try {
      await download.cancel?.();
    } catch {
      /* ignore */
    }
    throw new BrowserError("ERR_PRISM_BROWSER_LIMIT", `maxDownloads ${limits.maxDownloads} exceeded`);
  }

  const perFileCap = Math.min(options.maxBytes ?? limits.maxDownloadBytes, limits.maxDownloadBytes);
  await mkdir(options.quarantine, { recursive: true, mode: 0o700 });

  const downloadId = `dl_${randomBytes(8).toString("hex")}`;
  const suggested = sanitizeDownloadName(download.suggestedFilename?.() ?? "download.bin");
  const safeName = `${downloadId}_${suggested}`;
  const quarantineRoot = resolve(options.quarantine);
  const quarantinePath = resolve(join(quarantineRoot, safeName));
  if (!quarantinePath.startsWith(quarantineRoot + "/") && quarantinePath !== quarantineRoot) {
    throw new BrowserError("ERR_PRISM_BROWSER_ARTIFACT", "quarantine path escaped root");
  }

  const hash = createHash("sha256");
  let bytes = 0;
  let head: Buffer | undefined;
  const url = (() => {
    try {
      return download.url().slice(0, 2_048);
    } catch {
      return "";
    }
  })();

  try {
    const stream =
      typeof download.createReadStream === "function" ? await download.createReadStream() : null;
    if (stream) {
      await pipeline(
        Readable.from(
          boundedChunks(stream as AsyncIterable<unknown>, {
            perFileCap,
            aggregateCap: limits.maxDownloadAggregateBytes,
            aggregateUsed: budget.aggregateBytes,
            signal,
            onHead: (buf) => {
              head = buf;
            },
            onBytes: (n) => {
              bytes = n;
            },
            hash,
          }),
        ),
        createWriteStream(quarantinePath, { mode: 0o600, flags: "wx" }),
      );
    } else if (typeof download.saveAs === "function") {
      await download.saveAs(quarantinePath);
      const handle = await open(quarantinePath, "r");
      try {
        const stat = await handle.stat();
        bytes = stat.size;
        if (bytes > perFileCap || budget.aggregateBytes + bytes > limits.maxDownloadAggregateBytes) {
          await rm(quarantinePath, { force: true });
          throw new BrowserError("ERR_PRISM_BROWSER_LIMIT", "download exceeds byte budget");
        }
        const buf = Buffer.alloc(64 * 1024);
        let remaining = bytes;
        while (remaining > 0) {
          const { bytesRead } = await handle.read(buf, 0, Math.min(buf.length, remaining), null);
          if (bytesRead <= 0) break;
          if (!head) head = buf.subarray(0, Math.min(bytesRead, 16));
          hash.update(buf.subarray(0, bytesRead));
          remaining -= bytesRead;
        }
      } finally {
        await handle.close();
      }
    } else {
      throw new BrowserError("ERR_PRISM_BROWSER", "Download stream API unavailable");
    }
  } catch (error) {
    await rm(quarantinePath, { force: true }).catch(() => undefined);
    try {
      await download.cancel?.();
    } catch {
      /* ignore */
    }
    if (error instanceof BrowserError) throw error;
    throw new BrowserError(
      "ERR_PRISM_BROWSER_ARTIFACT",
      `download quarantine failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const meta: DownloadMetadata = {
    downloadId,
    suggestedName: suggested,
    safeName,
    quarantinePath,
    url,
    bytes,
    sha256: hash.digest("hex"),
    mimeType: head ? sniffMime(head) : undefined,
    released: false,
  };
  budget.count += 1;
  budget.aggregateBytes += bytes;
  budget.items.set(downloadId, { ...meta, released: false });
  return meta;
}

export async function releaseDownload(
  downloadId: string,
  options: BrowserDownloadOptions,
  budget: DownloadBudget,
): Promise<DownloadMetadata> {
  const item = budget.items.get(downloadId);
  if (!item) {
    throw new BrowserError("ERR_PRISM_BROWSER_STATE", `Unknown downloadId ${downloadId}`);
  }
  if (item.released) return item;
  if (!options.approveRelease) {
    throw new BrowserError(
      "ERR_PRISM_BROWSER_ARTIFACT",
      "download release requires host approveRelease callback",
    );
  }
  const ok = await options.approveRelease(item);
  if (!ok) {
    throw new BrowserError("ERR_PRISM_BROWSER_ARTIFACT", "host denied download release");
  }
  const released = { ...item, released: true };
  budget.items.set(downloadId, released);
  return released;
}

export async function cleanupDownloads(budget: DownloadBudget): Promise<void> {
  for (const item of budget.items.values()) {
    if (item.released) continue;
    await rm(item.quarantinePath, { force: true }).catch(() => undefined);
  }
  budget.items.clear();
  budget.count = 0;
  budget.aggregateBytes = 0;
}
