/**
 * Read tool: read a file from the host filesystem.
 *
 * Behavioral port of pi's core/tools/read for @arnilo/prism-coding-agent, adapted to Prism's
 * `ToolDefinition` contract. Keeps pi's offset/limit continuation behavior while streaming one
 * bounded text page; image path remains magic-byte MIME → bounded `ImageContent`. Drops pi's
 * TUI (`renderCall`/`renderResult`, theme/syntax-highlight, compact classifications, key hints) and
 * the model-aware non-vision note (Prism's `ToolExecutionContext` has no model field).
 *
 * Deviations from pi (documented):
 *  - **Image resize is host-owned.** pi resizes images to ≤2000×2000 via a photon/WASM +
 *    `worker_threads` helper (`utils/image-process.js`); this package rejects oversize images by
 *    `stat`/`buffer.length` against `maxImageBytes` and accepts an optional `transformImage`
 *    callback for host-provided resizing. `autoResizeImages` is deprecated — it only takes effect
 *    when paired with `transformImage`.
 *  - Abort + all read failures return a Prism `error` result (pi throws/rejects). Prism's
 *    `dispatchToolCall` would catch a throw anyway, but returning a clean error result is predictable
 *    for direct-`execute` callers and matches the package's `shell` tool.
 *  - Truncation footers say "Use the shell tool" (pi: "Use bash") since the package's shell tool is
 *    named `shell`.
 */
import { Buffer } from "node:buffer";
import { constants } from "node:fs";
import { access as fsAccess, open, stat as fsStat } from "node:fs/promises";
import type {
  ExecutionPolicy,
  JsonObject,
  ToolDefinition,
  ToolExecutionContext,
  ToolResult,
} from "@arnilo/prism";
import { readFileBounded } from "./bounded-file.js";
import { enforceExecutionPolicy } from "./execution-policy.js";
import { resolveReadPathAsync } from "./path-utils.js";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_IMAGE_BYTES,
  DEFAULT_MAX_LINES,
  DEFAULT_MAX_TEXT_SCAN_BYTES,
  HARD_MAX_BYTES,
  HARD_MAX_IMAGE_BYTES,
  HARD_MAX_LINES,
  HARD_MAX_TEXT_SCAN_BYTES,
  validateCodingLimit,
} from "./limits.js";
import { formatSize, type TruncationResult } from "./truncate.js";

// --- magic-byte image MIME detection (faithful port of pi utils/mime.js, pure JS, no deps) ---

const IMAGE_TYPE_SNIFF_BYTES = 4100;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Detect a supported image MIME type from a buffer's leading bytes. Returns null for non-images. */
export function detectSupportedImageMimeType(buffer: Buffer): string | null {
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) {
    // SOI marker; 0xff 0xd8 0xff 0xf7 is a JFIF-extension frame, not a standalone JPEG image.
    return buffer[3] === 0xf7 ? null : "image/jpeg";
  }
  if (startsWith(buffer, PNG_SIGNATURE)) {
    return isPng(buffer) && !isAnimatedPng(buffer) ? "image/png" : null;
  }
  if (startsWithAscii(buffer, 0, "GIF")) {
    return "image/gif";
  }
  if (startsWithAscii(buffer, 0, "RIFF") && startsWithAscii(buffer, 8, "WEBP")) {
    return "image/webp";
  }
  if (startsWithAscii(buffer, 0, "BM") && isBmp(buffer)) {
    return "image/bmp";
  }
  return null;
}

/** Sniff the leading bytes of a file and return its image MIME type (null if not a supported image). */
export async function detectSupportedImageMimeTypeFromFile(filePath: string): Promise<string | null> {
  const fileHandle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(IMAGE_TYPE_SNIFF_BYTES);
    const { bytesRead } = await fileHandle.read(buffer, 0, IMAGE_TYPE_SNIFF_BYTES, 0);
    return detectSupportedImageMimeType(buffer.subarray(0, bytesRead));
  } finally {
    await fileHandle.close();
  }
}

function isPng(buffer: Buffer): boolean {
  // First chunk after the 8-byte signature must be a 13-byte IHDR.
  return (
    buffer.length >= 16 &&
    readUint32BE(buffer, PNG_SIGNATURE.length) === 13 &&
    startsWithAscii(buffer, 12, "IHDR")
  );
}

