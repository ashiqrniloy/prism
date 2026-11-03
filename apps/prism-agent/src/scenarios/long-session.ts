import type { AgentEvent, ProviderEvent, ProviderRequest, Session } from "@arnilo/prism";
import { definePackage } from "@arnilo/prism";
import { providerDone, providerTextDelta, providerToolCall, toolCallContent } from "@arnilo/prism/testing";
import { createCodingWorker } from "../host/coding.js";
import type { HostConfig } from "../host/config.js";

const TOOL = "long_result";
const BODY = "x".repeat(6_000);
const TURNS = 60;
const OVERFLOW_TURN = 40;
const OVERFLOW = {
  name: "ProviderHttpError",
  message: "provider request failed: 400 context_length_exceeded",
  code: 400,
  failureClass: "context_overflow" as const,
};

export interface LongSessionResult {
  readonly turns: number;
  readonly requests: readonly ProviderRequest[];
  readonly events: readonly AgentEvent[];
  readonly completed: boolean;
}

function isSummaryRequest(request: ProviderRequest): boolean {
  return request.messages.some(
    (message) => message.role === "user" && message.content.some((part) => part.type === "text" && part.text.startsWith("<conversation>")),
  );
}

function hasToolResult(request: ProviderRequest): boolean {
  return request.messages.at(-1)?.content.some((part) => part.type === "tool_result") === true;
}

/** One 6 KB tool result per turn; a scripted overflow before tool turn 40. */
function longSessionProvider(requests: ProviderRequest[]): {
  id: string;
  generate(request: ProviderRequest): AsyncIterable<ProviderEvent>;
} {
  let nextTurn = 0;
  let overflowed = false;
  return {
    id: "mock",
    async *generate(request) {
      requests.push(request);
      if (isSummaryRequest(request)) {
        yield providerTextDelta("Compacted history.");
        yield providerDone();
        return;
      }
      if (!hasToolResult(request)) {
        yield providerToolCall(toolCallContent(`long-${nextTurn}`, TOOL, { turn: nextTurn }));
        yield providerDone();
        return;
      }
      if (nextTurn === OVERFLOW_TURN && !overflowed) {
        overflowed = true;
        yield { type: "error", error: OVERFLOW };
        return;
      }
      if (nextTurn === TURNS - 1) {
        yield providerTextDelta("long session complete");
        yield providerDone();
        return;
      }
      nextTurn += 1;
      yield providerToolCall(toolCallContent(`long-${nextTurn}`, TOOL, { turn: nextTurn }));
      yield providerDone();
    },
  };
}

function longResultTool() {
  return definePackage({
    name: "@prism-agent/long-result",
    version: "0.0.0",
    requires: { api: 1 },
    setup(prism) {
      prism.tools.register({
        name: TOOL,
        description: "Returns six kilobytes of deterministic text for one turn.",
        effects: [],
        parameters: { type: "object", properties: { turn: { type: "integer" } }, required: ["turn"], additionalProperties: false },
        execute(args, context) {
          const turn = typeof args.turn === "number" ? args.turn : 0;
          return {
            toolCallId: context.toolCallId,
            name: TOOL,
            content: [{ type: "text", text: `${turn}:${BODY}` }],
          };
        },
      });
    },
  })();
}

function collect(session: Session): { events: AgentEvent[]; done: Promise<void> } {
  const events: AgentEvent[] = [];
  const done = (async () => {
    for await (const event of session.subscribe()) events.push(event);
  })();
  return { events, done };
}

export async function longSession(config: HostConfig): Promise<LongSessionResult> {
  const requests: ProviderRequest[] = [];
  const events: AgentEvent[] = [];
  const provider = longSessionProvider(requests);
  const agent = await createCodingWorker(config, {
    hooks: (hooks) => {
      hooks.on("package.event", (event) => {
        events.push(event as unknown as AgentEvent);
      });
    },
    packages: [
      longResultTool(),
      definePackage({
        name: "@prism-agent/long-session-provider",
        version: "0.0.0",
        requires: { api: 1 },
        setup(prism) {
          prism.providers.register(provider);
        },
      })(),
    ],
  });
  try {
    const session = await agent.session({ id: "long-session", create: true });
    const { events: sessionEvents, done } = collect(session);
    const result = await session.run("run the long session", {
      limits: {
        maxTurns: 100,
        maxToolRounds: 100,
        maxToolCalls: 100,
        maxProviderAttempts: 100,
        maxInputTokens: null,
        maxTotalTokens: null,
      },
    });
    const completed = result.status === "completed";
    await session.close();
    await done;
    events.push(...sessionEvents);
    return { turns: TURNS, requests, events, completed };
  } finally {
    await agent.dispose();
  }
}
