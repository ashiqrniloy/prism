import { createAgent, createMemorySessionStore, providerDone, providerTextDelta, toolCallContent, type ModelProvider } from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { createScriptedHostUi } from "@arnilo/prism/testing";
import { approvalPackage } from "@arnilo/prism-approval";
import { defineWorkflow, functionNode, gateNode, loopAgentNode, workflowLoop } from "@arnilo/prism-workflows";

/**
 * A generate-validate-revise loop as a `workflowLoop` (roadmap §2.12.13): one agent, one session. The
 * generate step's tool call goes through `tool.call`, so `approvalPackage` gates it: denied under
 * `deny`, run once under `ask` with a scripted `HostUi`. The first draft fails the `gateNode`
 * validator and routes back for one revision. Offline on the mock provider; no credential.
 * Run: npm run build:core && node examples/workflow-loop.ts
 */

const MODEL = { provider: "mock", model: "demo" } as const;

function scriptedProvider(): ModelProvider {
  let turn = 0;
  return {
    id: "mock",
    async *generate() {
      turn += 1;
      if (turn === 1) {
        yield { type: "tool_call" as const, call: toolCallContent("call-1", "save_draft", { name: "draft.md" }) };
        yield providerDone();
        return;
      }
      yield providerTextDelta(turn === 2 ? "first draft" : "final answer");
      yield providerDone();
    },
  };
}

const generateValidateRevise = defineWorkflow({
  id: "generate-validate-revise",
  revision: "1",
  limits: { maxSupersteps: 12 },
  nodes: {
    seed: functionNode({ execute: () => "start" }),
    generate: loopAgentNode({
      activation: "any",
      input: (ctx) => (ctx.upstream.validate ? "Revise: the answer was not final." : "Draft the answer. Save it with save_draft."),
    }),
    validate: gateNode({
      check: (ctx) => (String(ctx.upstream.generate).includes("final") ? { pass: true } : { pass: false, reason: "not final" }),
    }),
  },
  edges: [
    ["seed", "generate"],
    ["generate", "validate"],
    ["validate", "generate"],
  ],
});

async function run(mode: "deny" | "ask") {
  const saved: string[] = [];
  const scripted = createScriptedHostUi({ confirm: true });
  const agent = await createAgent({
    id: `workflow-loop-${mode}`,
    model: MODEL,
    slots: { store: createMemorySessionStore() },
    host: { ui: scripted.ui },
    packages: [providerPackage("test-provider", [scriptedProvider()]), workflowLoop(generateValidateRevise), approvalPackage({ mode })],
    tools: {
      add: [
        {
          name: "save_draft",
          description: "Saves the draft",
          parameters: { type: "object", properties: { name: { type: "string" } } },
          effects: ["write"],
          execute: (args, context) => {
            saved.push(String(args.name));
            return { toolCallId: context.toolCallId, name: "save_draft", value: "saved" };
          },
        },
      ],
    },
  });
  const result = await (await agent.session()).run("Write the answer");
  await agent.dispose();
  return { status: result.status, text: result.text, saved, confirmRequests: scripted.requestsOf("confirm").length };
}

export async function demo(): Promise<Record<string, unknown>> {
  const deny = await run("deny");
  const ask = await run("ask");
  if (deny.saved.length !== 0 || ask.saved.length !== 1 || deny.text !== "final answer" || ask.text !== "final answer") {
    throw new Error("workflow-loop: the approval gate did not govern the loop's tool call");
  }
  return { deny, ask };
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await demo()));