function isAnimatedPng(buffer: Buffer): boolean {
  // Walk PNG chunks; an acTL chunk before the first IDAT marks an animated (APNG) image.
  let offset = PNG_SIGNATURE.length;
  while (offset + 8 <= buffer.length) {
    const chunkLength = readUint32BE(buffer, offset);
    const chunkTypeOffset = offset + 4;
    if (startsWithAscii(buffer, chunkTypeOffset, "acTL")) return true;
    if (startsWithAscii(buffer, chunkTypeOffset, "IDAT")) return false;
    const nextOffset = offset + 8 + chunkLength + 4;
    if (nextOffset <= offset || nextOffset > buffer.length) return false;
    offset = nextOffset;
  }
  return false;
}

function isBmp(buffer: Buffer): boolean {
  if (buffer.length < 26) return false;
  const declaredFileSize = readUint32LE(buffer, 2);
  const pixelDataOffset = readUint32LE(buffer, 10);
  const dibHeaderSize = readUint32LE(buffer, 14);
  if (declaredFileSize !== 0 && declaredFileSize < 26) return false;
  if (pixelDataOffset < 14 + dibHeaderSize) return false;
  if (declaredFileSize !== 0 && pixelDataOffset >= declaredFileSize) return false;
  let colorPlanes: number;
  let bitsPerPixel: number;
  if (dibHeaderSize === 12) {
    colorPlanes = readUint16LE(buffer, 22);
    bitsPerPixel = readUint16LE(buffer, 24);
  } else if (dibHeaderSize >= 40 && dibHeaderSize <= 124) {
    if (buffer.length < 30) return false;
    colorPlanes = readUint16LE(buffer, 26);
    bitsPerPixel = readUint16LE(buffer, 28);
  } else {
    return false;
  }
  return colorPlanes === 1 && [1, 4, 8, 16, 24, 32].includes(bitsPerPixel);
}

function readUint16LE(buffer: Buffer, offset: number): number {
  return (buffer[offset] ?? 0) + ((buffer[offset + 1] ?? 0) << 8);
}
function readUint32BE(buffer: Buffer, offset: number): number {
  return (
    (buffer[offset] ?? 0) * 0x1000000 +
    ((buffer[offset + 1] ?? 0) << 16) +
    ((buffer[offset + 2] ?? 0) << 8) +
    (buffer[offset + 3] ?? 0)
  );
}
function readUint32LE(buffer: Buffer, offset: number): number {
  return (
    (buffer[offset] ?? 0) +
    ((buffer[offset + 1] ?? 0) << 8) +
    ((buffer[offset + 2] ?? 0) << 16) +
    (buffer[offset + 3] ?? 0) * 0x1000000
  );
}
function startsWith(buffer: Buffer, bytes: readonly number[]): boolean {
  if (buffer.length < bytes.length) return false;
  return bytes.every((byte, index) => buffer[index] === byte);
}
function startsWithAscii(buffer: Buffer, offset: number, text: string): boolean {
  if (buffer.length < offset + text.length) return false;
  for (let index = 0; index < text.length; index++) {
    if (buffer[offset + index] !== text.charCodeAt(index)) return false;
  }
  return true;
}

// --- read tool ---

/** Default maximum image file size before read/transform (10 MB). */
export { DEFAULT_MAX_IMAGE_BYTES } from "./limits.js";

/** Input passed to an optional host-owned image transformer. */
export interface TransformImageInput {
  readonly buffer: Buffer;
  readonly mimeType: string;
}

/** Host callback to resize or re-encode an image before base64 encoding. */
export type TransformImage = (input: TransformImageInput) => Promise<Buffer>;

/**
 * Pluggable operations for the read tool. Override to delegate file reading to remote systems
 * (e.g. SSH) while keeping the tool's truncation/offset/limit behavior.
 */
export interface ReadTextOptions {
  readonly offset: number;
  readonly limit?: number;
  readonly maxLines: number;
  readonly maxBytes: number;
  readonly maxScanBytes: number;
  readonly signal?: AbortSignal;
}

export interface ReadTextResult {
  readonly content: string;
  readonly startLine: number;
  readonly outputLines: number;
  readonly hasMore: boolean;
  readonly nextOffset?: number;
  readonly truncatedBy: "lines" | "bytes" | null;
  readonly firstLineExceedsLimit: boolean;
  readonly scannedBytes: number;
  readonly totalLines?: number;
  readonly totalBytes?: number;
}

