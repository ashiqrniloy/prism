import type { JsonValue, Message, RunEndResult } from "@arnilo/prism";
import type { DriverRunContext, PolicyGuard } from "@arnilo/prism/driver-kit";
import type { AgentAdapter, OutboundFrame, ProcessDriverConfig } from "./adapter.js";
import { ProcessDriverError } from "./errors.js";
import type { TransportItem } from "./transports/types.js";

/** Shared ordered state for transport frames and host steering. */
export function createTurn(
  adapter: AgentAdapter,
  ctx: DriverRunContext<ProcessDriverConfig>,
  redact: <T>(value: T) => T,
  beforeNextTurn?: (encoding: import("./adapter.js").EncodeContext) => Promise<void>,
) {
  const { run, config } = ctx;
  const encoding: { sessionId?: string; turnId?: string } = {};
  const pending: Message[] = [];
  let unmapped = 0;
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const result = queue.then(work);
    queue = result.catch(() => undefined);
    return result;
  };
  const end = async (): Promise<RunEndResult> => {
    const answer = await run.end();
    return adapter.descriptor.controls.continueOnStop ? answer : { continue: false };
  };
  const raw = async (data: JsonValue, type: string) => {
    if (config.capture === "all") await run.observe(redact({ kind: "raw" as const, vendor: adapter.descriptor.vendor, type, data }));
    else unmapped++;
  };
  return {
    encoding,
    enqueue,
    end,
    steer: (message: Message, send: (frame: OutboundFrame) => Promise<void>) =>
      enqueue(async () => {
        switch (adapter.descriptor.controls.steer) {
          case "mid-turn":
            if (!adapter.encode.steer) throw new ProcessDriverError("adapter_invalid", "mid-turn steering needs encode.steer");
            await send(adapter.encode.steer(message, encoding));
            break;
          case "next-turn":
            pending.push(message);
            break;
          case "none":
            await run.observe({
              kind: "notice",
              level: "warn",
              code: "steer_unsupported",
              message: "This adapter does not support steering",
            });
        }
      }),
    frame: (item: TransportItem, send: (frame: OutboundFrame) => Promise<void>) =>
      enqueue(async () => {
        if (item.kind === "invalid") {
          await raw(item.raw, "invalid");
          return false;
        }
        const decoded = item.kind === "decoded" ? item.value : adapter.decode(item.value);
        for (const activity of decoded.activity) {
          await run.observe(redact(activity));
          if (activity.kind === "notice") {
            const signal = adapter.notices?.(activity);
            if (signal) {
              const service = ctx.services.consume<{ guard: PolicyGuard }>(`driver-kit:${adapter.name}`);
              if (!service || !ctx.lease) throw new ProcessDriverError("adapter_invalid", "limit classification needs the policy guard");
              const decision = service.guard.noteLimit(ctx.lease.profile, signal);
              throw new ProcessDriverError("vendor_limit", signal.code, decision.deferUntil);
            }
          }
        }
        if (decoded.unmapped) {
          const value = item.kind === "decoded" ? item.raw : item.value;
          const type = value && typeof value === "object" && !Array.isArray(value) ? String(value.type ?? "unknown") : "unknown";
          await raw(value, type);
        }
        if (decoded.sessionId !== undefined) {
          encoding.sessionId = decoded.sessionId;
          if (adapter.session.strategy === "vendor") await run.state("vendor-session").append([redact(decoded.sessionId)]);
        }
        if (decoded.turnId !== undefined) encoding.turnId = decoded.turnId;
        if (decoded.stop) {
          const answer = await end();
          if (answer.continue) {
            if (!adapter.encode.continue) throw new ProcessDriverError("adapter_invalid", "continuation needs encode.continue");
            await beforeNextTurn?.(encoding);
            await send(adapter.encode.continue(answer.reason, encoding));
            return false;
          }
          return true;
        }
        if (decoded.turnEnd && pending.length) {
          await beforeNextTurn?.(encoding);
          await send(adapter.encode.prompt(pending.splice(0), encoding));
          return false;
        }
        return decoded.turnEnd === true;
      }),
    async finish() {
      await queue;
      if (unmapped) await run.observe({ kind: "notice", level: "info", code: "unmapped_frames", message: `${unmapped} unmapped frames` });
    },
  };
}
