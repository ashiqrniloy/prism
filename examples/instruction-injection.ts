import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createContributionRegistries,
  registerDiscoveredContributions,
  createAgent,
  createMockProvider,
  createSecretRedactor,
  providerDone,
  resolveInstructionInjectors,
} from "@arnilo/prism";
import { discoverContributions } from "@arnilo/prism/node/contribution-discovery";
import { registerDiscoveredInstructionInjectors } from "@arnilo/prism/node/instruction-injectors";
import { createPathTrustPolicy } from "@arnilo/prism/node/trust";
import type { InstructionInjector, ProviderRequest } from "@arnilo/prism";

// Instruction injection, end-to-end with the mock provider.
//
// Demonstrates the three lifecycle modes (every_turn / first_turn / on_input
// + predicate), Phase 29 discovery loading of a `.agents/instructions/<name>/`
// bundle, name-based selection via resolveInstructionInjectors, and that an
// injected secret token is redacted by the runtime before the provider sees it.
// Network-free; no real credentials.

const here = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = join(here, "instruction-injection-workspace");

// A first_turn injector: project context only on turn 1.
const projectContext: InstructionInjector = {
  name: "project-context",
  apply: () => ({
    contextBlocks: [{ title: "Repo", content: "Prism monorepo — see docs/." }],
    when: "first_turn",
  }),
};

// An on_input injector: reaction to the user asking for JSON.
const jsonOnJsonInput: InstructionInjector = {
  name: "json-on-json-input",
  apply: (ctx) => ({
    instructions: "Reply with JSON because the user asked for JSON.",
    when: "on_input",
    predicate: (c) => c.input.some((m) => /json/i.test(JSON.stringify(m.content))),
  }),
};

// A redaction demo injector that accidentally emits a secret in its text.
// The runtime's redactor strips it from the ProviderRequest (backstop, not
// an invitation — never author secrets into injector text).
const SECRET = "phase30-example-token-xyz";
const leakyInjector: InstructionInjector = {
  name: "leaky",
  apply: () => ({ instructions: `auth token=${SECRET}`, when: "every_turn" }),
};

export async function demo(): Promise<{
  discoveredInjector: string | undefined;
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

  // 2. Register: markdown-only (no `module` field) becomes a static every_turn
  //    injector reading the resource text. Core never `import()`s.
  const registries = createContributionRegistries();
  registerDiscoveredContributions(registries, discovered);
  await registerDiscoveredInstructionInjectors(registries, discovered);
  const discoveredInjector = registries.instructionInjectors.list()[0];

  // 3. Resolve names fail-closed: ["json-always"] -> live injectors.
  //    Unknown name would throw "Unknown instruction injector: <name>".
  const resolved = resolveInstructionInjectors({
    registry: registries.instructionInjectors,
    names: ["json-always"],
  });

  // 4. Run: mock provider captures the assembled request so we can prove the
  //    injector instructions/blocks reached the model request. The runtime
  //    redactor (configured on the agent) strips the leaky injector's secret
  //    before the provider is called.
  const captured: ProviderRequest[] = [];
  const provider = createMockProvider([providerDone()], {
    onRequest: (request) => {
      captured.push(request);
    },
  });
  const session = createAgent({
    model: { provider: "mock", model: "demo" },
    provider,
    instructions: "You are helpful.",
    instructionInjectors: [...resolved, projectContext, jsonOnJsonInput, leakyInjector],
    // ponytail: runtime redacts ProviderRequest before the provider is called;
    // this is the backstop that strips the leaked secret from injector text.
    redactor: createSecretRedactor([SECRET]),
  }).createSession();

  // Fire run() (resolves into closeSubscribers) and drain the event stream.
  const done = session.run("List primes. Respond in JSON.");
  for await (const _event of session.subscribe()) {
    void _event;
  }
  await done;

  // captured[0] is already redacted by the runtime — the provider never sees SECRET.
  const inputJson = JSON.stringify(captured[0]);

  return {
    discoveredInjector: discoveredInjector?.name,
    everyTurnInstructionInInput: /Always structure the final answer as a single JSON object/.test(inputJson),
    firstTurnContextBlockInInput: /Prism monorepo — see docs\//.test(inputJson),
    // on_input predicate matched because the user said "JSON".
    onInputInjectorApplied: /Reply with JSON because the user asked for JSON/.test(inputJson),
    // Runtime redacted the leaky injector's secret before the provider call.
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
