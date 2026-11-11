import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  type Agent,
  type AgentEvent,
  createAgent,
  createMemorySessionStore,
  type ModelProvider,
  type ProviderEvent,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  providerToolCall,
  type RunResult,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import advisor from "../index.js";

const agents: Agent[] = [];
afterEach(async () => {
  for (const agent of agents.splice(0)) await agent.dispose();
});

interface Script {
  readonly advice?: string;
  readonly adviceError?: boolean;
  readonly parentToolCalls?: number;
}

interface Seen {
  readonly advisor: { readonly prompt: string; readonly request: ProviderRequest }[];
  readonly parent: string[];
}

function scripted(seen: Seen, script: Script = {}): ModelProvider {
  let parentCalls = 0;
  return {
    id: "mock",
    async *generate(request: ProviderRequest): AsyncIterable<ProviderEvent> {
      const tools = (request.tools ?? []).map((tool) => tool.name);
      const last = request.messages.at(-1);
      const lastText = JSON.stringify(last?.content ?? "");
      if (!tools.includes("advise")) {
        seen.advisor.push({ prompt: lastText, request });
        if (script.adviceError === true) throw new Error("provider exploded");
        yield providerTextDelta(script.advice ?? "Patch the caller.");
        yield providerDone({ inputTokens: 2, outputTokens: 3, totalTokens: 5 });
        return;
      }
      seen.parent.push(lastText);
      parentCalls += 1;
      if (parentCalls <= (script.parentToolCalls ?? 1)) {
        yield providerToolCall(toolCallContent(`call_a${parentCalls}`, "advise", { question: `Q${parentCalls}` } as never));
      } else {
        yield providerTextDelta("final answer");
      }
      yield providerDone({ inputTokens: 1, outputTokens: 1, totalTokens: 2 });
    },
  };
}

async function build(
  script: Script,
  config: Record<string, unknown>,
  extra: readonly unknown[] = [],
): Promise<{ agent: Agent; seen: Seen; events: AgentEvent[] }> {
  const seen: Seen = { advisor: [], parent: [] };
  const events: AgentEvent[] = [];
  const agent = await createAgent({
    id: "advisor-consult",
    model: { provider: "mock", model: "m" },
    slots: { store: createMemorySessionStore() },
    hooks: (hooks) =>
      hooks.on("package.event", (event) => {
        if (event.name === "advisor.consult" || event.name === "validator.verdict") events.push(event);
      }),
    packages: [
      providerPackage("mock-provider", [scripted(seen, script)]),
      ...(extra as never[]),
      advisor({ model: { provider: "mock", model: "m" }, ...config } as never),
    ],
  });
  agents.push(agent);
  return { agent, seen, events };
}

async function run(
  input: string,
  script: Script,
  config: Record<string, unknown> = {},
): Promise<{ seen: Seen; events: AgentEvent[]; result: RunResult }> {
  const { agent, seen, events } = await build(script, config);
  const session = await agent.session();
  const sub = session.subscribe();
  const pump = (async () => {
    for await (const event of sub) events.push(event);
  })();
  const result = await session.run(input);
  await pump;
  return { seen, events, result };
}

const consultEvents = (events: readonly AgentEvent[]) =>
  events.flatMap((event) =>
    event.type === "package.event" && event.name === "advisor.consult" ? [(event.data ?? {}) as Record<string, unknown>] : [],
  );

describe("advise tool", () => {
  it("advise_tool_makes_one_call_with_transcript_slice", async () => {
    const { seen } = await run("TASK-MARKER what now?", { parentToolCalls: 1 });
    assert.equal(seen.advisor.length, 1);
    assert.ok(seen.advisor[0]);
    assert.match(seen.advisor[0].prompt, /TASK-MARKER/);
    assert.match(seen.advisor[0].prompt, /Q1/);
    assert.equal(seen.advisor[0].request.tools, undefined);
    assert.match(seen.parent[1] ?? "", /Patch the caller\./);
  });

  it("advise_result_capped_and_status_line", async () => {
    const { seen } = await run("go", { advice: "x".repeat(200) }, { adviceMaxChars: 10 });
    assert.ok(seen.parent[1]);
    assert.ok(seen.parent[1].includes("x".repeat(10)) && !seen.parent[1].includes("x".repeat(11)));
    assert.match(seen.parent[1], /\[advisor: mock\/m, 5 tokens\]/);
  });

  it("consult_cap_per_run_enforced", async () => {
    const { seen, events } = await run("go", { parentToolCalls: 2 }, { maxConsultsPerRun: 1 });
    assert.equal(seen.advisor.length, 1);
    assert.match(seen.parent[2] ?? "", /maxConsultsPerRun: 1/);
    assert.equal(consultEvents(events).filter((data) => data.status === "capped").length, 1);
  });

  it("advise_tool_reports_model_failure_as_error_result", async () => {
    const { seen, events } = await run("go", { adviceError: true });
    assert.match(seen.parent[1] ?? "", /The advisor did not answer: provider exploded/);
    assert.equal(consultEvents(events)[0]?.status, "skipped");
  });

  it("advisor_event_carries_no_transcript_or_advice", async () => {
    const { events } = await run("SECRET-TASK-MARKER", { advice: "SECRET-ADVICE-MARKER" });
    const data = consultEvents(events);
    assert.equal(data.length, 1);
    assert.ok(data[0]);
    assert.equal(data[0].trigger, "tool");
    assert.equal(data[0].status, "ok");
    assert.equal(data[0].totalTokens, 5);
    const json = JSON.stringify(data);
    assert.ok(!json.includes("SECRET-TASK-MARKER"));
    assert.ok(!json.includes("SECRET-ADVICE-MARKER"));
  });
});
