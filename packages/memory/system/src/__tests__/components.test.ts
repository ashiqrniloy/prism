/**
 * Plan 216 Task 6: the memory system's components (`stm`, `wm`, `rehearsal`, `ltm`, `sleep`), fail-closed composition,
 * the partial-use profiles, the `memory.system` service, and "a component that is off loads and registers nothing".
 */
import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createAgent, definePackage, PackageLoadError, validateJsonSchema } from "@arnilo/prism";
import memoryCompaction from "@arnilo/prism-extensions/compaction";
import memorySystem, {
  MEMORY_LTM_SERVICE,
  MEMORY_SYSTEM_SERVICE,
  type MemorySystemConfig,
  MemorySystemError,
  type MemorySystemService,
  memorySystemConfigSchema,
  resolveMemorySystemComponents,
} from "../index.js";

const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const PACKAGE = "@arnilo/prism-memory-system";
const MODEL = { provider: "mock", model: "m" } as const;

async function loadError(config: MemorySystemConfig): Promise<PackageLoadError> {
  try {
    const agent = await createAgent({ model: MODEL, packages: [memorySystem(config)] });
    await agent.dispose();
  } catch (error) {
    assert.ok(error instanceof PackageLoadError, String(error));
    return error;
  }
  return assert.fail("expected createAgent to refuse the config");
}

/** Reads the services the memory system provides, once the agent has a session. */
function serviceProbe() {
  const seen: { system?: MemorySystemService; ltm?: unknown } = {};
  const probe = definePackage({
    name: "@test/memory-system-probe",
    version: "0.0.0",
    requires: { api: 1 },
    setup(prism) {
      prism.hooks.on("session.opened", () => {
        seen.system = prism.services.consume<MemorySystemService>(MEMORY_SYSTEM_SERVICE);
        seen.ltm = prism.services.consume(MEMORY_LTM_SERVICE);
      });
    },
  })();
  return { probe, seen };
}