export interface ReadOperations {
  /** Read a bounded binary file. Backends must honor `maxBytes` before retaining more data. */
  readFile: (absolutePath: string, options: { maxBytes: number; signal?: AbortSignal }) => Promise<Buffer>;
  /** Read one bounded text page. Required so remote backends cannot fall back to a full-file read. */
  readText: (absolutePath: string, options: ReadTextOptions) => Promise<ReadTextResult>;
  /** Check the file is readable (throw if not). */
  access: (absolutePath: string, options?: { signal?: AbortSignal }) => Promise<void>;
  /** Return file size in bytes for image bound checks. */
  statFile: (absolutePath: string, options?: { signal?: AbortSignal }) => Promise<{ size: number }>;
  /** Detect image MIME type from the file; return null/undefined for non-images. */
  detectImageMimeType?: (absolutePath: string) => Promise<string | null | undefined>;
}

export interface ReadToolOptions {
  /** Structured pre-execution policy checked before filesystem access. */
  executionPolicy?: ExecutionPolicy;
  /**
   * @deprecated Use `transformImage` instead. When `transformImage` is absent this flag is ignored.
   * When both are set, `transformImage` runs and `image.resized` is `true` on success.
   */
  autoResizeImages?: boolean;
  /** Reject image reads larger than this many bytes (default {@link DEFAULT_MAX_IMAGE_BYTES}). */
  maxImageBytes?: number;
  /** Maximum raw bytes scanned to reach one text page (default 64 MiB). */
  maxScanBytes?: number;
  /** Optional host callback to resize or re-encode images before base64 encoding. */
  transformImage?: TransformImage;
  /** Custom operations backend (default: local filesystem). */
  operations?: ReadOperations;
  /** Max lines kept from the head (default 2000). */
  maxLines?: number;
  /** Max bytes kept from the head (default 50KB). */
  maxBytes?: number;
}

async function readLocalTextPage(
  path: string,
  options: ReadTextOptions,
): Promise<ReadTextResult> {
  const handle = await open(path, "r");
  let fileSize: number;
  try {
    fileSize = (await handle.stat()).size;
  } catch (error) {
    await handle.close();
    throw error;
  }
  const chunks: Buffer[] = [];
  let retainedBytes = 0;
  let outputLines = 0;
  let lineNumber = 1;
  let scannedBytes = 0;
  let lineChunkStart = 0;
  let lineByteStart = 0;
  const targetLines = options.limit ?? options.maxLines;

  const content = (trimFinalLf: boolean): string => {
    const buffer = Buffer.concat(chunks, retainedBytes);
    const end = trimFinalLf && buffer[buffer.length - 1] === 0x0a ? buffer.length - 1 : buffer.length;
    return buffer.subarray(0, end).toString("utf-8");
  };
  const partial = (
    truncatedBy: "lines" | "bytes" | null,
    nextOffset: number,
    firstLineExceedsLimit = false,
    totalLines?: number,
  ): ReadTextResult => ({
    content: firstLineExceedsLimit ? "" : content(true),
    startLine: options.offset,
    outputLines,
    hasMore: true,
    nextOffset,
    truncatedBy,
    firstLineExceedsLimit,
    scannedBytes,
    totalLines,
    totalBytes: fileSize,
  });

  try {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    while (true) {
      if (options.signal?.aborted) throw new Error("Operation aborted");
      if (scannedBytes >= options.maxScanBytes) {
        if (scannedBytes >= fileSize) break;
        throw new Error(`Text read exceeded ${formatSize(options.maxScanBytes)} scan limit before reaching the requested page`);
      }
      const length = Math.min(buffer.length, options.maxScanBytes - scannedBytes);
      const { bytesRead } = await handle.read(buffer, 0, length, null);
      if (bytesRead === 0) break;
      scannedBytes += bytesRead;

      let cursor = 0;
      while (cursor < bytesRead) {
        const newline = buffer.indexOf(0x0a, cursor);
        const end = newline === -1 || newline >= bytesRead ? bytesRead : newline + 1;
        const selected = lineNumber >= options.offset && outputLines < targetLines;
        if (selected) {
          const piece = buffer.subarray(cursor, end);
          if (retainedBytes + piece.length > options.maxBytes) {
            chunks.length = lineChunkStart;
            retainedBytes = lineByteStart;
            return partial("bytes", lineNumber, outputLines === 0);
          }
          chunks.push(Buffer.from(piece));
          retainedBytes += piece.length;
        }
        cursor = end;
        if (newline === -1 || newline >= bytesRead) break;

        if (selected) {
          outputLines++;
          if (outputLines >= targetLines) {
            let totalLines: number | undefined;
            if (scannedBytes === fileSize) {
              let remainingNewlines = 0;
              for (let index = cursor; index < bytesRead; index++) {
                if (buffer[index] === 0x0a) remainingNewlines++;
              }
              totalLines = lineNumber + remainingNewlines + 1;
            }
            return partial(options.limit === undefined ? "lines" : null, lineNumber + 1, false, totalLines);
          }
        }
        lineNumber++;
        lineChunkStart = chunks.length;
        lineByteStart = retainedBytes;
      }
    }

    if (lineNumber < options.offset) {
      throw new Error(`Offset ${options.offset} is beyond end of file (${lineNumber} lines total)`);
    }
    if (lineNumber >= options.offset && outputLines < targetLines) outputLines++;
    return {
      content: content(false),
      startLine: options.offset,
      outputLines,
      hasMore: false,
      truncatedBy: null,
      firstLineExceedsLimit: false,
      scannedBytes,
      totalLines: lineNumber,
      totalBytes: scannedBytes,
    };
  } finally {
    await handle.close();
  }
}

