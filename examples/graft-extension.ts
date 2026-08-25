import { join } from "node:path";

import {
  assembleProviderInput,
  createExtensionKernel,
  createMemorySessionStore,
  createToolRegistry,
  dispatchToolCall,
  type Message,
  type SessionEntry,
  type ToolResult,
} from "@arnilo/prism";
import { childEnv, resolveGraftCli, runGraftJson } from "@arnilo/prism-graft";

const here = new URL(".", import.meta.url).pathname;
// One fixture, two consumers: this is the same stub the package tests drive.
// It accepts only explicit mode sentinels (`__PACK__`, `__NOGRAPH__`, `.ts` blast
// targets) and echoes argv otherwise — no network, no native modules, no real graft.
const fixtureRoot = join(here, "../packages/prism-graft/fixtures/graft-package-fixture");
// packageRoot resolution runs the manifest-declared bin via node (no exec bit needed);
// an absolute cliPath would also work when the stub is chmod +x.
const stubCliPackageRoot = fixtureRoot;
const sessionId = "graft-demo";

function messageText(request: Awaited<ReturnType<typeof assembleProviderInput>>): string {
  return request.messages
    .flatMap((message) => message.content)
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n");
}

function userTurn(text: string): Message[] {
  return [{ role: "user", content: [{ type: "text", text }] }];
}

async function demo() {
  const store = createMemorySessionStore();
  const callbacks = {
    appendEntry: async (entry: SessionEntry, options?: { readonly expectedParentId?: string }) => {
      await store.append(entry, options);
    },
    getEntries: async () => await store.list(sessionId),
  };

  // Resolve the stub CLI explicitly (options-level seam — no env magic).
  const cli = resolveGraftCli({ packageRoot: stubCliPackageRoot });

  const kernel = createExtensionKernel({ errorPolicy: "throw" });
  await kernel.load([
    // mode "both": pull tools + push provider/orientation + edit-watch middleware.
    (await import("@arnilo/prism-graft")).createGraftExtension({
      packageRoot: stubCliPackageRoot,
      projectDir: fixtureRoot,
      mode: "both",
      quietStartup: true,
      ...callbacks,
    }),
  ]);

  // 1) Pull tool: argv-safe single-element args, parsed JSON value back.
  const mapCall: ToolResult = await dispatchToolCall({
    call: { type: "tool_call", id: "call_map", name: "graft_map", arguments: {} },
    registry: createToolRegistry(kernel.registries.tools.list()),
    context: { sessionId, runId: "r1", toolCallId: "call_map" },
  });
  const pullEchoed = Array.isArray((mapCall.value as { args?: string[] }).args);

  // 2) Push turn: skill-carried provider injects a pointers-only retrieval pack.
  const provider = kernel.registries.skills.get("graft")!.context![0]!;
  const packRequest = await assembleProviderInput({
    model: { provider: "mock", model: "demo" },
    input: "How does __PACK__ context assembly flow through the budget?",
    contextProviders: [provider],
    instructionInjectors: kernel.registries.instructionInjectors.list(),
    turn: 1,
    sessionId,
    runId: "r1",
    metadata: {},
    signal: new AbortController().signal,
  });
  const packText = messageText(packRequest);
  const pointersInjected = packText.includes("[[input-assembly]]") && packText.includes("src/input.ts:88");
  const orientationInjected = packText.includes("# Orientation");
  const dedupTurn = await provider.resolve({
    messages: userTurn("Same question again about __PACK__ context assembly flow"),
  }); // all nodes already shown → nothing injected

  // 3) Simulated edit: tool_result middleware computes blast radius from the stub.
  const edited: ToolResult = {
    toolCallId: "call_edit",
    name: "edit",
    content: [{ type: "text", text: "edited src/input.ts" }],
    metadata: { path: join(fixtureRoot, "src/input.ts"), sessionId },
  };
  const afterEdit = (await kernel.middleware.run("tool_result", edited)) as ToolResult;
  const blast = (afterEdit.metadata as { graftBlast?: { path: string; dependents: number } }).graftBlast;

  // 4) Telemetry guard: the extension's fixed child env reached the stub.
  const probe = await runGraftJson(cli, ["env"], {
    cwd: fixtureRoot,
    timeoutMs: 4000,
    maxResultBytes: 65536,
    env: childEnv({}),
  });
  const doNotTrack = (probe.value as { DO_NOT_TRACK?: string | null }).DO_NOT_TRACK === "1";

  const entries = await store.list(sessionId);
  const stateEntries = entries.filter((entry) => entry.kind === "custom" && (entry.data as { type?: string }).type === "graft-state");

  if (!pullEchoed) throw new Error("pull tool did not return stub payload");
  if (!pointersInjected) throw new Error("push turn missing retrieval-pack pointers");
  if (!orientationInjected) throw new Error("first turn missing orientation");
  if ((dedupTurn.length ?? 0) !== 0) throw new Error("dedup failed: second turn re-injected seen nodes");
  if (blast?.path !== "src/input.ts" || blast.dependents !== 2) throw new Error("blast radius missing from edit result");
  if (!doNotTrack) throw new Error("DO_NOT_TRACK did not reach the graft child process");

  return {
    pullToolEcho: pullEchoed,
    pointersInjected,
    orientationInjected,
    dedupSecondTurnEmpty: dedupTurn.length === 0,
    blastPath: blast!.path,
    blastDependents: blast!.dependents,
    doNotTrackReachedChild: doNotTrack,
    persistedGraftStateEntries: stateEntries.length,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(await demo()));
}
