import assert from "node:assert/strict";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import type { SessionEntry } from "@arnilo/prism";
import { createExtensionKernel } from "@arnilo/prism/testing/extension-conformance";
import { childEnv } from "../cli.js";
import { createGraftExtension, deepProviderEnv } from "../extension.js";
import { GRAFT_STATE_TYPE, resolveLatestGraftState } from "../state.js";

const fixtureRoot = resolve(import.meta.dirname, "../../../fixtures/graft-package-fixture");

function memoryStore() {
  const entries: SessionEntry[] = [];
  return {
    entries,
    appendEntry: async (entry: SessionEntry) => {
      entries.push(entry);
    },
    getEntries: (): readonly SessionEntry[] => entries,
  };
}

interface LoadedKernel {
  kernel: ReturnType<typeof createExtensionKernel>;
  store: ReturnType<typeof memoryStore>;
  statusEvents: Array<Record<string, unknown>>;
}

async function loadGraft(optionsOverrides: Record<string, unknown> = {}): Promise<LoadedKernel> {
  const store = memoryStore();
  const kernel = createExtensionKernel({ errorPolicy: "throw" });
  const statusEvents: Array<Record<string, unknown>> = [];
  kernel.events.on("graft:status", (event) => {
    if (event.type === "graft:status") statusEvents.push({ ...(event.metadata as Record<string, unknown>) });
  });
  await kernel.load([
    createGraftExtension({
      packageRoot: fixtureRoot,
      projectDir: fixtureRoot,
      ...store,
      ...optionsOverrides,
    } as never),
  ]);
  return { kernel, store, statusEvents };
}

