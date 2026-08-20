import {
  AntigravityStreamError,
  type AntigravityStreamRecord,
  type AntigravityTokenUsage,
  type InitRecord,
  type ResolvedAntigravityRunnerLimits,
  type ResultRecord,
  type StepUpdateRecord,
} from "./types.js";

export function safeUsage(value: unknown): AntigravityTokenUsage | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const val = value as Record<string, unknown>;
  const output: Record<string, number> = {};

  const mappings: Array<[keyof AntigravityTokenUsage, string, string]> = [
    ["inputTokens", "input_tokens", "inputTokens"],
    ["outputTokens", "output_tokens", "outputTokens"],
    ["thinkingTokens", "thinking_tokens", "thinkingTokens"],
    ["cacheReadTokens", "cache_read_tokens", "cacheReadTokens"],
    ["cacheWriteTokens", "cache_write_tokens", "cacheWriteTokens"],
    ["totalTokens", "total_tokens", "totalTokens"],
  ];

  for (const [target, snake, camel] of mappings) {
    const raw = val[snake] ?? val[camel];
    if (typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0) {
      output[target] = raw;
    }
  }

  return Object.keys(output).length > 0 ? (output as AntigravityTokenUsage) : undefined;
}

export function parseSingleRecord(line: string): AntigravityStreamRecord {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    throw new AntigravityStreamError(`Malformed JSON in stream line: ${line.slice(0, 120)}`, { cause: error });
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AntigravityStreamError("CLI emitted non-object JSON");
  }

  const obj = value as Record<string, unknown>;
  const wrappedType = typeof obj.event === "string" && obj[obj.event] && typeof obj[obj.event] === "object" ? obj.event : undefined;
  const body = wrappedType ? (obj[wrappedType] as Record<string, unknown>) : obj;

  const rawType = wrappedType ?? (typeof obj.type === "string" ? obj.type : undefined);
  if (!rawType) {
    throw new AntigravityStreamError("Stream record missing 'type' or 'event' field");
  }

  const conversationId =
    typeof body.conversation_id === "string"
      ? body.conversation_id
      : typeof obj.conversation_id === "string"
        ? obj.conversation_id
        : undefined;

  const usage = safeUsage(body.usage ?? obj.usage);

  if (rawType === "init") {
    return {
      type: "init",
      ...body,
      tools: Array.isArray(body.tools) ? body.tools.map(String) : undefined,
      cwd: typeof body.cwd === "string" ? body.cwd : undefined,
    } as InitRecord;
  }

  if (rawType === "step_update") {
    return {
      type: "step_update",
      ...body,
      conversation_id: conversationId,
      usage,
    } as StepUpdateRecord;
  }

  if (rawType === "result") {
    if (!conversationId) {
      throw new AntigravityStreamError("Result event missing conversation_id");
    }
    return {
      type: "result",
      ...body,
      conversation_id: conversationId,
      status: typeof body.status === "string" ? body.status : "SUCCESS",
      response: typeof body.response === "string" ? body.response : undefined,
      usage,
    } as ResultRecord;
  }

  // Treat any other type as step_update or custom record
  return {
    type: rawType as "step_update",
    ...body,
    conversation_id: conversationId,
    usage,
  } as AntigravityStreamRecord;
}

export class NdjsonParser {
  private buffer = "";
  private totalBytesProcessed = 0;
  private readonly diagnosticsBuffer: string[] = [];
  private readonly maxLineBytes: number;
  private readonly maxTotalBytes: number;

  constructor(options?: { maxLineBytes?: number; maxTotalBytes?: number }) {
    this.maxLineBytes = options?.maxLineBytes ?? 64 * 1024;
    this.maxTotalBytes = options?.maxTotalBytes ?? 10 * 1024 * 1024;
  }

  push(chunk: string | Buffer): AntigravityStreamRecord[] {
    const chunkStr = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const chunkBytes = Buffer.byteLength(chunkStr, "utf8");
    this.totalBytesProcessed += chunkBytes;

    if (this.totalBytesProcessed > this.maxTotalBytes) {
      throw new AntigravityStreamError(`Total stream output exceeded limit of ${this.maxTotalBytes} bytes`);
    }

    this.buffer += chunkStr;
    const records: AntigravityStreamRecord[] = [];

    while (true) {
      const newlineIndex = this.buffer.indexOf("\n");
      if (newlineIndex === -1) {
        // No more newlines in buffer
        if (Buffer.byteLength(this.buffer, "utf8") > this.maxLineBytes) {
          throw new AntigravityStreamError(`Stream line exceeded maximum length of ${this.maxLineBytes} bytes`);
        }
        break;
      }

      let line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (line.endsWith("\r")) {
        line = line.slice(0, -1);
      }

      if (!line.trim()) {
        continue;
      }

      if (Buffer.byteLength(line, "utf8") > this.maxLineBytes) {
        throw new AntigravityStreamError(`Stream line exceeded maximum length of ${this.maxLineBytes} bytes`);
      }

      try {
        const record = parseSingleRecord(line);
        records.push(record);
      } catch (error) {
        if (error instanceof AntigravityStreamError && error.message.startsWith("Malformed JSON")) {
          this.diagnosticsBuffer.push(line);
        } else {
          throw error;
        }
      }
    }

    return records;
  }

