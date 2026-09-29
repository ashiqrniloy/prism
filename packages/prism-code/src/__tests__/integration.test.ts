import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMockProvider, providerDone, providerTextDelta, type ToolRegistry } from "@arnilo/prism";
import type { PrismCodeConfig } from "../config.js";
import { MemoryStoredCredentialStore, PrismCodeCredentialManager } from "../credentials.js";
import { assembleAppAgent, runHeadless } from "../headless.js";
import { type CommandContext, handleSlashCommand } from "../tui/commands.js";
import { createInitialTuiState } from "../tui/reducer.js";
import type { WikiContributions } from "../wiki.js";

function makeWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "prism-code-integration-"));
}

function mockProvider() {
  return createMockProvider([providerTextDelta("Integration reply."), providerDone()]);
}

function baseConfig(cwd: string, over: Partial<PrismCodeConfig> = {}): PrismCodeConfig {
  return {
    cwd,
    userId: "integration-user",
    model: { provider: "mock", model: "mock" },
    store: { type: "memory" },
    web: "off",
    ...over,
  };
}

function commandContext(
  definition: Awaited<ReturnType<typeof assembleAppAgent>>,
  config: PrismCodeConfig,
  workspace: string,
  credentialManager: PrismCodeCredentialManager = new PrismCodeCredentialManager({ store: new MemoryStoredCredentialStore() }),
) {
  const entries: any[] = [];
  const footers: any[] = [];
  const session = definition.createSession({
    id: "integration-session",
    metadata: { workspaceRoot: workspace, userId: "integration-user" },
  });
  const context: any = {
    state: createInitialTuiState({ provider: "mock", model: "mock" }),
    stream: { appendOrUpdate: (entry: any) => entries.push(entry) },
    status: { update: () => {} },
    session,
    definition,
    config,
    store: definition.agent.config.store,
    currentModel: { provider: "mock", model: "mock" },
    credentialManager,
    omCoordinator: (definition as unknown as { omCoordinator?: unknown }).omCoordinator,
    onUpdateState: (patch: any) => footers.push(patch),
    onUpdateModel: () => {},
    onSwitchSession: async () => {},
  };
  return { context: context as CommandContext, entries, footers };
}

