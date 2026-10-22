import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { JsonValue } from "@arnilo/prism";
import { bridgeTools, createJsonRpcPeer, type DriverRunContext, JsonRpcError } from "@arnilo/prism/driver-kit";
import type { AgentAdapter, EncodeContext, OutboundFrame, ProcessDriverConfig, RpcFrame } from "../adapter.js";
import { ProcessDriverError } from "../errors.js";
import type { Transport, TransportItem } from "./types.js";

export function jsonRpc(
  child: ChildProcessWithoutNullStreams,
  adapter: AgentAdapter,
  ctx: DriverRunContext<ProcessDriverConfig>,
  encoding: EncodeContext,
  redact: <T>(value: T) => T,
): Transport {
  const frames: TransportItem[] = [];
  let wake: (() => void) | undefined;
  let finished = false;
  let accepting = true;
  let failure: unknown;
  let rejectFailure: (error: unknown) => void = () => undefined;
  const failed = new Promise<never>((_, reject) => {
    rejectFailure = reject;
  });
  void failed.catch(() => undefined);
  const fail = (error: unknown) => {
    rejectFailure(error);
    failure ??= error;
    wake?.();
  };
  const push = (item: TransportItem) => {
    if (finished || failure) return;
    if (frames.length >= 256) {
      fail(new ProcessDriverError("vendor_request_failed", "pending frame limit exceeded"));
      return;
    }
    frames.push(item);
    wake?.();
  };
  const bridge = bridgeTools(ctx.run, ctx.spec.prismTools ?? [], {
    tools: ctx.tools,
    origin: { kind: "external", agent: ctx.spec.name, agentId: ctx.spec.name, vendor: adapter.descriptor.vendor, depth: 0 },
  });
  const peer = createJsonRpcPeer({
    readable: child.stdout,
    writable: child.stdin,
    maxConcurrentRequests: 8,
    onNotification: (method, params) =>
      push({ kind: "value", value: { jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) } }),
    onInvalid: (item) => push(item),
    async onRequest(method, params) {
      if (!accepting || failure || finished || ctx.run.signal.aborted) throw new Error("driver run is closed");
      const handler = Object.hasOwn(adapter.requests ?? {}, method) ? adapter.requests?.[method] : undefined;
      if (!handler) {
        accepting = false;
        throw new JsonRpcError(-32601, `unhandled request: ${redact(method)}`);
      }
      try {
        return await handler({
          ...encoding,
          params: params ?? null,
          run: ctx.run,
          host: ctx.host,
          tools: ctx.tools,
          bridge,
          ask: (request) => ctx.run.ask(request, { rewrite: adapter.descriptor.controls.rewrite }),
        });
      } catch (error) {
        accepting = false;
        throw new Error(redact(error instanceof Error ? error.message : "request handler failed"));
      }
    },
    onUnhandled: (method) => fail(new ProcessDriverError("vendor_request_unhandled", redact(method))),
    onRequestError(method, error) {
      fail(
        new ProcessDriverError(
          error instanceof JsonRpcError && error.code === -32601 ? "vendor_request_unhandled" : "vendor_request_failed",
          `${redact(method)}: ${redact(error instanceof Error ? error.message : "request failed")}`,
        ),
      );
    },
  });
  void peer.closed.then(() => {
    finished = true;
    wake?.();
  }, fail);
  const rpc = (frame: OutboundFrame): RpcFrame => {
    if (!frame || typeof frame !== "object" || Array.isArray(frame) || !("method" in frame) || typeof frame.method !== "string")
      throw new ProcessDriverError("adapter_invalid", "json-rpc encoding needs a method");
    return frame as RpcFrame;
  };
  const result = (frame: RpcFrame, value: JsonValue): TransportItem | undefined => {
    if (!frame.onResult) return { kind: "value", value };
    const decoded = frame.onResult(value);
    return decoded ? { kind: "decoded", value: decoded, raw: value } : undefined;
  };
  return {
    async open(outbound) {
      const frame = rpc(outbound);
      if (frame.notify) {
        await peer.notify(frame.method, frame.params);
        return frames.splice(0);
      }
      const item = result(frame, await Promise.race([peer.request(frame.method, frame.params), failed]));
      // Notifications received before this reply must be applied before the next opening request.
      return [...frames.splice(0), ...(item ? [item] : [])];
    },
    async send(outbound) {
      const frame = rpc(outbound);
      if (frame.notify) {
        await peer.notify(frame.method, frame.params);
        return;
      }
      // Keep reading notifications and callbacks while a turn request is outstanding.
      void peer
        .request(frame.method, frame.params)
        .then((value) => {
          const item = result(frame, value);
          if (item) push(item);
        })
        .catch(fail);
    },
    frames: {
      async *[Symbol.asyncIterator]() {
        while (!finished || frames.length) {
          if (failure) throw failure;
          const item = frames.shift();
          if (item) {
            yield item;
            continue;
          }
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
        if (failure) throw failure;
      },
    },
    async close() {
      finished = true;
      wake?.();
      child.stdin.end();
    },
  };
}