describe("memory-system components", () => {
  it("component_dependencies_fail_closed_with_named_error", async () => {
    const cases: readonly [MemorySystemConfig, string, string][] = [
      [{ stm: false, wm: {} }, "wm", "stm"],
      [{ wm: false, rehearsal: {}, ltm: {} }, "rehearsal", "wm"],
      [{ rehearsal: {} }, "rehearsal", "ltm"],
      [{ sleep: {} }, "sleep", "ltm"],
    ];
    for (const [config, component, needs] of cases) {
      const error = await loadError(config);
      assert.equal(error.code, "setup_failed");
      assert.equal(error.package, PACKAGE);
      assert.match(error.message, new RegExp(`memory_system_component_missing: memory-system component "${component}" needs "${needs}"`));
      // The same check without an agent.
      assert.throws(
        () => resolveMemorySystemComponents(config),
        (thrown: unknown) => thrown instanceof MemorySystemError && thrown.code === "memory_system_component_missing",
      );
    }
    // Omitted components resolve instead of failing: rehearsal waits for wm and ltm, wm follows stm.
    assert.deepEqual(resolveMemorySystemComponents({}), { stm: true, wm: true, rehearsal: false, ltm: false, sleep: false });
    assert.deepEqual(resolveMemorySystemComponents({ stm: false }), { stm: false, wm: false, rehearsal: false, ltm: false, sleep: false });
    assert.deepEqual(resolveMemorySystemComponents({ ltm: {} }), { stm: true, wm: true, rehearsal: true, ltm: true, sleep: false });
    assert.deepEqual(resolveMemorySystemComponents({ ltm: {}, wm: false }), {
      stm: true,
      wm: false,
      rehearsal: false,
      ltm: true,
      sleep: false,
    });
  });

  it("component_config_accepts_false_and_keeps_named_key_errors", () => {
    for (const component of ["stm", "wm", "rehearsal", "ltm", "sleep"])
      assert.ok(validateJsonSchema(memorySystemConfigSchema, { [component]: false }).ok, `${component}: false`);
    // Omitted, a component stays null (resolved by the components rule), not materialised from its fields' defaults.
    const defaults = validateJsonSchema(memorySystemConfigSchema, {});
    for (const component of ["stm", "wm", "rehearsal", "ltm", "sleep"])
      assert.equal((defaults.value as Record<string, unknown>)[component], null);
    for (const [config, path] of [
      [{ stm: { bogus: 1 } }, "/stm"],
      [{ sleep: { maxModelCalls: 40 } }, "/sleep"],
      [{ ltm: { bogus: 1 } }, "/ltm"],
    ] as const) {
      const result = validateJsonSchema(memorySystemConfigSchema, config);
      assert.equal(result.ok, false);
      assert.ok(
        result.errors.some((error) => error.rule === "unknown_key" && error.path === path),
        JSON.stringify(result.errors),
      );
    }
    assert.equal(validateJsonSchema(memorySystemConfigSchema, { stm: true }).ok, false, "true is not a component value");
  });

  it("disabled_component_registers_nothing", async () => {
    // Every component off: no hook, tool, command, slot claim or capability. Only the memory.system service remains.
    const { probe, seen } = serviceProbe();
    const off = await createAgent({ model: MODEL, packages: [memorySystem({ stm: false }), probe] });
    try {
      const inspection = off.inspect();
      assert.deepEqual(
        inspection.tools.filter((tool) => tool.package === PACKAGE),
        [],
      );
      assert.deepEqual(
        inspection.commands.filter((command) => command.package === PACKAGE),
        [],
      );
      assert.deepEqual(
        Object.values(inspection.hooks).flatMap((hooks) => hooks.filter((hook) => hook.owner === PACKAGE)),
        [],
      );
      assert.equal(inspection.slots.compaction, "kernel");
      assert.deepEqual(inspection.packages.find((entry) => entry.name === PACKAGE)?.capabilities, []);
      await off.session({ id: "s", create: true });
      assert.equal(seen.ltm, undefined);
      assert.deepEqual(seen.system?.status().components, { stm: false, wm: false, rehearsal: false, ltm: false, sleep: false });
    } finally {
      await off.dispose();
    }

    // stm: false beside another compaction package: no slot claim, so no conflict and no assignment needed.
    const beside = await createAgent({ model: MODEL, packages: [memorySystem({ stm: false, ltm: {} }), memoryCompaction()] });
    try {
      assert.equal(beside.inspect().slots.compaction, "@arnilo/prism-extensions/compaction");
      assert.ok(!beside.inspect().tools.some((tool) => tool.name === "recall"));
    } finally {
      await beside.dispose();
    }

    // ltm: false: no memory.* tool and no memory.ltm service.
    const session = serviceProbe();
    const noLtm = await createAgent({ model: MODEL, packages: [memorySystem({ ltm: false }), session.probe] });
    try {
      assert.deepEqual(
        noLtm
          .inspect()
          .tools.filter((tool) => tool.name.startsWith("memory."))
          .map((tool) => tool.name),
        [],
      );
      await noLtm.session({ id: "s", create: true });
      assert.equal(session.seen.ltm, undefined);
      assert.ok(
        !noLtm
          .inspect()
          .packages.find((entry) => entry.name === PACKAGE)
          ?.capabilities.includes("credentials"),
      );
    } finally {
      await noLtm.dispose();
    }
  });

  it("service_methods_not_yet_available_answer_named_error", async () => {
    const { probe, seen } = serviceProbe();
    const agent = await createAgent({ model: MODEL, packages: [memorySystem({ ltm: {} }), probe] });
    try {
      await agent.session({ id: "s", create: true });
      const service = seen.system;
      assert.ok(service);
      assert.deepEqual(service.status().components, { stm: true, wm: true, rehearsal: true, ltm: true, sleep: false });
      // setScope answers since plan 218 Task 1 (session/__tests__/scope.test.ts).
      for (const [method, plan] of [
        ["endEpisode", 218],
        ["rehearse", 219],
        ["sleep", 221],
      ] as const) {
        await assert.rejects(
          // `rehearse({ only: "wm" })` answers since plan 218 Task 2; any other call still waits for plan 219.
          (service[method] as (...args: readonly unknown[]) => Promise<unknown>)(),
          (error: unknown) =>
            error instanceof MemorySystemError && error.code === "not_available_yet" && error.message.includes(`plan ${plan}`),
        );
      }
    } finally {
      await agent.dispose();
    }
  });

  it("four_profiles_run_end_to_end_on_mock_provider", () => {
    const result = spawnSync(process.execPath, ["examples/memory-system.ts", "--json"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 120_000,
    });
    assert.equal(result.status, 0, result.stderr);
    const reports = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "[]") as {
      profile: string;
      components: Record<string, boolean>;
      observations: number;
      wmItems: number;
      dropped: number;
      facts: number;
      compactionOwner: string;
    }[];
    assert.deepEqual(reports.map((report) => report.profile).sort(), ["full", "ltm", "session", "stm"]);
    const of = (profile: string) => {
      const report = reports.find((entry) => entry.profile === profile);
      assert.ok(report, profile);
      return report;
    };
    const enabled = (profile: string) =>
      Object.entries(of(profile).components)
        .filter(([, on]) => on)
        .map(([name]) => name);
    assert.deepEqual(enabled("ltm"), ["ltm"]);
    assert.deepEqual(enabled("session"), ["stm", "wm"]);
    assert.deepEqual(enabled("stm"), ["stm"]);
    assert.deepEqual(enabled("full"), ["stm", "wm", "rehearsal", "ltm", "sleep"]);
    // The example asserts each profile's surface itself; these are the outcomes that make each profile work.
    const [ltm, session, stm, full] = ["ltm", "session", "stm", "full"].map(of);
    assert.equal(ltm?.facts, 1);
    assert.equal(ltm?.observations, 0);
    assert.ok(session && session.observations > 0 && session.wmItems > 0);
    assert.ok(stm && stm.observations > 0 && stm.wmItems === 0);
    assert.ok(full && full.wmItems > 0 && full.dropped > 0 && full.facts === 1);
  });
});

