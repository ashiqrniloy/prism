import type {
  AgentEventRecord,
  FlushableRunLedger,
  RunLedger,
  RunLedgerDurability,
  RunLedgerFlushResult,
  RunRecord,
  ToolCallRecord,
  UsageRecord,
} from "./contracts.js";

export const DEFAULT_LEDGER_BATCH_ENTRIES = 128;
export const HARD_LEDGER_BATCH_ENTRIES = 4096;
export const DEFAULT_LEDGER_BATCH_BYTES = 512 * 1024;
export const HARD_LEDGER_BATCH_BYTES = 8 * 1024 * 1024;
export const DEFAULT_LEDGER_BATCH_DELAY_MS = 25;
export const HARD_LEDGER_BATCH_DELAY_MS = 60_000;

export interface BatchedRunLedgerOptions {
  readonly maxBatchEntries?: number;
  readonly maxBatchBytes?: number;
  readonly maxBufferedEntries?: number;
  readonly maxBufferedBytes?: number;
  readonly maxDelayMs?: number;
  readonly durability?: RunLedgerDurability;
}

type PendingInput =
  | { readonly kind: "run"; readonly record: RunRecord }
  | { readonly kind: "event"; readonly record: AgentEventRecord }
  | { readonly kind: "tool"; readonly record: ToolCallRecord }
  | { readonly kind: "usage"; readonly record: UsageRecord };
type Pending = PendingInput & { readonly bytes: number };

function integer(value: number | undefined, fallback: number, hard: number, name: string): number {
  const selected = value ?? fallback;
  if (!Number.isInteger(selected) || selected < 1 || selected > hard) throw new RangeError(`${name} must be an integer in [1, ${hard}]`);
  return selected;
}

function terminal(record: RunRecord): boolean {
  return record.status !== undefined && record.status !== "queued" && record.status !== "running";
}

/**
 * Wrap any RunLedger with one bounded FIFO. Inputs must already be redacted, as required by RunLedger.
 * `buffered` may lose accepted records on process crash; call `flush()` for acknowledgement.
 */
export function createBatchedRunLedger(target: RunLedger, options: BatchedRunLedgerOptions = {}): FlushableRunLedger {
  const maxBatchEntries = integer(options.maxBatchEntries, DEFAULT_LEDGER_BATCH_ENTRIES, HARD_LEDGER_BATCH_ENTRIES, "maxBatchEntries");
  const maxBatchBytes = integer(options.maxBatchBytes, DEFAULT_LEDGER_BATCH_BYTES, HARD_LEDGER_BATCH_BYTES, "maxBatchBytes");
  const maxBufferedEntries = integer(options.maxBufferedEntries, Math.min(HARD_LEDGER_BATCH_ENTRIES, maxBatchEntries * 2), HARD_LEDGER_BATCH_ENTRIES, "maxBufferedEntries");
  const maxBufferedBytes = integer(options.maxBufferedBytes, Math.min(HARD_LEDGER_BATCH_BYTES, maxBatchBytes * 2), HARD_LEDGER_BATCH_BYTES, "maxBufferedBytes");
  const maxDelayMs = integer(options.maxDelayMs, DEFAULT_LEDGER_BATCH_DELAY_MS, HARD_LEDGER_BATCH_DELAY_MS, "maxDelayMs");
  const durability = options.durability ?? "flush_on_terminal";
  const queue: Pending[] = [];
  let bufferedBytes = 0;
  let accepted = 0;
  let flushed = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let flushChain = Promise.resolve();
  let disposed = false;

  const status = (): RunLedgerFlushResult => ({ accepted, flushed, buffered: queue.length });
  const cancelTimer = () => { if (timer) clearTimeout(timer); timer = undefined; };
  const schedule = () => {
    if (timer || disposed || queue.length === 0) return;
    timer = setTimeout(() => { timer = undefined; void flush().catch(() => undefined); }, maxDelayMs);
    timer.unref?.();
  };
  const write = (item: Pending) => {
    if (item.kind === "run") return target.appendRun(item.record);
    if (item.kind === "event") return target.appendEvent(item.record);
    if (item.kind === "tool") return target.appendToolCall(item.record);
    return target.appendUsage(item.record);
  };
  const flush = (): Promise<RunLedgerFlushResult> => {
    cancelTimer();
    const operation = flushChain.then(async () => {
      let entries = 0;
      let bytes = 0;
      while (queue.length) {
        const item = queue[0]!;
        if (entries && (entries >= maxBatchEntries || bytes + item.bytes > maxBatchBytes)) { entries = 0; bytes = 0; }
        await write(item);
        queue.shift();
        bufferedBytes -= item.bytes;
        flushed += 1;
        entries += 1;
        bytes += item.bytes;
      }
      return status();
    });
    flushChain = operation.then(() => undefined, () => undefined);
    return operation;
  };
  const enqueue = async (item: PendingInput): Promise<void> => {
    if (disposed) throw new Error("batched run ledger is disposed");
    const bytes = Buffer.byteLength(JSON.stringify(item.record));
    if (bytes > maxBatchBytes || bytes > maxBufferedBytes) throw new RangeError("run ledger record exceeds byte limit");
    if (queue.length >= maxBufferedEntries || bufferedBytes + bytes > maxBufferedBytes) await flush();
    queue.push({ ...item, bytes } as Pending);
    bufferedBytes += bytes;
    accepted += 1;
    if (durability === "write_through" || queue.length >= maxBatchEntries || bufferedBytes >= maxBatchBytes || (item.kind === "run" && terminal(item.record) && durability === "flush_on_terminal")) await flush();
    else schedule();
  };

  return {
    durability,
    appendRun: (record) => enqueue({ kind: "run", record }),
    appendEvent: (record) => enqueue({ kind: "event", record }),
    appendToolCall: (record) => enqueue({ kind: "tool", record }),
    appendUsage: (record) => enqueue({ kind: "usage", record }),
    flush,
    status,
    async dispose(disposeOptions = {}) {
      disposed = true;
      cancelTimer();
      if (disposeOptions.flush !== false) await flush();
      else {
        await flushChain;
        queue.length = 0;
        bufferedBytes = 0;
      }
    },
  };
}

export function isFlushableRunLedger(ledger: RunLedger): ledger is FlushableRunLedger {
  return "flush" in ledger && typeof ledger.flush === "function";
}
