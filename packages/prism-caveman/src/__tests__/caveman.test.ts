import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { createSessionEntry, parseSkillFile } from "@arnilo/prism";
import { createExtensionKernel } from "@arnilo/prism/testing/extension-conformance";

import { readCavemanConfig, writeCavemanConfig } from "../config.js";
import { createCavemanExtension } from "../extension.js";
import { CAVEMAN_LEVEL_TYPE, isDeactivationCommand, resolveLevelFromEntries } from "../mode.js";
import { buildCavemanInstructions, filterSkillBodyForLevel } from "../prompts.js";
import { CAVEMAN_SKILL_NAMES, loadUpstreamSkills } from "../skills.js";
import { MAX_CONFIG_FILE_BYTES } from "../upstream.js";

const fixtureRoot = resolve(import.meta.dirname, "../../fixtures/upstream-full");
const minimalRoot = resolve(import.meta.dirname, "../../fixtures/upstream-minimal");

function sessionCallbacks(entries: ReturnType<typeof createSessionEntry>[] = []) {
  const store = [...entries];
  return {
    entries: store,
    appendEntry: async (entry: ReturnType<typeof createSessionEntry>) => {
      store.push(entry);
    },
    getEntries: () => store,
  };
}

describe("caveman skills", () => {
  it("loadUpstreamSkills_matches_upstream_skill_bodies", () => {
    const skills = loadUpstreamSkills(fixtureRoot);
    for (const name of CAVEMAN_SKILL_NAMES) {
      const skill = skills.find((item) => item.name === name);
      assert.ok(skill, `missing ${name}`);
      const upstreamText = readFileSync(join(fixtureRoot, "skills", name, "SKILL.md"), "utf8");
      const expected = parseSkillFile(upstreamText, join(fixtureRoot, "skills", name, "SKILL.md"));
      assert.equal(skill.instructions, expected.instructions);
    }
  });
});

describe("caveman mode and prompts", () => {
  it("buildCavemanInstructions_includes_ultra_slice", () => {
    const text = buildCavemanInstructions(fixtureRoot, "ultra");
    assert.ok(text);
    assert.match(text!, /CAVEMAN MODE ACTIVE — level: ultra/);
    assert.match(text!, /\*\*ultra\*\*/);
    assert.doesNotMatch(text!, /\*\*lite\*\*/);
  });

  it("filterSkillBodyForLevel_keeps_only_active_example", () => {
    const body = "x\n- lite: lite example\n- ultra: ultra example\n";
    const filtered = filterSkillBodyForLevel(body, "ultra");
    assert.match(filtered, /ultra example/);
    assert.doesNotMatch(filtered, /lite example/);
  });

  it("isDeactivationCommand_matches_stop_phrases", () => {
    assert.equal(isDeactivationCommand("stop caveman"), true);
    assert.equal(isDeactivationCommand("normal mode"), true);
    assert.equal(isDeactivationCommand("add a normal mode toggle"), false);
  });

  it("resolveLevelFromEntries_uses_latest_custom_entry", () => {
    const entries = [
      createSessionEntry({
        sessionId: "s1",
        kind: "custom",
        data: { type: CAVEMAN_LEVEL_TYPE, level: "lite" },
      }),
      createSessionEntry({
        sessionId: "s1",
        kind: "custom",
        data: { type: CAVEMAN_LEVEL_TYPE, level: "ultra" },
      }),
    ];
    assert.equal(resolveLevelFromEntries(entries), "ultra");
  });
});

describe("caveman config", () => {
  it("writeCavemanConfig_is_bounded", () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-caveman-config-"));
    try {
      const configPath = join(dir, "config.json");
      writeCavemanConfig(configPath, { defaultLevel: "lite", showStatus: true });
      assert.equal(readCavemanConfig(configPath).defaultLevel, "lite");
      writeFileSync(configPath, "x".repeat(MAX_CONFIG_FILE_BYTES + 1));
      assert.throws(() => readCavemanConfig(configPath));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("caveman extension wiring", () => {
  it("setup_registers_skills_commands_and_injector", async () => {
    const kernel = createExtensionKernel({ errorPolicy: "throw" });
    const session = sessionCallbacks();
    await kernel.load([
      createCavemanExtension({
        upstreamPath: fixtureRoot,
        defaultLevel: "off",
        ...session,
      }),
    ]);
    assert.equal(kernel.registries.skills.list().length, CAVEMAN_SKILL_NAMES.length);
    assert.ok(kernel.registries.commands.get("caveman"));
    assert.ok(kernel.registries.commands.get("caveman-commit"));
    assert.ok(kernel.registries.instructionInjectors.get("caveman-mode"));
  });

  it("caveman_command_sets_level_and_persists", async () => {
    const kernel = createExtensionKernel({ errorPolicy: "throw" });
    const session = sessionCallbacks();
    await kernel.load([
      createCavemanExtension({
        upstreamPath: fixtureRoot,
        defaultLevel: "off",
        ...session,
      }),
    ]);
    const command = kernel.registries.commands.get("caveman");
    assert.ok(command);
    const result = await command.execute({ level: "ultra" }, { sessionId: "s1" });
    assert.equal((result.value as { level: string }).level, "ultra");
    const custom = session.entries.find((entry) => entry.kind === "custom");
    assert.ok(custom);
    assert.equal((custom.data as { level: string }).level, "ultra");
  });

  it("alias_command_dispatches_skill_name", async () => {
    const kernel = createExtensionKernel({ errorPolicy: "throw" });
    await kernel.load([
      createCavemanExtension({
        upstreamPath: fixtureRoot,
        defaultLevel: "off",
        ...sessionCallbacks(),
      }),
    ]);
    const command = kernel.registries.commands.get("caveman-commit");
    assert.ok(command);
    const result = await command.execute({}, { sessionId: "s1" });
    assert.equal((result.value as { skill: string }).skill, "caveman-commit");
  });

  it("deactivation_stops_injection", async () => {
    const kernel = createExtensionKernel({ errorPolicy: "throw" });
    await kernel.load([
      createCavemanExtension({
        upstreamPath: fixtureRoot,
        defaultLevel: "off",
        ...sessionCallbacks([
          createSessionEntry({
            sessionId: "s1",
            kind: "custom",
            data: { type: CAVEMAN_LEVEL_TYPE, level: "ultra" },
          }),
        ]),
      }),
    ]);
    const injector = kernel.registries.instructionInjectors.get("caveman-mode");
    assert.ok(injector);
    const active = injector.apply({
      sessionId: "s1",
      runId: "r1",
      turn: 1,
      input: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      history: [],
      metadata: {},
      signal: new AbortController().signal,
    });
    assert.ok(active.instructions);

    const deactivated = injector.apply({
      sessionId: "s1",
      runId: "r1",
      turn: 2,
      input: [{ role: "user", content: [{ type: "text", text: "stop caveman" }] }],
      history: [],
      metadata: {},
      signal: new AbortController().signal,
    });
    assert.equal(deactivated.instructions, undefined);
  });

  it("minimal_fixture_fails_setup_without_all_skills", async () => {
    const kernel = createExtensionKernel({ errorPolicy: "throw" });
    await assert.rejects(() =>
      kernel.load([
        createCavemanExtension({
          upstreamPath: minimalRoot,
          defaultLevel: "off",
          ...sessionCallbacks(),
        }),
      ]),
    );
  });
});
