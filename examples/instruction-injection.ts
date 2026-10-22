import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ContextSource, ProviderRequest } from "@arnilo/prism";
import {
  createAgent,
  createPathTrustPolicy,
  createSecretRedactor,
  providerDone,
  registerContextSources,
  withContextBlocks,
} from "@arnilo/prism";
import { discoverContributions } from "@arnilo/prism/node/contribution-discovery";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { createMockProvider } from "@arnilo/prism/testing";
import { resolveInstructionSources } from "@arnilo/prism-context-files";

// Instruction injection, end-to-end with the mock provider.
//
// Instruction injectors and context providers are both `context.build` handlers now
// (roadmap §2.4), so this shows the whole shape: a discovered
// `.agents/instructions/<name>/` bundle loaded as a static source, an always-on
// source, a source that reacts to the user's input, and a source that accidentally
// emits a secret — which the runtime redactor strips before the provider sees it.
// Network-free; no real credentials.

const here = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = join(here, "instruction-injection-workspace");

// Always-on project context.
const projectContext: ContextSource = {
  name: "project-context",
  contextBlocks: [{ title: "Repo", content: "Prism monorepo — see docs/." }],
};

// A redaction demo source that accidentally emits a secret in its text.
// The runtime's redactor strips it from the ProviderRequest (backstop, not
// an invitation — never author secrets into context-source text).
const SECRET = "phase30-example-token-xyz";
const leakySource: ContextSource = { name: "leaky", instructions: `auth token=${SECRET}` };

export async function demo(): Promise<{
  discoveredSource: string | undefined;
  everyTurnInstructionInInput: boolean;
  firstTurnContextBlockInInput: boolean;
  onInputInjectorApplied: boolean;
  injectedSecretRedacted: boolean;
}> {
  // 1. Discover: scan <workspace>/.agents/instructions/<name>/manifest.json.
  const trust = createPathTrustPolicy({ trustedRoots: [workspaceRoot] });
  const discovered = await discoverContributions({
    kinds: ["instructions"],
    workspaceRoot,
    trust,
  });

  // 2. Load: markdown-only (no `module` field) becomes a static source reading the
  //    resource text, trust-gated by the same policy. Core never `import()`s.
  const discoveredSources = await resolveInstructionSources(discovered, { resourceTrust: trust });
  const selected = discoveredSources.filter((source) => source.name === "json-always");
  const discoveredSource = selected[0];

  // 3. Run: mock provider captures the assembled request so we can prove the
  //    context-source instructions/blocks reached the model request. The runtime
  //    redactor (configured on the agent) strips the leaky source's secret
  //    before the provider is called.
  const captured: ProviderRequest[] = [];
  const provider = createMockProvider([providerDone()], {
    onRequest: (request) => {
      captured.push(request);
    },
  });
  const session = await (
    await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider", [provider])],
      instructions: "You are helpful.",
      // ponytail: runtime redacts ProviderRequest before the provider is called;
      // this is the backstop that strips the leaked secret from source text.
      redactor: createSecretRedactor([SECRET]),
      hooks: (hooks) => {
        registerContextSources(hooks, [...selected, projectContext, leakySource]);
        // A handler can branch on the turn's transcript, which is what the retired
        // `on_input` predicate did.
        hooks.on(
          "context.build",
          (draft) => {
            const asked = draft.messages.some((message) => /json/i.test(JSON.stringify(message.content)));
            return asked
              ? withContextBlocks(draft, [{ title: "Format", content: "Reply with JSON because the user asked for JSON." }])
              : undefined;
          },
          { id: "json-on-json-input" },
        );
      },
    })
  ).session();

  // Fire run() (resolves into closeSubscribers) and drain the event stream.
  const done = session.run("List primes. Respond in JSON.");
  for await (const _event of session.subscribe()) {
    void _event;
  }
  await done;

  // captured[0] is already redacted by the runtime — the provider never sees SECRET.
  const inputJson = JSON.stringify(captured[0]);

  return {
    discoveredSource: discoveredSource?.name,
    everyTurnInstructionInInput: /Always structure the final answer as a single JSON object/.test(inputJson),
    firstTurnContextBlockInInput: /Prism monorepo — see docs\//.test(inputJson),
    // The transcript branch matched because the user said "JSON".
    onInputInjectorApplied: /Reply with JSON because the user asked for JSON/.test(inputJson),
    // Runtime redacted the leaky source's secret before the provider call.
    injectedSecretRedacted: !inputJson.includes(SECRET),
  };
}

// Runnable smoke test: `node examples/instruction-injection.ts`. Network-free.
export async function main(): Promise<void> {
  const result = await demo();
  console.log(JSON.stringify(result));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
