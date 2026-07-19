/** Streaming UTF-8 output retention with bounded memory and spill storage. */
import { randomBytes } from "node:crypto";
import { closeSync, openSync, writeSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  DEFAULT_MAX_TOTAL_OUTPUT_BYTES,
  HARD_MAX_BYTES,
  HARD_MAX_LINES,
  HARD_MAX_TOTAL_OUTPUT_BYTES,
  validateCodingLimit,
} from "./limits.js";
import { truncateTail, type TruncationResult } from "./truncate.js";

export interface OutputAccumulatorOptions {
  maxLines?: number;
  maxBytes?: number;
  maxTotalOutputBytes?: number;
  tempFilePrefix?: string;
  onLimit?: () => void;
  onStorageError?: () => void;
}

export interface OutputSnapshot {
  content: string;
  truncation: TruncationResult;
  fullOutputPath?: string;
}

function defaultTempFilePath(prefix: string): string {
  return join(tmpdir(), `${prefix}-${randomBytes(16).toString("hex")}.log`);
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf-8");
}

export class OutputAccumulator {
  private readonly maxLines: number;
  private readonly maxBytes: number;
  private readonly maxTotalOutputBytes: number;
  private readonly maxRollingBytes: number;
  private readonly tempFilePrefix: string;
  private readonly onLimit?: () => void;
  private readonly onStorageError?: () => void;
  private readonly decoder = new TextDecoder();
  private rawChunks: Buffer[] = [];
  private tailText = "";
  private tailBytes = 0;
  private tailStartsAtLineBoundary = true;
  private totalRawBytes = 0;
  private totalDecodedBytes = 0;
  private completedLines = 0;
  private totalLines = 0;
  private currentLineBytes = 0;
  private hasOpenLine = false;
  private finished = false;
  private exceeded = false;
  private tempFilePath?: string;
  private tempFileFd?: number;
  private tempFileError?: Error;

  constructor(options: OutputAccumulatorOptions = {}) {
    this.maxLines = validateCodingLimit("maxLines", options.maxLines ?? DEFAULT_MAX_LINES, HARD_MAX_LINES);
    this.maxBytes = validateCodingLimit("maxBytes", options.maxBytes ?? DEFAULT_MAX_BYTES, HARD_MAX_BYTES);
    this.maxTotalOutputBytes = validateCodingLimit(
      "maxTotalOutputBytes",
      options.maxTotalOutputBytes ?? DEFAULT_MAX_TOTAL_OUTPUT_BYTES,
      HARD_MAX_TOTAL_OUTPUT_BYTES,
    );
    if (this.maxTotalOutputBytes < this.maxBytes) {
      throw new Error("maxTotalOutputBytes must be at least maxBytes");
    }
    this.maxRollingBytes = this.maxBytes * 2;
    this.tempFilePrefix = options.tempFilePrefix ?? "prism-output";
    if (!/^[A-Za-z0-9._-]+$/.test(this.tempFilePrefix)) {
      throw new Error("tempFilePrefix may contain only letters, numbers, dot, underscore, and hyphen");
    }
    this.onLimit = options.onLimit;
    this.onStorageError = options.onStorageError;
  }

  append(data: Buffer): boolean {
    if (this.finished) throw new Error("Cannot append to a finished output accumulator");
    const remaining = this.maxTotalOutputBytes - this.totalRawBytes;
    const accepted = remaining > 0 ? data.subarray(0, remaining) : data.subarray(0, 0);
    if (accepted.length > 0) {
      this.totalRawBytes += accepted.length;
      this.appendDecodedText(this.decoder.decode(accepted, { stream: true }));
      if (this.tempFileFd !== undefined || this.shouldUseTempFile()) {
        this.ensureTempFile();
        this.writeTemp(accepted);
      } else {
        this.rawChunks.push(Buffer.from(accepted));
      }
    }
    if (accepted.length !== data.length && !this.exceeded) {
      this.exceeded = true;
      this.onLimit?.();
    }
    return !this.exceeded;
  }

  finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.appendDecodedText(this.decoder.decode());
    if (this.shouldUseTempFile()) this.ensureTempFile();
  }

  snapshot(options: { persistIfTruncated?: boolean } = {}): OutputSnapshot {
    const tailTruncation = truncateTail(this.getSnapshotText(), {
      maxLines: this.maxLines,
      maxBytes: this.maxBytes,
    });
    const truncated = this.totalLines > this.maxLines || this.totalDecodedBytes > this.maxBytes || this.exceeded;
    const truncation: TruncationResult = {
      ...tailTruncation,
      truncated,
      truncatedBy: truncated
        ? (tailTruncation.truncatedBy ?? (this.totalDecodedBytes > this.maxBytes || this.exceeded ? "bytes" : "lines"))
        : null,
      totalLines: this.totalLines,
      totalLinesKnown: true,
      totalBytes: this.totalDecodedBytes,
      totalBytesKnown: !this.exceeded,
      maxLines: this.maxLines,
      maxBytes: this.maxBytes,
    };
    if (options.persistIfTruncated && truncation.truncated) this.ensureTempFile();
    return {
      content: truncation.content,
      truncation,
      fullOutputPath: this.tempFileError ? undefined : this.tempFilePath,
    };
  }

  async closeTempFile(): Promise<void> {
    if (this.tempFileFd !== undefined) {
      const fd = this.tempFileFd;
      this.tempFileFd = undefined;
      try {
        closeSync(fd);
      } catch (error) {
        this.recordTempError(error);
      }
    }
    if (this.tempFileError) throw this.tempFileError;
  }

  async cleanupTempFile(): Promise<void> {
    const path = this.tempFilePath;
    let closeError: unknown;
    try {
      await this.closeTempFile();
    } catch (error) {
      closeError = error;
    }
    this.tempFilePath = undefined;
    this.tempFileError = undefined;
    if (path) await rm(path, { force: true });
    if (closeError) throw closeError;
  }

  getLastLineBytes(): number {
    return this.currentLineBytes;
  }

  getTotalRawBytes(): number {
    return this.totalRawBytes;
  }

  isOutputLimitExceeded(): boolean {
    return this.exceeded;
  }

  hasStorageError(): boolean {
    return this.tempFileError !== undefined;
  }

  private appendDecodedText(text: string): void {
    if (text.length === 0) return;
    const bytes = byteLength(text);
    this.totalDecodedBytes += bytes;
    this.tailText += text;
    this.tailBytes += bytes;
    if (this.tailBytes > this.maxRollingBytes * 2) this.trimTail();
    let newlines = 0;
    let lastNewline = -1;
    for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) {
      newlines++;
      lastNewline = i;
    }
    if (newlines === 0) {
      this.currentLineBytes += bytes;
      this.hasOpenLine = true;
    } else {
      this.completedLines += newlines;
      const tail = text.slice(lastNewline + 1);
      this.currentLineBytes = byteLength(tail);
      this.hasOpenLine = tail.length > 0;
    }
    this.totalLines = this.completedLines + (this.hasOpenLine ? 1 : 0);
  }

  private trimTail(): void {
    const buffer = Buffer.from(this.tailText, "utf-8");
    if (buffer.length <= this.maxRollingBytes) {
      this.tailBytes = buffer.length;
      return;
    }
    let start = buffer.length - this.maxRollingBytes;
    while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) start++;
    this.tailStartsAtLineBoundary = start === 0 ? this.tailStartsAtLineBoundary : buffer[start - 1] === 0x0a;
    this.tailText = buffer.subarray(start).toString("utf-8");
    this.tailBytes = byteLength(this.tailText);
  }

  private getSnapshotText(): string {
    if (this.tailStartsAtLineBoundary) return this.tailText;
    const firstNewline = this.tailText.indexOf("\n");
    return firstNewline === -1 ? this.tailText : this.tailText.slice(firstNewline + 1);
  }

  private shouldUseTempFile(): boolean {
    return this.totalRawBytes > this.maxBytes || this.totalDecodedBytes > this.maxBytes || this.totalLines > this.maxLines;
  }

  private ensureTempFile(): void {
    if (this.tempFilePath || this.tempFileError) return;
    const path = defaultTempFilePath(this.tempFilePrefix);
    try {
      this.tempFileFd = openSync(path, "wx", 0o600);
      this.tempFilePath = path;
      for (const chunk of this.rawChunks) this.writeTemp(chunk);
    } catch (error) {
      this.recordTempError(error);
    } finally {
      this.rawChunks = [];
    }
  }

  private writeTemp(data: Buffer): void {
    // ponytail: synchronous spill is zero-queue backpressure; use a bounded async writer only if measured throughput requires it.
    if (this.tempFileFd === undefined || this.tempFileError) return;
    try {
      let offset = 0;
      while (offset < data.length) offset += writeSync(this.tempFileFd, data, offset);
    } catch (error) {
      this.recordTempError(error);
    }
  }

  private recordTempError(error: unknown): void {
    if (this.tempFileError) return;
    this.tempFileError = error instanceof Error ? error : new Error(String(error));
    this.onStorageError?.();
  }
}
