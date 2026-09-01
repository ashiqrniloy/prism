/** sse (0.2.5 plan 025 Task 1 split). Moved verbatim from handler.ts; public surface unchanged behind the barrel. */
import type { AgentEvent, AgentEventEnvelope } from "@arnilo/prism";
import type { WorkflowEvent } from "../../workflows/index.js";
import type { ResolvedPrismServerLimits } from "../limits.js";
import type { CreatePrismHandlerOptions } from "../types.js";
import { PrismServerError } from "../types.js";
import { SSE_HEADERS } from "./consts.js";
import { ownedSignal } from "./policy.js";

export function sseAgentEvents(
  source: AsyncIterable<AgentEventEnvelope>,
  owned: ReturnType<typeof ownedSignal>,
  limits: ResolvedPrismServerLimits,
  options: CreatePrismHandlerOptions,
  release: () => void,
): Response {
  return sseStream(
    source,
    ({ record, cursor }) => {
      if (/\r|\n|\0/.test(cursor) || Buffer.byteLength(cursor, "utf8") > limits.maxReplayCursorBytes) {
        throw new PrismServerError("Invalid event cursor", 500, "ERR_PRISM_SERVER_REPLAY_CURSOR");
      }
      const safe = options.redactor?.redact(record.event) ?? record.event;
      return `id: ${cursor}\ndata: ${JSON.stringify(safe)}\n\n`;
    },
    owned,
    limits,
    release,
  );
}

export function sse(
  source: AsyncIterable<AgentEvent | WorkflowEvent>,
  owned: ReturnType<typeof ownedSignal>,
  limits: ResolvedPrismServerLimits,
  options: CreatePrismHandlerOptions,
  release: () => void,
): Response {
  return sseStream(source, (value) => `data: ${JSON.stringify(options.redactor?.redact(value) ?? value)}\n\n`, owned, limits, release);
}

function sseStream<T>(
  source: AsyncIterable<T>,
  serialize: (value: T) => string,
  owned: ReturnType<typeof ownedSignal>,
  limits: ResolvedPrismServerLimits,
  release: () => void,
): Response {
  const iterator = source[Symbol.asyncIterator]();
  const encoder = new TextEncoder();
  let events = 0;
  let bytes = 0;
  let finished = false;
  const onAbort = () => {
    void finish(owned.signal.reason);
  };
  const finish = async (reason?: unknown) => {
    if (finished) return;
    finished = true;
    owned.signal.removeEventListener("abort", onAbort);
    owned.abort(reason);
    owned.dispose();
    release();
    await iterator.return?.();
  };
  owned.signal.addEventListener("abort", onAbort, { once: true });
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) {
          await finish();
          controller.close();
          return;
        }
        const chunk = encoder.encode(serialize(next.value));
        events += 1;
        bytes += chunk.byteLength;
        if (chunk.byteLength > limits.maxEventBytes || events > limits.maxStreamEvents || bytes > limits.maxStreamBytes) {
          const error = encoder.encode(
            'data: {"type":"error","error":{"code":"ERR_PRISM_SERVER_STREAM_LIMIT","message":"stream limit exceeded"}}\n\n',
          );
          if (error.byteLength <= limits.maxEventBytes) controller.enqueue(error);
          await finish(new Error("stream limit exceeded"));
          controller.close();
          return;
        }
        controller.enqueue(chunk);
      } catch {
        const error = encoder.encode('data: {"type":"error","error":{"code":"ERR_PRISM_SERVER_STREAM","message":"stream failed"}}\n\n');
        if (error.byteLength <= limits.maxEventBytes) controller.enqueue(error);
        await finish(new Error("stream failed"));
        controller.close();
      }
    },
    cancel(reason) {
      return finish(reason);
    },
  });
  return new Response(stream, { status: 200, headers: SSE_HEADERS });
}
