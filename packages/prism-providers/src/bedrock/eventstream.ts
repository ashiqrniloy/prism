/**
 * Bounded decoder for `application/vnd.amazon.eventstream` framing (the wire format
 * Bedrock `ConverseStream` responds with).
 *
 * Package-local by design: the current dependency-free Bedrock route signs with a
 * package-local SigV4 instead of the AWS SDK, and the framing spec is frozen (Smithy
 * `amazon-eventstream`): prelude, typed headers, payload, and two CRC32 checks.
 * Frame and header lengths are validated against the spec ceilings and both CRCs are
 * verified, so a corrupt or oversized stream terminates instead of resyncing into
 * model-visible garbage.
 */

const PRELUDE_BYTES = 12;
const FRAME_CRC_BYTES = 4;
const MIN_FRAME_BYTES = PRELUDE_BYTES + FRAME_CRC_BYTES;
const HARD_MAX_HEADERS_BYTES = 128 * 1024;
/** Spec payload ceiling (24 MiB) plus framing overhead. */
export const HARD_MAX_FRAME_BYTES = 25_165_824;
/** ConverseStream frames are single deltas; 1 MiB is a bounded default, not a protocol limit. */
export const DEFAULT_MAX_FRAME_BYTES = 1_048_576;

export type AwsEventStreamHeaderValue = string | number | boolean | Uint8Array;

export interface AwsEventStreamMessage {
  readonly headers: Readonly<Record<string, AwsEventStreamHeaderValue>>;
  readonly payload: Uint8Array;
}

export type AwsEventStreamErrorCode = "frame_overflow" | "bad_frame" | "crc_mismatch" | "bad_headers" | "truncated" | "aborted";

export class AwsEventStreamError extends Error {
  readonly code: AwsEventStreamErrorCode;

  constructor(code: AwsEventStreamErrorCode, message: string) {
    super(message);
    this.name = "AwsEventStreamError";
    this.code = code;
  }
}

let crcTable: Uint32Array | undefined;

function crc32Table(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  crcTable = table;
  return table;
}

/** Standard CRC32 (GZIP polynomial) used by both frame checksums. */
export function crc32(bytes: Uint8Array): number {
  const table = crc32Table();
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    crc = (crc >>> 8) ^ table[(crc ^ bytes[index]!) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toUint8Array(chunk: Uint8Array | ArrayBufferView): Uint8Array {
  return chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.byteLength === 0) return right;
  const merged = new Uint8Array(left.byteLength + right.byteLength);
  merged.set(left, 0);
  merged.set(right, left.byteLength);
  return merged;
}

function headerValue(bytes: Uint8Array, type: number): AwsEventStreamHeaderValue | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  switch (type) {
    case 0:
    case 1:
      return type === 0;
    case 2:
      return view.getInt8(0);
    case 3:
      return view.getInt16(0);
    case 4:
      return view.getInt32(0);
    case 5:
    case 8:
      return Number(view.getBigInt64(0));
    case 6:
    case 9:
      return bytes.slice();
    case 7:
      return new TextDecoder().decode(bytes);
    default:
      // The spec's type set is closed; an unknown indicator means a corrupt frame.
      return undefined;
  }
}

function decodeHeaders(bytes: Uint8Array): Record<string, AwsEventStreamHeaderValue> {
  const headers: Record<string, AwsEventStreamHeaderValue> = {};
  let offset = 0;
  while (offset < bytes.byteLength) {
    const nameLength = bytes[offset]!;
    offset += 1;
    if (nameLength === 0 || offset + nameLength + 3 > bytes.byteLength) {
      throw new AwsEventStreamError("bad_headers", "Event stream header name is empty or truncated");
    }
    const name = new TextDecoder().decode(bytes.subarray(offset, offset + nameLength));
    offset += nameLength;
    const type = bytes[offset]!;
    offset += 1;
    const valueLength = (bytes[offset]! << 8) | bytes[offset + 1]!;
    offset += 2;
    if (offset + valueLength > bytes.byteLength) {
      throw new AwsEventStreamError("bad_headers", `Event stream header ${name} exceeded the headers section`);
    }
    const value = headerValue(bytes.subarray(offset, offset + valueLength), type);
    if (value === undefined) {
      throw new AwsEventStreamError("bad_headers", `Event stream header ${name} used unsupported type ${type}`);
    }
    offset += valueLength;
    headers[name] = value;
  }
  return headers;
}