const defaultReadOperations: ReadOperations = {
  readFile: (path, options) => readFileBounded(path, options.maxBytes, options.signal),
  readText: readLocalTextPage,
  access: (path) => fsAccess(path, constants.R_OK),
  statFile: async (path) => {
    const info = await fsStat(path);
    return { size: info.size };
  },
  detectImageMimeType: detectSupportedImageMimeTypeFromFile,
};

function imageSizeError(actualBytes: number, maxImageBytes: number): string {
  return `Image file is ${formatSize(actualBytes)}, exceeds ${formatSize(maxImageBytes)} limit.`;
}

async function loadImageBuffer(
  absolutePath: string,
  mimeType: string,
  ops: ReadOperations,
  options: {
    maxImageBytes: number;
    transformImage?: TransformImage;
    autoResizeImages?: boolean;
    signal?: AbortSignal;
  },
): Promise<{ buffer: Buffer; resized: boolean }> {
  if (options.signal?.aborted) {
    throw new Error("Operation aborted");
  }

  const { size } = await ops.statFile(absolutePath, { signal: options.signal });
  if (size > options.maxImageBytes) {
    throw new Error(imageSizeError(size, options.maxImageBytes));
  }

  let buffer = await ops.readFile(absolutePath, {
    maxBytes: options.maxImageBytes,
    signal: options.signal,
  });
  if (buffer.length > options.maxImageBytes) {
    throw new Error(imageSizeError(buffer.length, options.maxImageBytes));
  }

  let resized = false;
  if (options.transformImage) {
    if (options.signal?.aborted) {
      throw new Error("Operation aborted");
    }
    buffer = await options.transformImage({ buffer, mimeType });
    resized = true;
    if (buffer.length > options.maxImageBytes) {
      throw new Error(
        `Transformed image is ${formatSize(buffer.length)}, exceeds ${formatSize(options.maxImageBytes)} limit.`,
      );
    }
  } else if (options.autoResizeImages) {
    // Deprecated flag without a transformer — intentionally ignored for backward compatibility.
  }

  return { buffer, resized };
}

function errorResult(toolCallId: string, message: string): ToolResult {
  return {
    toolCallId,
    name: "read",
    content: [{ type: "text", text: message }],
    error: { message },
  };
}

