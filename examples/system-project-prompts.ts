import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  composeSystemPrompt,
  createAgent,
  createMockProvider,
  providerDone,
} from "@arnilo/prism";
import { loadSystemPromptFiles } from "@arnilo/prism/node/system-prompts";
import { createPathTrustPolicy } from "@arnilo/prism/node/trust";
import type { ProviderRequest } from "@arnilo/prism";

// Phase 31 system/project prompt files: AGENTS.md (workspace, source: app) and
// SYSTEM.md (host-supplied globalRoot, source: user) auto-load as SystemPromptContribution
// layers composed with AgentConfig.instructions (base) via composeSystemPrompt. The
// host owns globalRoot (the CLI never defaults it to the user's home directory).
//
// This demo builds a temp workspace + temp global root, writes the two files,
// loads them with `loadSystemPromptFiles` (trust-gated for AGENTS.md), then runs
// a mock agent and prints the composed system instruction that reached the
// provider request — proving the layering order (base → SYSTEM.md → AGENTS.md)
// without any network or real credentials.

export async function demo(): Promise<{ composed: string; reachedProvider: boolean }> {
  const workspace = await mkdtemp(join(tmpdir(), "prism-sp-example-ws-"));
  const global = await mkdtemp(join(tmpdir(), "prism-sp-example-glob-"));
  await mkdir(join(global, ".prism", "agent"), { recursive: true });
  await writeFile(join(global, ".prism", "agent", "SYSTEM.md"), "Global system policy.");
  await writeFile(join(workspace, "AGENTS.md"), "Project rule.");

  // Trust gate fails closed — workspace AGENTS.md is never loaded from an untrusted root.
  const trust = createPathTrustPolicy({ trustedRoots: [workspace] });
  const layers = await loadSystemPromptFiles({ workspaceRoot: workspace, globalRoot: global, trust });

  // Standalone SDK escape hatch: passing no roots returns [] with no filesystem I/O —
  // AgentConfig.instructions / systemPrompt keep working without the file loader.
  const empty = await loadSystemPromptFiles({});
  void empty;

  // The CLI composes these layers with `instructions` (base) automatically; here we
  // pass both explicitly to make the composition visible.
  const composed = composeSystemPrompt(layers, { base: "You are helpful." }) ?? "";

  const captured: ProviderRequest[] = [];
  const provider = createMockProvider([providerDone()], {
    onRequest: (request) => { captured.push(request); },
  });
  const session = createAgent({
    model: { provider: "mock", model: "demo" },
    provider,
    instructions: "You are helpful.",
    systemPrompt: layers,
  }).createSession();

  // Fire run() (resolves into closeSubscribers) and drain the event stream in
  // parallel — subscribe() only ends once run completes and closes the stream.
  const done = session.run("Hi");
  for await (const _event of session.subscribe()) {
    void _event;
  }
  await done;

  const input = captured[0]?.messages
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