/** Runs `script` in a fresh process and returns which watched modules it loaded. */
function loadedModules(config: MemorySystemConfig): { session: string[]; ltm: string[]; pg: boolean } {
  const script = `
    const { createAgent } = await import("@arnilo/prism");
    const memorySystem = (await import("@arnilo/prism-memory-system")).default;
    const agent = await createAgent({ model: { provider: "mock", model: "m" }, packages: [memorySystem(${JSON.stringify(config)})] });
    await (await agent.session({ id: "s", create: true })).close();
    await agent.dispose();
    const keys = Object.keys(require.cache ?? {});
    const SESSION = /memory\\/system\\/src\\/session\\/(setup|flush|compactor|commands|recall-tool|context-cache|workers\\/)/;
    const LTM = /memory\\/system\\/src\\/ltm\\/index\\.ts$|memory\\/core\\/src\\/postgres\\/index\\.ts$/;
    console.log(JSON.stringify({
      session: keys.filter((key) => SESSION.test(key)),
      ltm: keys.filter((key) => LTM.test(key)),
      pg: keys.some((key) => key.includes("node_modules/pg/")),
    }));`;
  const result = spawnSync(process.execPath, ["-e", script], { cwd: REPO_ROOT, encoding: "utf8", timeout: 60_000 });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}");
}

describe("memory-system loads only listed components", () => {
  it("ltm_only_profile_loads_no_session_code", () => {
    const ltmOnly = loadedModules({ stm: false, ltm: {} });
    assert.deepEqual(ltmOnly.session, [], "no session-tier runtime module is loaded");
    assert.ok(
      ltmOnly.ltm.some((key) => key.endsWith("ltm/index.ts")),
      "the probe sees long-term memory's setup",
    );
    // The probe can observe session code once the component is on.
    assert.ok(loadedModules({ ltm: {} }).session.some((key) => key.includes("session/setup")));
  });

  it("stm_only_profile_loads_no_ltm_store_driver", () => {
    const stmOnly = loadedModules({ stm: {}, wm: false });
    assert.deepEqual(stmOnly.ltm, [], "no long-term memory setup or store driver module is loaded");
    assert.equal(stmOnly.pg, false);
    assert.ok(
      stmOnly.session.some((key) => key.includes("session/setup")),
      "the probe sees the session tiers",
    );
  });
});