/** Read a string header (e.g. `:event-type`); non-string values are treated as absent. */
export function eventStreamHeader(message: AwsEventStreamMessage, name: string): string | undefined {
  const value = message.headers[name];
  return typeof value === "string" ? value : undefined;
}

export interface ReadAwsEventStreamOptions {
  readonly signal?: AbortSignal;
  /** Per-frame byte ceiling; clamped to {@link HARD_MAX_FRAME_BYTES}. Default 1 MiB. */
  readonly maxFrameBytes?: number;
}

/**
 * Decode an AWS event stream into framed messages. Frames are only emitted once
 * complete, so a partial tail is a hard error rather than a silent short read.
 */
export async function* readAwsEventStream(
  body: ReadableStream<Uint8Array>,
  options?: ReadAwsEventStreamOptions,
): AsyncGenerator<AwsEventStreamMessage> {
  const maxFrameBytes = options?.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
  if (maxFrameBytes < MIN_FRAME_BYTES || maxFrameBytes > HARD_MAX_FRAME_BYTES) {
    throw new AwsEventStreamError(
      "frame_overflow",
      `Event stream frame cap ${maxFrameBytes} is outside ${MIN_FRAME_BYTES}..${HARD_MAX_FRAME_BYTES}`,
    );
  }
  const reader = body.getReader();
  let buffered: Uint8Array = new Uint8Array(0);
  try {
    while (true) {
      if (options?.signal?.aborted) throw new AwsEventStreamError("aborted", "Event stream aborted");
      const { done, value } = await reader.read();
      if (done) break;
      buffered = concat(buffered, toUint8Array(value));
      if (buffered.byteLength > maxFrameBytes) {
        throw new AwsEventStreamError("frame_overflow", `Event stream frame exceeded ${maxFrameBytes} bytes`);
      }
      let offset = 0;
      while (buffered.byteLength - offset >= PRELUDE_BYTES) {
        const view = new DataView(buffered.buffer, buffered.byteOffset + offset, buffered.byteLength - offset);
        const totalLength = view.getUint32(0);
        const headersLength = view.getUint32(4);
        if (
          totalLength < MIN_FRAME_BYTES ||
          totalLength > maxFrameBytes ||
          headersLength > HARD_MAX_HEADERS_BYTES ||
          headersLength + MIN_FRAME_BYTES > totalLength
        ) {
          throw new AwsEventStreamError(
            "bad_frame",
            `Event stream frame lengths are invalid (total ${totalLength}, headers ${headersLength})`,
          );
        }
        if (buffered.byteLength - offset < totalLength) break;
        const frame = buffered.subarray(offset, offset + totalLength);
        const frameView = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
        if (frameView.getUint32(8) !== crc32(frame.subarray(0, 8))) {
          throw new AwsEventStreamError("crc_mismatch", "Event stream prelude checksum mismatch");
        }
        if (frameView.getUint32(totalLength - FRAME_CRC_BYTES) !== crc32(frame.subarray(0, totalLength - FRAME_CRC_BYTES))) {
          throw new AwsEventStreamError("crc_mismatch", "Event stream message checksum mismatch");
        }
        const headers = decodeHeaders(frame.subarray(PRELUDE_BYTES, PRELUDE_BYTES + headersLength));
        const payload = frame.subarray(PRELUDE_BYTES + headersLength, totalLength - FRAME_CRC_BYTES).slice();
        offset += totalLength;
        yield { headers, payload };
      }
      buffered = offset === 0 ? buffered : buffered.subarray(offset).slice();
    }
    if (buffered.byteLength > 0) {
      throw new AwsEventStreamError("truncated", `Event stream ended with ${buffered.byteLength} unparsed bytes`);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // already released
    }
    try {
      await reader.cancel();
    } catch {
      // stream may already be closed
    }
  }
}
