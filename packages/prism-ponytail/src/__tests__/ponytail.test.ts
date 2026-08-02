import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import { createSessionEntry, parseSkillFile } from "@arnilo/prism";
import { createExtensionKernel } from "@arnilo/prism/testing/extension-conformance";

import { readPonytailConfig, writePonytailDefaultMode } from "../config.js";
import { createPonytailExtension } from "../extension.js";
import { buildPonytailInstructions } from "../instructions.js";
import { PONYTAIL_MODE_TYPE, resolveModeFromEntries } from "../mode.js";
import { PONYTAIL_SKILL_NAMES, loadUpstreamSkills } from "../skills.js";
import { loadUpstreamHooks } from "../upstream-hooks.js";
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

describe("ponytail skills", () => {
  it("loadUpstreamSkills_matches_upstream_skill_bodies", () => {
    const skills = loadUpstreamSkills(fixtureRoot);
    for (const name of PONYTAIL_SKILL_NAMES) {
      const skill = skills.find((item) => item.name === name);
      assert.ok(skill, `missing ${name}`);
      const upstreamText = readFileSync(join(fixtureRoot, "skills", name, "SKILL.md"), "utf8");
      const expected = parseSkillFile(upstreamText, join(fixtureRoot, "skills", name, "SKILL.md"));
      assert.equal(skill.instructions, expected.instructions);
    }
  });
});

describe("ponytail mode and instructions", () => {
  const hooks = loadUpstreamHooks(fixtureRoot);

  it("buildPonytailInstructions_uses_upstream_lite_slice", () => {
    const text = buildPonytailInstructions(hooks.instructions, "lite");
    assert.ok(text);
    assert.match(text!, /PONYTAIL MODE ACTIVE — level: lite/);
    const filtered = hooks.instructions.filterSkillBodyForMode(readFileSync(join(fixtureRoot, "skills/ponytail/SKILL.md"), "utf8"), "lite");
    assert.ok(filtered.length > 0);
    assert.match(text!, new RegExp(filtered.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("isDeactivationCommand_matches_stop_phrases", () => {
    assert.equal(hooks.config.isDeactivationCommand("stop ponytail"), true);
    assert.equal(hooks.config.isDeactivationCommand("normal mode"), true);
    assert.equal(hooks.config.isDeactivationCommand("add a normal mode toggle"), false);
  });

  it("resolveModeFromEntries_uses_latest_custom_entry", () => {
    const entries = [
      createSessionEntry({
        sessionId: "s1",
        kind: "custom",
        data: { type: PONYTAIL_MODE_TYPE, mode: "lite" },
      }),
      createSessionEntry({
        sessionId: "s1",
        kind: "custom",
        data: { type: PONYTAIL_MODE_TYPE, mode: "ultra" },
      }),
    ];
    assert.equal(resolveModeFromEntries(entries), "ultra");
  });
});

describe("ponytail config", () => {
  it("writePonytailDefaultMode_is_bounded", () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-ponytail-config-"));
    try {
      const configPath = join(dir, "config.json");
      writePonytailDefaultMode(configPath, "lite");
      assert.equal(readPonytailConfig(configPath).defaultMode, "lite");
      writeFileSync(configPath, "x".repeat(MAX_CONFIG_FILE_BYTES + 1));
      assert.throws(() => readPonytailConfig(configPath));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ponytail extension wiring", () => {
  it("setup_registers_skills_commands_and_injector", async () => {
    const kernel = createExtensionKernel({ errorPolicy: "throw" });
    await kernel.load([
      createPonytailExtension({
        upstreamPath: fixtureRoot,
        defaultMode: "off",
        quietStartup: true,
        ...sessionCallbacks(),
      }),
    ]);
    assert.equal(kernel.registries.skills.list().length, PONYTAIL_SKILL_NAMES.length);
    assert.ok(kernel.registries.commands.get("ponytail"));
    assert.ok(kernel.registries.commands.get("ponytail-review"));
    assert.ok(kernel.registries.instructionInjectors.get("ponytail-mode"));
  });

  it("ponytail_command_sets_mode_and_persists", async () => {
    const kernel = createExtensionKernel({ errorPolicy: "throw" });
    const session = sessionCallbacks();
    await kernel.load([
      createPonytailExtension({
        upstreamPath: fixtureRoot,
        defaultMode: "off",
        quietStartup: true,
        ...session,
      }),
    ]);
    const command = kernel.registries.commands.get("ponytail");
    assert.ok(command);
    const result = await command.execute({ mode: "lite" }, { sessionId: "s1" });
    assert.equal((result.value as { mode: string }).mode, "lite");
    const custom = session.entries.find((entry) => entry.kind === "custom");
    assert.ok(custom);
    assert.equal((custom.data as { mode: string }).mode, "lite");
  });

  it("ponytail_status_command_reports_mode", async () => {
    const kernel = createExtensionKernel({ errorPolicy: "throw" });
    await kernel.load([
      createPonytailExtension({
        upstreamPath: fixtureRoot,
        defaultMode: "full",
        quietStartup: true,
        ...sessionCallbacks([
          createSessionEntry({
            sessionId: "s1",
            kind: "custom",
            data: { type: PONYTAIL_MODE_TYPE, mode: "ultra" },
          }),
        ]),
      }),
    ]);
    const command = kernel.registries.commands.get("ponytail");
    assert.ok(command);
    const result = await command.execute({ text: "status" }, { sessionId: "s1" });
    const block = result.content?.[0];
    assert.ok(block && block.type === "text");
    assert.match((block as { text: string }).text, /current ultra/);
  });

  it("alias_command_dispatches_skill_name", async () => {
    const kernel = createExtensionKernel({ errorPolicy: "throw" });
    await kernel.load([
      createPonytailExtension({
        upstreamPath: fixtureRoot,
        defaultMode: "off",
        quietStartup: true,
        ...sessionCallbacks(),
      }),
    ]);
    const command = kernel.registries.commands.get("ponytail-audit");
    assert.ok(command);
    const result = await command.execute({}, { sessionId: "s1" });
    assert.equal((result.value as { skill: string }).skill, "ponytail-audit");
  });

  it("deactivation_stops_injection", async () => {
    const kernel = createExtensionKernel({ errorPolicy: "throw" });
    await kernel.load([
      createPonytailExtension({
        upstreamPath: fixtureRoot,
        defaultMode: "off",
        quietStartup: true,
        ...sessionCallbacks([
          createSessionEntry({
            sessionId: "s1",
            kind: "custom",
            data: { type: PONYTAIL_MODE_TYPE, mode: "full" },
          }),
        ]),
      }),
    ]);
    const injector = kernel.registries.instructionInjectors.get("ponytail-mode");
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
      input: [{ role: "user", content: [{ type: "text", text: "stop ponytail" }] }],
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
        createPonytailExtension({
          upstreamPath: minimalRoot,
          defaultMode: "off",
          quietStartup: true,
          ...sessionCallbacks(),
        }),
      ]),
    );
  });

  it("no_statusline_shell_spawn", async () => {
    const kernel = createExtensionKernel({ errorPolicy: "throw" });
    await kernel.load([
      createPonytailExtension({
        upstreamPath: fixtureRoot,
        defaultMode: "full",
        quietStartup: true,
        ...sessionCallbacks(),
      }),
    ]);
    assert.equal(kernel.registries.commands.get("ponytail-statusline"), undefined);
  });
});
