import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderRequest, SystemPromptContribution } from "@arnilo/prism";
import { composeSystemPrompt, createAgent, providerDone } from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { createMockProvider } from "@arnilo/prism/testing";
import { contextFiles, readContextFileLayers } from "@arnilo/prism-context-files";

// Context files: AGENTS.md (workspace, source: app) and SYSTEM.md (source: user) load as
// system-prompt layers through `@arnilo/prism-context-files`, which registers one
// `context.build` handler and composes them with `AgentConfig.instructions` (the base) via the
// kernel's `composeSystemPrompt`. The package is trust-gated, reads no home directory unless
// `globalRoot` is set, and caches the files per session.
//
// This demo builds a temp workspace + temp global root, writes the two files, shows the layers
// the package resolves, then runs a mock agent with the package loaded and prints the composed
// system instruction that reached the provider request — proving the order
// (base → SYSTEM.md → AGENTS.md) without any network or real credentials.

export async function demo(): Promise<{ composed: string; reachedProvider: boolean }> {
  const workspace = await mkdtemp(join(tmpdir(), "prism-sp-example-ws-"));
  const global = await mkdtemp(join(tmpdir(), "prism-sp-example-glob-"));
  await mkdir(join(global, ".prism", "agent"), { recursive: true });
  await writeFile(join(global, ".prism", "agent", "SYSTEM.md"), "Global system policy.");
  await writeFile(join(workspace, "AGENTS.md"), "Project rule.");

  // The same layering a host gets by loading the package, exposed directly for libraries that
  // compose the prompt themselves.
  const layers: readonly SystemPromptContribution[] = await readContextFileLayers({ workspaceRoot: workspace, globalRoot: global });
  const composed = composeSystemPrompt(layers, { base: "You are helpful." }) ?? "";

  const captured: ProviderRequest[] = [];
  const provider = createMockProvider([providerDone()], {
    onRequest: (request) => {
      captured.push(request);
    },
  });
  const session = await (
    await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider", [provider]), contextFiles({ root: workspace, globalRoot: global })],
      instructions: "You are helpful.",
    })
  ).session();

  // Fire run() (resolves into closeSubscribers) and drain the event stream in
  // parallel — subscribe() only ends once run completes and closes the stream.
  const done = session.run("Hi");
  for await (const _event of session.subscribe()) {
    void _event;
  }
  await done;

  const input =
    captured[0]?.messages
      .flatMap((m) => m.content)
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("\n") ?? "";

  return {
    composed,
    reachedProvider: input.includes("You are helpful.") && input.includes("Global system policy.") && input.includes("Project rule."),
  };
}

// Runnable smoke test: `node examples/system-project-prompts.ts`. Network-free.
export async function main(): Promise<void> {
  console.log(JSON.stringify(await demo()));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