  flush(): AntigravityStreamRecord[] {
    const remaining = this.buffer.trim();
    this.buffer = "";
    if (!remaining) return [];

    if (Buffer.byteLength(remaining, "utf8") > this.maxLineBytes) {
      throw new AntigravityStreamError(`Stream line exceeded maximum length of ${this.maxLineBytes} bytes`);
    }

    try {
      return [parseSingleRecord(remaining)];
    } catch (error) {
      if (error instanceof AntigravityStreamError && error.message.startsWith("Malformed JSON")) {
        this.diagnosticsBuffer.push(remaining);
        return [];
      }
      throw error;
    }
  }

  getDiagnostics(): string {
    return this.diagnosticsBuffer.join("\n");
  }

  getTotalBytes(): number {
    return this.totalBytesProcessed;
  }
}

export class NdjsonStreamValidator {
  private state: "uninitialized" | "initialized" | "completed" = "uninitialized";
  private eventCount = 0;
  private stepCount = 0;
  private toolCallCount = 0;
  private subagentCount = 0;
  private initRecord?: InitRecord;
  private resultRecord?: ResultRecord;
  private readonly stepRecords: StepUpdateRecord[] = [];
  private readonly allRecords: AntigravityStreamRecord[] = [];

  constructor(private readonly limits: ResolvedAntigravityRunnerLimits) {}

  processRecord(record: AntigravityStreamRecord): void {
    if (this.state === "completed") {
      throw new AntigravityStreamError("Received stream event after terminal result");
    }

    if (record.type === "init") {
      if (this.state !== "uninitialized") {
        throw new AntigravityStreamError("Received duplicate or unexpected init event");
      }
      this.eventCount += 1;
      if (this.eventCount > this.limits.maxEvents) {
        throw new AntigravityStreamError(`Stream exceeded maximum event limit of ${this.limits.maxEvents}`);
      }
      this.state = "initialized";
      this.initRecord = record;
      this.allRecords.push(record);
      return;
    }

    if (this.state === "uninitialized") {
      throw new AntigravityStreamError(`Received '${record.type}' event before initial 'init' event`);
    }

    this.eventCount += 1;
    if (this.eventCount > this.limits.maxEvents) {
      throw new AntigravityStreamError(`Stream exceeded maximum event limit of ${this.limits.maxEvents}`);
    }

    if (record.type === "step_update") {
      this.stepCount += 1;
      if (this.stepCount > this.limits.maxSteps) {
        throw new AntigravityStreamError(`Stream exceeded maximum step limit of ${this.limits.maxSteps}`);
      }

      if (record.tool_info) {
        this.toolCallCount += 1;
        if (this.toolCallCount > this.limits.maxToolCalls) {
          throw new AntigravityStreamError(`Stream exceeded maximum tool call limit of ${this.limits.maxToolCalls}`);
        }
      }

      if (record.subagent_info) {
        this.subagentCount += 1;
        if (this.subagentCount > this.limits.maxSubagents) {
          throw new AntigravityStreamError(`Stream exceeded maximum subagent limit of ${this.limits.maxSubagents}`);
        }
      }

      this.stepRecords.push(record);
      this.allRecords.push(record);
      return;
    }

    if (record.type === "result") {
      this.state = "completed";
      this.resultRecord = record;
      this.allRecords.push(record);
      return;
    }

    // Custom or unknown record
    this.allRecords.push(record);
  }

  assertCompleted(): {
    init: InitRecord;
    steps: readonly StepUpdateRecord[];
    result: ResultRecord;
    events: readonly AntigravityStreamRecord[];
  } {
    if (this.state === "uninitialized") {
      throw new AntigravityStreamError("Stream ended without emitting an init event");
    }
    if (this.state !== "completed" || !this.resultRecord) {
      throw new AntigravityStreamError("Stream ended without a terminal result event");
    }
    return {
      init: this.initRecord!,
      steps: this.stepRecords,
      result: this.resultRecord,
      events: this.allRecords,
    };
  }

  getState(): "uninitialized" | "initialized" | "completed" {
    return this.state;
  }
}
