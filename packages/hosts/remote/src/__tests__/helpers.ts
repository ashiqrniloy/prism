import {
  type Agent,
  askEveryTool,
  createAgent,
  createMemorySessionStore,
  type HostUi,
  type JsonObject,
  type JsonValue,
  providerDone,
  providerTextDelta,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import {
  type ConnectAgentOptions,
  connectAgent,
  createDispatcher,
  createMemoryTransportPair,
  type Dispatcher,
  remoteHostUi,
  serveAgent,
} from "../index.js";
import type { HostUiRequestParams } from "../protocol.js";

export const MODEL = { provider: "mock", model: "demo" } as const;
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function until(check: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("condition not met in time");
    await sleep(5);
  }
}

/** A model that calls `write` once (when gated), then answers. */
export function gatedAgent(
  options: { store?: ReturnType<typeof createMemorySessionStore>; ui?: HostUi; gate?: boolean; text?: string; resumed?: boolean } = {},
) {
  const executed: JsonObject[] = [];
  let turn = options.resumed ? 1 : 0;
  const store = options.store ?? createMemorySessionStore();
  const gate = options.gate ?? true;
  const build = () =>
    createAgent({
      id: "served",
      name: "served-agent",
      model: MODEL,
      slots: { store },
      ...(gate ? { hooks: askEveryTool() } : {}),
      ...(options.ui ? { host: { ui: options.ui } } : {}),
      packages: [
        providerPackage("test-provider", [
          {
            id: "mock",
            async *generate() {
              turn += 1;
              if (gate && turn % 2 === 1) {
                yield { type: "tool_call" as const, call: toolCallContent(`call-${turn}`, "write", { value: "ok" }) };
                yield providerDone();
                return;
              }
              yield providerTextDelta(options.text ?? "finished");
              yield providerDone();
            },
          },
        ]),
      ],
      tools: {
        add: [
          {
            name: "write",
            parameters: { type: "object", properties: { value: { type: "string" } } },
            execute: (args, context) => {
              executed.push(args);
              return { toolCallId: context.toolCallId, name: "write", value: "done" };
            },
          },
        ],
      },
    });
  return { build, store, executed };
}

export interface TestClient {
  readonly dispatcher: Dispatcher;
  readonly events: Array<{ sessionId: string; runId: string; event: { type: string } & JsonObject }>;
  readonly settled: Array<{ sessionId: string; runId: string; result: JsonObject }>;
  readonly asked: HostUiRequestParams[];
  readonly frames: string[];
  call(method: string, params?: JsonObject): Promise<JsonValue>;
}

/** Serves `agent` over a memory pair and returns a scripted client. */
export async function connectTestClient(
  agent: Agent,
  ui: HostUi | undefined,
  answer?: (params: HostUiRequestParams) => Promise<JsonValue> | JsonValue,
  capabilities: { hostUi?: boolean; "hostUi.secret"?: boolean; agentEvents?: boolean } = { hostUi: true },
) {
  const [a, b] = createMemoryTransportPair();
  const frames: string[] = [];
  const sendB = b.send.bind(b);
  b.send = async (frame) => {
    frames.push(JSON.stringify(frame));
    await sendB(frame);
  };
  const framesB = b.frames.bind(b);
  b.frames = () => {
    const source = framesB();
    return (async function* () {
      for await (const item of source) {
        if (typeof item === "string") frames.push(item);
        yield item;
      }
    })();
  };
  const served = serveAgent(agent, { transport: a, ...(ui ? { hostUi: ui } : {}), endpointId: "ep-test" });
  const events: TestClient["events"] = [];
  const settled: TestClient["settled"] = [];
  const asked: HostUiRequestParams[] = [];
  const dispatcher = createDispatcher({
    transport: b,
    role: "client",
    capabilities,
    requests: {
      "hostUi.request": async (params) => {
        asked.push(params as unknown as HostUiRequestParams);
        return (await (answer?.(params as unknown as HostUiRequestParams) ?? { status: "unavailable" })) as JsonValue;
      },
    },
    notifications: {
      "run.event": (p) => events.push(p as never),
      "run.settled": (p) => settled.push(p as never),
    },
  });
  const initialized = await dispatcher.initialize();
  const client: TestClient = { dispatcher, events, settled, asked, frames, call: (method, params) => dispatcher.request(method, params) };
  return { client, served, initialized };
}

export { remoteHostUi };

/** Serves `agent` over a memory pair and returns the `connectAgent` proxy. */
export async function connectProxy(agent: Agent, ui: HostUi | undefined, options: ConnectAgentOptions = {}) {
  const [a, b] = createMemoryTransportPair();
  const served = serveAgent(agent, { transport: a, ...(ui ? { hostUi: ui } : {}), endpointId: "ep-proxy" });
  const proxy = await connectAgent({ kind: "memory", transport: b }, options);
  return { proxy, served, server: b };
}
