import { createHash, type Hash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, opendir, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";

export interface TarBounds {
  readonly maxEntries: number;
  readonly maxBytes: number;
}

export interface TarExportSummary {
  readonly sha256: string;
  readonly entryCount: number;
  readonly byteCount: number;
}

export class SandboxTarError extends Error {
  readonly code = "ERR_PRISM_SANDBOX_TAR";
  constructor(message: string) {
    super(message);
    this.name = "SandboxTarError";
  }
}

const BLOCK = 512;

function encodeOctal(value: number, length: number): Buffer {
  const body = value.toString(8).padStart(length - 1, "0");
  return Buffer.from(`${body}\0`, "utf8");
}

function checksumHeader(header: Buffer): number {
  let sum = 0;
  for (let i = 0; i < header.length; i++) sum += header[i]!;
  return sum;
}

function writeUstarHeader(opts: {
  name: string;
  size: number;
  mode: number;
  mtimeSec: number;
  type: "0" | "5";
}): Buffer {
  if (Buffer.byteLength(opts.name, "utf8") > 100) {
    throw new SandboxTarError(`tar path exceeds 100 UTF-8 bytes: ${opts.name}`);
  }
  const header = Buffer.alloc(BLOCK, 0);
  header.write(opts.name, 0, 100, "utf8");
  encodeOctal(opts.mode & 0o7777, 8).copy(header, 100);
  encodeOctal(0, 8).copy(header, 108);
  encodeOctal(0, 8).copy(header, 116);
  encodeOctal(opts.size, 12).copy(header, 124);
  encodeOctal(opts.mtimeSec, 12).copy(header, 136);
  header.write("        ", 148, 8, "utf8");
  header.write(opts.type, 156, 1, "utf8");
  header.write("ustar\0", 257, 6, "utf8");
  header.write("00", 263, 2, "utf8");
  const sum = checksumHeader(header);
  const checksum = Buffer.from(`${sum.toString(8).padStart(6, "0")}\0 `, "utf8");
  checksum.copy(header, 148);
  return header;
}

function padToBlock(size: number): number {
  const rem = size % BLOCK;
  return rem === 0 ? 0 : BLOCK - rem;
}

interface WalkEntry {
  readonly abs: string;
  readonly rel: string;
  readonly size: number;
  readonly mode: number;
  readonly dir: boolean;
}

async function* walkRegularFiles(root: string, bounds: TarBounds): AsyncGenerator<WalkEntry> {
  const rootReal = await realpath(root);
  let entries = 0;
  let bytes = 0;

  async function* visit(dirReal: string): AsyncGenerator<WalkEntry> {
    const handle = await opendir(dirReal);
    try {
      for await (const dirent of handle) {
        const abs = join(dirReal, dirent.name);
        const st = await lstat(abs);
        if (st.isSymbolicLink()) {
          throw new SandboxTarError(`symlink rejected during sandbox import: ${abs}`);
        }
        if (st.isFIFO() || st.isSocket() || st.isCharacterDevice() || st.isBlockDevice()) {
          throw new SandboxTarError(`special file rejected during sandbox import: ${abs}`);
        }
        const relToRoot = relative(rootReal, abs);
        if (relToRoot.startsWith("..") || relToRoot.includes(`..${sep}`)) {
          throw new SandboxTarError(`path escape rejected during sandbox import: ${abs}`);
        }
        const rel = relToRoot.split(sep).join("/");
        entries += 1;
        if (entries > bounds.maxEntries) {
          throw new SandboxTarError(`import exceeded max entries (${bounds.maxEntries})`);
        }
        if (st.isDirectory()) {
          if (rel !== "") {
            yield { abs, rel: `${rel}/`, size: 0, mode: st.mode, dir: true };
          }
          const childReal = await realpath(abs);
          if (relative(rootReal, childReal).startsWith("..")) {
            throw new SandboxTarError(`directory escape rejected during sandbox import: ${abs}`);
          }
          yield* visit(childReal);
          continue;
        }
        if (!st.isFile()) {
          throw new SandboxTarError(`unsupported file type during sandbox import: ${abs}`);
        }
        bytes += st.size;
        if (bytes > bounds.maxBytes) {
          throw new SandboxTarError(`import exceeded max bytes (${bounds.maxBytes})`);
        }
        yield { abs, rel, size: st.size, mode: st.mode, dir: false };
      }
    } finally {
      await handle.close().catch(() => undefined);
    }
  }

  yield* visit(rootReal);
}

async function* importTarBlocks(sourceRoot: string, bounds: TarBounds): AsyncGenerator<Buffer> {
  const mtimeSec = Math.floor(Date.now() / 1000);
  for await (const entry of walkRegularFiles(sourceRoot, bounds)) {
    if (entry.dir) {
      yield writeUstarHeader({
        name: entry.rel.endsWith("/") ? entry.rel : `${entry.rel}/`,
        size: 0,
        mode: entry.mode,
        mtimeSec,
        type: "5",
      });
      continue;
    }
    yield writeUstarHeader({
      name: entry.rel,
      size: entry.size,
      mode: entry.mode,
      mtimeSec,
      type: "0",
    });
    const file = createReadStream(entry.abs);
    for await (const chunk of file) {
      yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    }
    const padding = padToBlock(entry.size);
    if (padding > 0) yield Buffer.alloc(padding, 0);
  }
  yield Buffer.alloc(BLOCK * 2, 0);
}

/** Create a bounded ustar stream from a host directory. Rejects symlinks/devices/escapes. */
export function createImportTarStream(sourceRoot: string, bounds: TarBounds): Readable {
  return Readable.from(importTarBlocks(sourceRoot, bounds));
}

function parseOctal(buf: Buffer): number {
  const text = buf.toString("utf8").replace(/\0/g, "").trim();
  if (!text) return 0;
  return Number.parseInt(text, 8);
}

/**
 * Consume a ustar stream, enforce entry/byte bounds, and compute SHA-256 of the raw bytes.
 * Rejects absolute paths, `..` segments, and non-file/dir entry types.
 */
export async function summarizeTarStream(
  stream: AsyncIterable<Buffer>,
  bounds: TarBounds,
): Promise<TarExportSummary> {
  const hash: Hash = createHash("sha256");
  let pending = Buffer.alloc(0);
  let entryCount = 0;
  let byteCount = 0;
  let fileRemaining = 0;
  let skipPadding = 0;
  let sawZeroBlock = false;
  let finished = false;

  const take = (n: number): Buffer | undefined => {
    if (pending.length < n) return undefined;
    const out = pending.subarray(0, n);
    pending = pending.subarray(n);
    return out;
  };

  for await (const chunk of stream) {
    hash.update(chunk);
    byteCount += chunk.byteLength;
    if (byteCount > bounds.maxBytes) {
      throw new SandboxTarError(`export exceeded max bytes (${bounds.maxBytes})`);
    }
    if (finished) continue;
    pending = pending.length === 0 ? Buffer.from(chunk) : Buffer.concat([pending, chunk]);

    while (true) {
      if (fileRemaining > 0) {
        if (pending.length === 0) break;
        const n = Math.min(fileRemaining, pending.length);
        pending = pending.subarray(n);
        fileRemaining -= n;
        if (fileRemaining === 0 && skipPadding > 0) {
          if (pending.length < skipPadding) break;
          pending = pending.subarray(skipPadding);
          skipPadding = 0;
        }
        continue;
      }

      const header = take(BLOCK);
      if (!header) break;
      if (header.every((b) => b === 0)) {
        if (sawZeroBlock) {
          finished = true;
          pending = Buffer.alloc(0);
          break;
        }
        sawZeroBlock = true;
        continue;
      }
      sawZeroBlock = false;
      const name = header.subarray(0, 100).toString("utf8").replace(/\0/g, "");
      const size = parseOctal(header.subarray(124, 136));
      const typeFlag = String.fromCharCode(header[156] ?? 0);
      if (!name || name.startsWith("/") || name.split("/").includes("..")) {
        throw new SandboxTarError(`unsafe tar path rejected: ${name || "<empty>"}`);
      }
      if (typeFlag !== "0" && typeFlag !== "\0" && typeFlag !== "5") {
        throw new SandboxTarError(`unsupported tar entry type '${typeFlag}' for ${name}`);
      }
      entryCount += 1;
      if (entryCount > bounds.maxEntries) {
        throw new SandboxTarError(`export exceeded max entries (${bounds.maxEntries})`);
      }
      if (typeFlag === "5") continue;
      fileRemaining = size;
      skipPadding = padToBlock(size);
    }
  }

  return {
    sha256: hash.digest("hex"),
    entryCount,
    byteCount,
  };
}

export function resolveUnderRoot(root: string, candidate: string): string {
  const resolved = resolve(root, candidate);
  const rel = relative(resolve(root), resolved);
  if (rel.startsWith("..") || rel.includes(`..${sep}`)) {
    throw new SandboxTarError(`path escapes root: ${candidate}`);
  }
  return resolved;
}
