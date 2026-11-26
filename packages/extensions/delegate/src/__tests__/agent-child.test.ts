/**
 * Delegate children backed by a host-supplied agent: a native parent delegates to an external CLI on
 * `driver-process` (the offline `stream-cli` reference adapter on a scripted binary) and reads its bounded report.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Agent,
  askEveryTool,
  createAgent,
  createMemorySessionStore,
  type ModelProvider,
  type ProviderEvent,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
} from "@arnilo/prism";
import { createProfiles } from "@arnilo/prism/driver-kit";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { createScriptedCli, type ScriptedDialect, type ScriptStep } from "@arnilo/prism/testing";
import { type AgentAdapter, adapterDriver, processDriver } from "@arnilo/prism-hosts/driver-process";
import delegate, { delegateWithAgents } from "../index.js";

// Computed imports keep unpublished examples outside the package declaration build's rootDir.
const exampleRoot = "../../../../../examples/adapters/";
const { streamCli }: { streamCli: AgentAdapter } = await import(`${exampleRoot}stream-cli.ts`);
const { streamCliDialect, streamCliFixtures }: { streamCliDialect: ScriptedDialect; streamCliFixtures: { config(cli: unknown): object } } =
  await import(`${exampleRoot}stream-cli.dialect.ts`);

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** The external CLI as a host builds it: a driver agent with its own profile, store and tool registry. */
async function cliAgent(script: readonly ScriptStep[], hooks?: (hooks: never) => void) {
  const root = mkdtempSync(join(tmpdir(), "delegate-cli-"));
  const cli = createScriptedCli({ dialect: streamCliDialect, script });
  cleanups.push(() => {
    cli.dispose();
    rmSync(root, { recursive: true, force: true });
  });
  await createProfiles({ root, driver: adapterDriver(streamCli) }).create("test", { mode: "key", principal: "test" });
  const agent = await createAgent({
    id: "stream-cli",
    slots: { store: createMemorySessionStore() },
    packages: [processDriver(streamCli)],
    ...(hooks ? { hooks: hooks as never } : {}),
    packageConfig: {
      [streamCli.name]: { ...streamCliFixtures.config(cli), name: "analyst", profile: "test", profilesRoot: root, principal: "test" },
    },
  });
  cleanups.push(() => agent.dispose());
  return { agent, cli };
}

/** The native parent: its first turn delegates, its next answers from the tool result. */
function parentProvider(seen: string[]): ModelProvider {
  return {
    id: "mock",
    async *generate(request: ProviderRequest): AsyncIterable<ProviderEvent> {
      const last = request.messages.at(-1);
      if (last?.role === "tool") {
        seen.push(JSON.stringify(last.content));
        yield providerTextDelta("parent cites the report");
      } else yield providerToolCall(toolCallContent("call_d", "delegate", { child: "analyst", input: "deep-dive src/" } as never));
      yield providerDone({ inputTokens: 1, outputTokens: 1, totalTokens: 2 });
    },
  };
}

async function parent(child: Agent, config: Record<string, unknown>, seen: string[]): Promise<Agent> {
  const agent = await createAgent({
    id: "native-parent",
    model: { provider: "mock", model: "m" },
    slots: { store: createMemorySessionStore() },
    packages: [
      providerPackage("mock-provider", [parentProvider(seen)]),
      delegateWithAgents({ cli: child }, { children: { analyst: { agent: "cli", ...config } } } as never),
    ],
  });
  cleanups.push(() => agent.dispose());
  return agent;
}

const report: ScriptStep[] = [
  {
    raw: JSON.stringify({
      type: "message",
      payload: { message: { role: "assistant", content: [{ type: "text", text: "REPORT: the parser is in src/parse.ts" }] } },
    }),
  },
  { raw: JSON.stringify({ type: "result", usage: { inputTokens: 40, outputTokens: 10, totalTokens: 50 } }) },
];

describe("delegate agent child", () => {
  it("a_native_parent_delegates_to_an_external_cli_and_reads_its_bounded_report", async () => {
    const { agent: child, cli } = await cliAgent(report);
    const seen: string[] = [];
    const agent = await parent(child, { instructions: "Analyse the named paths.", tools: { only: ["Read", "Grep", "Glob"] } }, seen);
    const session = await agent.session();
    const result = await session.run("analyse src/");
    expect(result.error).toBeUndefined();
    expect(result.text).toBe("parent cites the report");
    expect(seen.join("")).toContain("REPORT: the parser is in src/parse.ts");
    expect(seen.join("")).toContain("[child analyst: completed");

    // `tools.only` names the CLI does not register become its built-in allow-list: no write tool is launched.
    const argv = cli.record().find((item) => item.event === "argv");
    const args = argv?.event === "argv" ? argv.argv : [];
    const allow = args[args.indexOf("--allow-tools") + 1];
    expect(allow).toBe("Read,Grep,Glob");

    // The child is a session of the CLI agent, linked to the parent session.
    const children = await child.sessions.list({ parentSessionId: session.id });
    expect(children.items).toHaveLength(1);

    // Usage reported by the CLI is charged to the parent run.
    expect(result.usage?.totalTokens).toBeGreaterThanOrEqual(50 + 2);
  }, 30_000);

  it("a_non_interactive_parent_run_denies_the_childs_approval_request_without_suspending", async () => {
    const { agent: child, cli } = await cliAgent(
      [{ hook: { id: "w", tool: "edit", args: { path: "a.txt" } } }, ...report],
      askEveryTool() as never,
    );
    const seen: string[] = [];
    const agent = await parent(child, {}, seen);
    const result = await (await agent.session()).run("analyse src/", { interactive: false });
    expect(result.status).toBe("completed");
    const answer = cli.record().find((item) => item.event === "hook-result" && item.id === "w");
    expect(answer?.event === "hook-result" && JSON.parse(answer.stdout).decision).toBe("deny");
    expect(seen.join("")).toContain("[child analyst: completed");
  }, 30_000);

  it("an_unregistered_agent_fails_the_delegation_closed", async () => {
    const seen: string[] = [];
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      slots: { store: createMemorySessionStore() },
      packages: [
        providerPackage("mock-provider-2", [parentProvider(seen)]),
        delegate({ children: { analyst: { agent: "missing" } } } as never),
      ],
    });
    cleanups.push(() => agent.dispose());
    const result = await (await agent.session()).run("go");
    expect(result.error).toBeUndefined();
    expect(seen.join("")).toContain("unknown_agent");
  });

  it("an_agent_child_with_inherit_or_worktree_fails_the_load", async () => {
    for (const child of [
      { agent: "cli", inherit: ["@arnilo/prism-tools/coding"] },
      { agent: "cli", isolation: "worktree" },
      { agent: "cli", context: "summary" },
      {},
    ]) {
      await expect(
        createAgent({
          model: { provider: "mock", model: "m" },
          packages: [providerPackage("mock-provider-3", [parentProvider([])]), delegate({ children: { analyst: child } } as never)],
        }),
      ).rejects.toThrow();
    }
  });
});