describe("prism-code integration (offline)", () => {
  it("threads exactly one credential manager through assembly, observational memory, and commands", async () => {
    const workspace = makeWorkspace();
    const config = baseConfig(workspace);
    const manager = new PrismCodeCredentialManager({ store: new MemoryStoredCredentialStore() });
    const definition = await assembleAppAgent(config, mockProvider(), undefined, undefined, manager);
    try {
      assert.strictEqual(
        (definition as unknown as { omCoordinator: { credentialManager: unknown } }).omCoordinator.credentialManager,
        manager,
      );
      const { context } = commandContext(definition, config, workspace, manager);
      assert.strictEqual(context.credentialManager, manager);
      assert.strictEqual((context.omCoordinator as unknown as { credentialManager: unknown }).credentialManager, manager);
    } finally {
      await definition.dispose();
    }
  });

  it("assembled app registers coding, git, wiki, and observational-memory contributions", async () => {
    const workspace = makeWorkspace();
    const config = baseConfig(workspace, { tools: { planes: { git: true } }, wiki: true });
    const definition = await assembleAppAgent(config, mockProvider());
    try {
      const tools = (definition.agent.config.tools as ToolRegistry).list();
      const names = new Set(tools.map((tool) => tool.name));
      for (const expected of ["shell", "read", "write", "edit", "repo_list", "repo_search", "glob", "delete", "move"]) {
        assert.ok(names.has(expected), `missing core tool ${expected}`);
      }
      assert.ok(names.has("git_status"), "git plane opted in but git_status absent");
      for (const wikiTool of ["wiki_search", "wiki_read_page", "wiki_record_insight", "wiki_ingest"]) {
        assert.ok(names.has(wikiTool), `missing wiki tool ${wikiTool}`);
      }
      assert.ok(names.has("recall"), "observational-memory recall tool absent");
      // web: "off" must be truly inert
      assert.ok(!names.has("web_search") && !names.has("web_fetch"), "web tools registered despite web: off");

      const contributions = (definition as unknown as { wikiContributions?: WikiContributions }).wikiContributions;
      assert.ok(contributions?.enabled);
      assert.deepStrictEqual(definition.commands.map((command) => command.name).sort(), [
        "skill",
        "skills",
        "wiki-ingest",
        "wiki-init",
        "wiki-lint",
        "wiki-refresh",
      ]);
      assert.strictEqual(contributions?.instructionInjectors.length, 1);
      assert.ok(!existsSync(join(workspace, ".agents", "skills")), "wiki skills deployed without explicit opt-in");
    } finally {
      await definition.dispose();
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("slash commands dispatch built-ins, observational memory, and wiki commands through the assembled app", async () => {
    const workspace = makeWorkspace();
    const config = baseConfig(workspace, { wiki: { enabled: true }, tools: { planes: { git: true } } });
    const definition = await assembleAppAgent(config, mockProvider());
    try {
      const { context, entries, footers } = commandContext(definition, config, workspace);

      const help = await handleSlashCommand("/help", context);
      assert.strictEqual(help.handled, true);
      const helpText = entries.at(-1)?.text ?? "";
      for (const command of [
        "/new",
        "/resume",
        "/compact",
        "/om",
        "/om-model",
        "/provider",
        "/model",
        "/wiki-init",
        "/wiki-refresh",
        "/wiki-lint",
        "/wiki-ingest",
      ]) {
        assert.ok(helpText.includes(command), `/help missing ${command}`);
      }

      const om = await handleSlashCommand("/om", context);
      assert.strictEqual(om.handled, true);
      assert.match(entries.at(-1)?.text ?? "", /Observational memory enabled/);
      assert.strictEqual(footers.at(-1)?.footer?.omEnabled, true);

      const init = await handleSlashCommand("/wiki-init", context);
      assert.strictEqual(init.handled, true);
      const initText = entries.at(-1)?.text ?? "";
      assert.match(initText, /Initialized LLM Wiki/);
      assert.ok(existsSync(join(workspace, ".wiki")), "/wiki-init did not scaffold the wiki");
      assert.strictEqual(entries.at(-1)?.type, "message");

      const lint = await handleSlashCommand("/wiki-lint", context);
      assert.strictEqual(lint.handled, true);
      assert.strictEqual(entries.at(-1)?.type, "message");
      assert.match(entries.at(-1)?.text ?? "", /Wiki health/);
    } finally {
      await definition.dispose();
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("headless print and json modes run the mock provider and bound their exit codes", async () => {
    const workspace = makeWorkspace();
    const config = baseConfig(workspace, { wiki: false });
    try {
      let text = "";
      const printExit = await runHeadless({
        config,
        prompt: "summarize",
        mode: "print",
        provider: mockProvider(),
        stdout: {
          write(chunk: string) {
            text += chunk;
            return true;
          },
        },
      });
      assert.strictEqual(printExit, 0);
      assert.strictEqual(text, "Integration reply.\n");

      const lines: string[] = [];
      const jsonExit = await runHeadless({
        config,
        prompt: "summarize",
        mode: "json",
        provider: mockProvider(),
        stdout: {
          write(chunk: string) {
            lines.push(chunk);
            return true;
          },
        },
      });
      assert.strictEqual(jsonExit, 0);
      const parsed = lines
        .join("")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { type: string });
      assert.ok(parsed.length > 0);
      assert.ok(parsed.every((line) => line.type === "event" || line.type === "error"));
      assert.ok(parsed.some((line) => line.type === "event"));

      // Resuming with an in-memory store fails closed before assembling.
      const resumeExit = await runHeadless({
        config,
        prompt: "summarize",
        mode: "json",
        sessionId: "session_1",
        provider: mockProvider(),
        stdout: { write: () => true },
      });
      assert.strictEqual(resumeExit, 1);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("applies a durable edit tool call with the local host identity (regression: no effect-identity block)", async () => {
    const workspace = makeWorkspace();
    const config = baseConfig(workspace, { wiki: false });
    try {
      writeFileSync(join(workspace, "note.txt"), "one\n");
      let turn = 0;
      const provider = {
        id: "mock",
        async *generate() {
          turn += 1;
          if (turn === 1) {
            yield {
              type: "tool_call" as const,
              call: {
                type: "tool_call" as const,
                id: "edit_1",
                name: "edit",
                arguments: { path: "note.txt", edits: [{ oldText: "one", newText: "two" }] },
              },
            };
          } else {
            yield providerTextDelta("edited");
          }
          yield providerDone();
        },
      };

      const definition = await assembleAppAgent(config, provider);
      const session = definition.createSession({
        id: "identity-session",
        metadata: { workspaceRoot: workspace, userId: "integration-user" },
      });
      const toolEvents: string[] = [];
      void (async () => {
        for await (const event of session.subscribe({ acrossRuns: true })) {
          if (event.type.startsWith("tool_")) toolEvents.push(event.type);
        }
      })();

      await session.run("change the note");

      assert.equal(readFileSync(join(workspace, "note.txt"), "utf8"), "two\n", "the edit must be applied");
      assert.ok(toolEvents.includes("tool_execution_finished"), `expected a finished tool call, got ${toolEvents.join(",")}`);
      assert.ok(!toolEvents.includes("tool_execution_blocked"), "the local identity must not block durable effects");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