export function createReadTool(cwd: string, options?: ReadToolOptions): ToolDefinition {
  const ops = options?.operations ?? defaultReadOperations;
  const maxLines = validateCodingLimit("maxLines", options?.maxLines ?? DEFAULT_MAX_LINES, HARD_MAX_LINES);
  const maxBytes = validateCodingLimit("maxBytes", options?.maxBytes ?? DEFAULT_MAX_BYTES, HARD_MAX_BYTES);
  const maxImageBytes = validateCodingLimit(
    "maxImageBytes",
    options?.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES,
    HARD_MAX_IMAGE_BYTES,
  );
  const maxScanBytes = validateCodingLimit(
    "maxScanBytes",
    options?.maxScanBytes ?? DEFAULT_MAX_TEXT_SCAN_BYTES,
    HARD_MAX_TEXT_SCAN_BYTES,
  );

  return {
    name: "read",
    description: `Read the contents of a file. Supports text files and images (jpg, png, gif, webp, bmp); images are returned as image content. For text files, output is truncated to ${maxLines} lines or ${maxBytes / 1024}KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.`,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to read (relative or absolute)" },
        offset: { type: "number", description: "Line number to start reading from (1-indexed)" },
        limit: { type: "number", description: "Maximum number of lines to read" },
      },
      required: ["path"],
      additionalProperties: false,
    } as JsonObject,
    async execute(args, context: ToolExecutionContext): Promise<ToolResult> {
      const toolCallId = context.toolCallId;

      if (context.signal?.aborted) {
        return errorResult(toolCallId, "Operation aborted");
      }

      const path = typeof args.path === "string" ? args.path : "";
      const offset = typeof args.offset === "number" ? args.offset : undefined;
      const limit = typeof args.limit === "number" ? args.limit : undefined;

      if (path.length === 0) {
        return errorResult(toolCallId, "path is required and must be a non-empty string.");
      }

      try {
        const startLine = validateCodingLimit("offset", offset ?? 1, Number.MAX_SAFE_INTEGER);
        const requestedLines = limit === undefined
          ? undefined
          : validateCodingLimit("limit", limit, HARD_MAX_LINES);
        const absolutePath = await resolveReadPathAsync(path, cwd);

        const policyCheck = await enforceExecutionPolicy(
          options?.executionPolicy,
          {
            kind: "read",
            operation: "read",
            paths: [absolutePath],
            risk: "low",
            metadata: { offset, limit, sessionId: context.sessionId, runId: context.runId, signal: context.signal },
          },
          toolCallId,
          "read",
        );
        if (!policyCheck.allowed) return policyCheck.result;
        const allowedPath = policyCheck.action.paths?.[0] ?? absolutePath;

        await ops.access(allowedPath, { signal: context.signal });

        const mimeType = ops.detectImageMimeType ? await ops.detectImageMimeType(allowedPath) : undefined;

        if (mimeType) {
          const { buffer, resized } = await loadImageBuffer(allowedPath, mimeType, ops, {
            maxImageBytes,
            transformImage: options?.transformImage,
            autoResizeImages: options?.autoResizeImages,
            signal: context.signal,
          });
          return {
            toolCallId,
            name: "read",
            content: [
              { type: "text", text: `Read image file [${mimeType}]` },
              { type: "image", data: buffer.toString("base64"), mimeType },
            ],
            metadata: { image: { mimeType, resized, bytes: buffer.length } },
          };
        }

        const page = await ops.readText(allowedPath, {
          offset: startLine,
          limit: requestedLines,
          maxLines,
          maxBytes,
          maxScanBytes,
          signal: context.signal,
        });
        const contentBytes = Buffer.byteLength(page.content, "utf-8");
        if (contentBytes > maxBytes || page.outputLines > (requestedLines ?? maxLines)) {
          throw new Error("ReadOperations.readText returned data beyond the requested bounds");
        }
        const totalLines = page.totalLines ?? page.startLine + page.outputLines + (page.hasMore ? 1 : 0) - 1;
        const truncation: TruncationResult = {
          content: page.content,
          truncated: page.truncatedBy !== null,
          truncatedBy: page.truncatedBy,
          totalLines,
          totalBytes: page.totalBytes ?? page.scannedBytes,
          outputLines: page.outputLines,
          outputBytes: contentBytes,
          lastLinePartial: false,
          firstLineExceedsLimit: page.firstLineExceedsLimit,
          maxLines,
          maxBytes,
          totalLinesKnown: page.totalLines !== undefined,
          totalBytesKnown: page.totalBytes !== undefined,
        };
        let outputText = page.content;
        if (page.firstLineExceedsLimit) {
          outputText = `[Line ${page.startLine} exceeds ${formatSize(maxBytes)} limit. Use the shell tool: sed -n '${page.startLine}p' ${path} | head -c ${maxBytes}]`;
        } else if (page.hasMore && page.nextOffset !== undefined) {
          const endLine = page.startLine + page.outputLines - 1;
          if (page.totalLines !== undefined) {
            const remaining = page.totalLines - endLine;
            outputText += page.truncatedBy
              ? `\n\n[Showing lines ${page.startLine}-${endLine} of ${page.totalLines}${page.truncatedBy === "bytes" ? ` (${formatSize(maxBytes)} limit)` : ""}. Use offset=${page.nextOffset} to continue.]`
              : `\n\n[${remaining} more lines in file. Use offset=${page.nextOffset} to continue.]`;
          } else {
            outputText += `\n\n[Showing lines ${page.startLine}-${endLine}${page.truncatedBy === "bytes" ? ` (${formatSize(maxBytes)} limit)` : ""}. Use offset=${page.nextOffset} to continue.]`;
          }
        }

        return {
          toolCallId,
          name: "read",
          content: [{ type: "text", text: outputText }],
          metadata: { truncation, scannedBytes: page.scannedBytes },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResult(toolCallId, message);
      }
    },
  };
}

/** Re-exported for hosts building custom read tools or analyzing truncation metadata. */
export type { TruncationResult };