describe("graft commands", () => {
  it("registers_skill_and_four_commands", async () => {
    const { kernel } = await loadGraft();
    assert.ok(kernel.registries.skills.get("graft"));
    for (const name of ["graft", "graft-build", "graft-check", "graft-viz"]) {
      assert.ok(kernel.registries.commands.get(name), `missing command ${name}`);
    }
  });

  it("status_is_offline_from_persisted_state_and_reports_unknown_freshness", async () => {
    const { kernel, store } = await loadGraft();
    const result = await kernel.registries.commands.get("graft")!.execute({ text: "status" }, { sessionId: "s1" });
    const text = result.content?.[0]?.type === "text" ? result.content[0].text : "";
    assert.ok(text.includes("freshness unknown"), text);
    assert.equal(store.entries.length, 0, "offline status must not write state");
  });

  it("graft_check_runs_live_persists_state_and_status_reports_it", async () => {
    const { kernel, store } = await loadGraft();
    await kernel.registries.commands.get("graft-check")!.execute({}, { sessionId: "s1" });
    const state = resolveLatestGraftState(store.entries);
    assert.equal(state?.type, GRAFT_STATE_TYPE);
    assert.equal(state?.lastCheck?.fresh, true);
    await kernel.registries.commands.get("graft")!.execute({ text: "status" }, { sessionId: "s1" });
    // restore path: fresh store rebuilt from entries reports persisted freshness
    const restored = resolveLatestGraftState(store.entries)?.lastCheck;
    assert.equal(restored?.fresh, true);
  });

  it("graft_status_check_flag_triggers_live_call", async () => {
    const { kernel, store } = await loadGraft();
    await kernel.registries.commands.get("graft")!.execute({ text: "status", check: true }, { sessionId: "s1" });
    assert.ok(resolveLatestGraftState(store.entries)?.lastCheck);
  });

  it("viz_defaults_to_no_open_and_honors_open_true", async () => {
    const { kernel } = await loadGraft({ timeoutMs: 4000 });
    const closed = await kernel.registries.commands.get("graft-viz")!.execute({}, { sessionId: "s1" });
    assert.deepEqual(closed.value, { args: ["viz", "--no-open"] });
    const opened = await kernel.registries.commands.get("graft-viz")!.execute({ open: true, port: 4321 }, { sessionId: "s1" });
    assert.deepEqual(opened.value, { args: ["viz", "--port", "4321"] });
  });

  it("emits_graft_status_events_and_respects_hideStatus", async () => {
    const visible = await loadGraft();
    await visible.kernel.registries.commands.get("graft-check")!.execute({}, { sessionId: "s1" });
    assert.ok(visible.statusEvents.some((event) => event.event === "check"));

    const hidden = await loadGraft({ hideStatus: true });
    await hidden.kernel.registries.commands.get("graft-check")!.execute({}, { sessionId: "s1" });
    assert.equal(hidden.statusEvents.length, 0);
  });

  it("unknown_subcommand_reports_error_without_throwing", async () => {
    const { kernel } = await loadGraft();
    const result = await kernel.registries.commands.get("graft")!.execute({ text: "explode" }, {});
    assert.ok(result.error);
  });

  it("registers_graft_init_and_graft_build_deep", async () => {
    const { kernel } = await loadGraft();
    assert.ok(kernel.registries.commands.get("graft-init"));
    assert.ok(kernel.registries.commands.get("graft-build-deep"));
  });

  it("graft_init_without_agents_or_yes_errors_without_spawn", async () => {
    const { kernel } = await loadGraft();
    const result = await kernel.registries.commands.get("graft-init")!.execute({}, { sessionId: "s1" });
    assert.match(result.error?.message ?? "", /initAgents or initYes/);
  });

  it("graft_init_passes_no_global_and_host_agents", async () => {
    const { kernel } = await loadGraft({ initAgents: ["codex"] });
    const result = await kernel.registries.commands.get("graft-init")!.execute({}, { sessionId: "s1" });
    assert.ok(!result.error, result.error?.message ?? "");
    const stdout = (result.value as { stdout: string }).stdout;
    assert.match(stdout, /--no-global/);
    assert.match(stdout, /--no-mcp --no-hooks --no-statusline/);
    assert.match(stdout, /--agents codex/);
    assert.ok(!stdout.includes("--yes"));
  });

  it("graft_build_uses_runGraftExit_and_does_not_require_json", async () => {
    const { kernel } = await loadGraft();
    const result = await kernel.registries.commands.get("graft-build")!.execute({}, { sessionId: "s1" });
    assert.ok(!result.error, result.error?.message ?? "");
    assert.match((result.value as { stdout: string }).stdout, /structural build ok/);
  });

  it("graft_build_deep_without_model_fails_closed", async () => {
    const { kernel } = await loadGraft();
    const result = await kernel.registries.commands.get("graft-build-deep")!.execute({}, { sessionId: "s1" });
    assert.match(result.error?.message ?? "", /deepModel/);
  });

  it("graft_build_deep_passes_provider_model_baseurl_argv_and_api_key_env_only", async () => {
    const { kernel } = await loadGraft({
      deepModel: { provider: "openai", model: "gpt-4o-mini", apiKey: "sk-test", baseUrl: "https://openrouter.ai/api/v1" },
    });
    // The main command's deep:true path shares the same code as the alias.
    const viaMain = await kernel.registries.commands.get("graft")!.execute({ text: "build", deep: true }, { sessionId: "s1" });
    assert.ok(!viaMain.error, viaMain.error?.message ?? "");
    const viaAlias = await kernel.registries.commands.get("graft-build-deep")!.execute({}, { sessionId: "s1" });
    assert.ok(!viaAlias.error, viaAlias.error?.message ?? "");
    const stdout = (viaAlias.value as { stdout: string }).stdout;
    assert.match(stdout, /argv: build --deep --provider openai --model gpt-4o-mini --base-url https:\/\/openrouter\.ai\/api\/v1/);
    assert.match(stdout, /env: GRAFT_API_KEY,GRAFT_BASE_URL,GRAFT_MODEL,GRAFT_PROVIDER/);
    assert.ok(!stdout.includes("--api-key"), "api key must never ride argv");
    assert.ok(!stdout.includes("sk-test"));
  });

  it("graft_build_deep_does_not_inherit_process_env_secrets", () => {
    process.env.GRAFT_API_KEY = "leaked-from-process";
    process.env.SECRET_SENTINEL = "do-not-propagate";
    try {
      const env = childEnv({ providerEnv: deepProviderEnv({ provider: "anthropic", model: "m", apiKey: "sk-host" }, undefined) });
      assert.equal(env.GRAFT_API_KEY, "sk-host");
      assert.equal(env.SECRET_SENTINEL, undefined);
    } finally {
      delete process.env.GRAFT_API_KEY;
      delete process.env.SECRET_SENTINEL;
    }
  });
});
