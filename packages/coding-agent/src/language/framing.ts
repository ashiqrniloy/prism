/**
 * LSP 3.17 Content-Length framing over stdio (JSON-RPC body).
 * No vscode-languageserver-protocol dependency.
 */

export type LspFrameErrorCode = "ERR_PRISM_LSP_FRAMING" | "ERR_PRISM_LSP_LIMIT";

export class LspFrameError extends Error {
  readonly code: LspFrameErrorCode;
  constructor(code: LspFrameErrorCode, message: string) {
    super(message);
    this.name = "LspFrameError";
    this.code = code;
  }
}

/** Encode one JSON-RPC message as an LSP frame. */
export function encodeLspFrame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = `Content-Length: ${body.length}\r\n\r\n`;
  return Buffer.concat([Buffer.from(header, "ascii"), body]);
}

/**
 * Incremental Content-Length frame reader.
 * Rejects malformed headers, non-decimal Content-Length, and oversized bodies.
 */
export class LspFrameReader {
  // ponytail: chunk-array accumulator — O(1) append per push, no whole-buffer re-concat
  // (the 0.2.4 `this.buf = Buffer.concat([this.buf, chunk])` was O(input * chunks)).
  // A completed frame copies only its header+body region (bounded by maxMessageBytes),
  // so total copying is O(input). The header separator scan peeks min(retained, 64KiB)
  // per unparsed frame; for the rare many-frames-per-large-chunk case that is a 64KiB-
  // per-frame copy (linear, 64x constant) — upgrade to a streaming separator search
  // if pipelined-frame throughput matters. A separator beyond the 64KiB header bound
  // is rejected (stricter DoS guard than 0.2.4, which accepted it; no test exercises
  // >64KiB headers — the bound exists precisely to reject unbounded header growth).
  private chunks: Buffer[] = [];
  private offset = 0; // consumed prefix bytes in chunks[0]
  private retained = 0; // total unconsumed bytes
  private cachedBodyStart = -1; // -1 = header not yet parsed; else body starts at this absolute unconsumed offset
  private cachedContentLength = 0;
  private readonly maxMessageBytes: number;

  constructor(maxMessageBytes: number) {
    this.maxMessageBytes = maxMessageBytes;
  }

  /** Push stdout/stderr chunk; return complete parsed JSON values (order preserved). */
  push(chunk: Buffer): unknown[] {
    if (chunk.length === 0) return [];
    this.chunks.push(chunk);
    this.retained += chunk.length;
    const out: unknown[] = [];
    for (;;) {
      const parsed = this.tryParseOne();
      if (parsed === undefined) break;
      out.push(parsed);
    }
    return out;
  }

  /** Copy `n` unconsumed bytes starting at absolute unconsumed offset `start` (no advance). */
  private peekAt(start: number, n: number): Buffer {
    const out = Buffer.allocUnsafe(n);
    let written = 0;
    let i = 0;
    let off = this.offset;
    let skip = start;
    while (skip > 0) {
      const c = this.chunks[i]!;
      const avail = c.length - off;
      if (skip >= avail) {
        skip -= avail;
        i++;
        off = 0;
      } else {
        off += skip;
        skip = 0;
      }
    }
    while (written < n) {
      const c = this.chunks[i]!;
      const take = Math.min(c.length - off, n - written);
      c.copy(out, written, off, off + take);
      written += take;
      i++;
      off = 0;
    }
    return out;
  }

  /** Advance the unconsumed cursor by `n` (drop fully-consumed chunks). */
  private drop(n: number): void {
    let remaining = n;
    while (remaining > 0 && this.chunks.length > 0) {
      const first = this.chunks[0]!;
      const avail = first.length - this.offset;
      if (remaining >= avail) {
        remaining -= avail;
        this.chunks.shift();
        this.offset = 0;
      } else {
        this.offset += remaining;
        remaining = 0;
      }
    }
    this.retained -= n;
  }

  private tryParseOne(): unknown | undefined {
    if (this.retained === 0) return undefined;
    const headerBound = Math.min(this.maxMessageBytes, 64 * 1024);

    if (this.cachedBodyStart < 0) {
      // Bound header scan buffer so a missing separator cannot grow forever.
      const scanLen = Math.min(this.retained, headerBound);
      const view = this.peekAt(0, scanLen);
      const sep = indexOfHeaderSep(view);
      if (sep < 0) {
        if (this.retained > headerBound) {
          throw new LspFrameError("ERR_PRISM_LSP_FRAMING", "LSP header exceeds bound without separator");
        }
        return undefined;
      }
      const headerText = view.subarray(0, sep).toString("ascii");
      const contentLength = parseContentLength(headerText);
      if (contentLength > this.maxMessageBytes) {
        throw new LspFrameError("ERR_PRISM_LSP_LIMIT", `LSP message body ${contentLength} exceeds maxMessageBytes ${this.maxMessageBytes}`);
      }
      this.cachedBodyStart = sep + 4;
      this.cachedContentLength = contentLength;
    }

    const bodyEnd = this.cachedBodyStart + this.cachedContentLength;
    if (this.retained < bodyEnd) return undefined;

    const body = this.peekAt(this.cachedBodyStart, this.cachedContentLength);
    this.drop(bodyEnd);
    this.cachedBodyStart = -1;
    this.cachedContentLength = 0;
    let value: unknown;
    try {
      value = JSON.parse(body.toString("utf8"));
    } catch {
      throw new LspFrameError("ERR_PRISM_LSP_FRAMING", "LSP message body is not valid JSON");
    }
    return value;
  }
}

function indexOfHeaderSep(buf: Buffer): number {
  for (let i = 0; i + 3 < buf.length; i++) {
    if (buf[i] === 0x0d && buf[i + 1] === 0x0a && buf[i + 2] === 0x0d && buf[i + 3] === 0x0a) {
      return i;
    }
  }
  return -1;
}

function parseContentLength(headerText: string): number {
  const lines = headerText.split("\r\n");
  let contentLength: number | undefined;
  for (const line of lines) {
    if (line.length === 0) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) {
      throw new LspFrameError("ERR_PRISM_LSP_FRAMING", `Malformed LSP header line: ${line}`);
    }
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (name === "content-length") {
      if (!/^\d+$/.test(value)) {
        throw new LspFrameError("ERR_PRISM_LSP_FRAMING", `Invalid Content-Length: ${value}`);
      }
      if (contentLength !== undefined) {
        throw new LspFrameError("ERR_PRISM_LSP_FRAMING", "Duplicate Content-Length header");
      }
      contentLength = Number(value);
      if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
        throw new LspFrameError("ERR_PRISM_LSP_FRAMING", `Invalid Content-Length: ${value}`);
      }
    }
    // Content-Type and other headers ignored; reject CR/LF injection already split by lines.
  }
  if (contentLength === undefined) {
    throw new LspFrameError("ERR_PRISM_LSP_FRAMING", "Missing Content-Length header");
  }
  return contentLength;
}
