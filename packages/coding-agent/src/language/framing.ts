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
  private buf = Buffer.alloc(0);
  private readonly maxMessageBytes: number;

  constructor(maxMessageBytes: number) {
    this.maxMessageBytes = maxMessageBytes;
  }

  /** Push stdout/stderr chunk; return complete parsed JSON values (order preserved). */
  push(chunk: Buffer): unknown[] {
    if (chunk.length === 0) return [];
    this.buf = Buffer.concat([this.buf, chunk]);
    const out: unknown[] = [];
    for (;;) {
      const parsed = this.tryParseOne();
      if (parsed === undefined) break;
      out.push(parsed);
    }
    return out;
  }

  private tryParseOne(): unknown | undefined {
    const sep = indexOfHeaderSep(this.buf);
    if (sep < 0) {
      // Bound header scan buffer so a missing separator cannot grow forever.
      if (this.buf.length > Math.min(this.maxMessageBytes, 64 * 1024)) {
        throw new LspFrameError("ERR_PRISM_LSP_FRAMING", "LSP header exceeds bound without separator");
      }
      return undefined;
    }

    const headerText = this.buf.subarray(0, sep).toString("ascii");
    const contentLength = parseContentLength(headerText);
    if (contentLength > this.maxMessageBytes) {
      throw new LspFrameError("ERR_PRISM_LSP_LIMIT", `LSP message body ${contentLength} exceeds maxMessageBytes ${this.maxMessageBytes}`);
    }

    const bodyStart = sep + 4;
    const bodyEnd = bodyStart + contentLength;
    if (this.buf.length < bodyEnd) return undefined;

    const body = this.buf.subarray(bodyStart, bodyEnd);
    this.buf = this.buf.subarray(bodyEnd);

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
