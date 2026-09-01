/**
 * ACP text-file client adapter for the coding read/write/edit operations.
 *
 * ACP exposes text reads and writes, not stat, mkdir, binary reads, or image sniffing. This adapter
 * keeps those limits explicit: all reads go through the client, mkdir is inert, and binary/image
 * handling is unavailable rather than falling back to the host filesystem.
 */
import { Buffer } from "node:buffer";
import type { EditOperations } from "./edit.js";
import type { ReadOperations, ReadTextOptions, ReadTextResult } from "./read.js";
import type { WriteOperations } from "./write.js";

/** Duck-typed subset of the ACP client filesystem adapter. */
export interface TextFileClient {
  readTextFile(input: { path: string; line?: number; limit?: number }): Promise<{ text: string }>;
  writeTextFile(input: { path: string; content: string }): Promise<void>;
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Operation aborted");
}

async function readTextFile(
  client: TextFileClient,
  path: string,
  input?: { line?: number; limit?: number },
  signal?: AbortSignal,
): Promise<string> {
  checkAbort(signal);
  const request = input === undefined ? { path } : { path, line: input.line, limit: input.limit };
  const response = await client.readTextFile(request);
  checkAbort(signal);
  if (!response || typeof response.text !== "string") {
    throw new Error("TextFileClient.readTextFile must return { text: string }");
  }
  return response.text;
}

function splitTextLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function readPage(text: string, options: ReadTextOptions): ReadTextResult {
  const requestedLines = options.limit ?? options.maxLines;
  const lines = splitTextLines(text);
  const totalBytes = Buffer.byteLength(text, "utf8");
  if (totalBytes > options.maxScanBytes) {
    throw new Error(`Text read exceeded ${options.maxScanBytes} byte scan limit`);
  }

  const output: string[] = [];
  let outputBytes = 0;
  let truncatedBy: "lines" | "bytes" | null = null;
  let firstLineExceedsLimit = false;
  for (const line of lines) {
    if (output.length >= requestedLines) {
      truncatedBy = "lines";
      break;
    }
    const lineBytes = Buffer.byteLength(line, "utf8");
    if (output.length === 0 && lineBytes > options.maxBytes) {
      firstLineExceedsLimit = true;
      truncatedBy = "bytes";
      break;
    }
    const withSeparator = output.length === 0 ? lineBytes : lineBytes + 1;
    if (outputBytes + withSeparator > options.maxBytes) {
      truncatedBy = "bytes";
      break;
    }
    output.push(line);
    outputBytes += withSeparator;
  }

  const clientReturnedPage = lines.length >= requestedLines && requestedLines > 0;
  const hasMore = !firstLineExceedsLimit && (output.length < lines.length || clientReturnedPage);
  const nextOffset = hasMore && output.length > 0 ? options.offset + output.length : undefined;
  const totalLines = clientReturnedPage ? undefined : lines.length;
  return {
    content: firstLineExceedsLimit ? "" : output.join("\n"),
    startLine: options.offset,
    outputLines: firstLineExceedsLimit ? 0 : output.length,
    hasMore,
    nextOffset,
    truncatedBy,
    firstLineExceedsLimit,
    scannedBytes: totalBytes,
    totalLines,
    totalBytes,
  };
}

export function createAcpFilesystemOperations(client: TextFileClient): {
  read: ReadOperations;
  write: WriteOperations;
  edit: EditOperations;
} {
  const readFile = async (path: string, options: { maxBytes: number; signal?: AbortSignal }): Promise<Buffer> => {
    const text = await readTextFile(client, path, undefined, options.signal);
    const buffer = Buffer.from(text, "utf8");
    if (buffer.byteLength > options.maxBytes) {
      throw new Error(`File is ${buffer.byteLength} bytes, exceeds ${options.maxBytes} byte limit`);
    }
    return buffer;
  };
  const writeFile = async (path: string, content: string, options?: { maxBytes?: number; signal?: AbortSignal }): Promise<void> => {
    checkAbort(options?.signal);
    const bytes = Buffer.byteLength(content, "utf8");
    if (options?.maxBytes !== undefined && bytes > options.maxBytes) {
      throw new Error(`Write input is ${bytes} bytes, exceeds ${options.maxBytes} byte limit`);
    }
    await client.writeTextFile({ path, content });
  };
  const access = (path: string, options?: { signal?: AbortSignal }): Promise<void> =>
    readTextFile(client, path, { line: 1, limit: 1 }, options?.signal).then(() => undefined);
  const statFile = async (path: string, options?: { signal?: AbortSignal }): Promise<{ size: number }> => ({
    size: Buffer.byteLength(await readTextFile(client, path, undefined, options?.signal), "utf8"),
  });

  return {
    read: {
      readFile,
      readText: async (path, options) => {
        const text = await readTextFile(client, path, { line: options.offset, limit: options.limit ?? options.maxLines }, options.signal);
        return readPage(text, options);
      },
      access,
      statFile,
      detectImageMimeType: async () => null,
    },
    write: {
      writeFile,
      mkdir: async (_path, options) => {
        checkAbort(options?.signal);
      },
    },
    edit: {
      readFile,
      writeFile,
      access,
      statFile,
    },
  };
}
