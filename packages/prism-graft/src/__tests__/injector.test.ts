import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import type { Message } from "@arnilo/prism";

import {
  createGraftContextProvider,
  createGraftOrientationInjector,
  formatPointerPack,
  latestUserText,
  loadOrientation,
  MIN_PROMPT_CHARS,
  nextSeen,
  ORIENTATION_MAX_BYTES,
  SEEN_CAP,
  type SeenState,
  shouldQuery,
} from "../injector.js";

const userTurn = (text: string): Message[] => [{ role: "user", content: [{ type: "text", text }] }];

const askPayload = {
  nodes: [
    { id: "n1", title: "ExtensionKernel", kind: "class", path: "src/kernel.ts", line: 12 },
    { id: "n2", title: "loadExtensions", path: "src/kernel.ts", line: 40 },
    { id: "n3", title: "ToolRegistry", path: "src/tools.ts", line: 8 },
  ],
};

describe("graft push gates (pure)", () => {
  it("skips_short_oversize_and_missing_prompts", () => {
    assert.equal(shouldQuery(undefined), false);
    assert.equal(shouldQuery(""), false);
    assert.equal(shouldQuery("too short"), false);
    assert.equal(shouldQuery("x".repeat(MIN_PROMPT_CHARS)), true);
    assert.equal(shouldQuery("a reasonable question about the kernel"), true);
    assert.equal(shouldQuery("y".repeat(10_000), { maxPromptChars: 512 }), false);
  });

  it("latestUserText_reads_last_user_message_text_blocks", () => {
    const messages: Message[] = [
      { role: "user", content: [{ type: "text", text: "first" }] },
      { role: "assistant", content: [{ type: "text", text: "reply" }] },
      { role: "user", content: [{ type: "text", text: "how does context assembly work here?" }] },
    ];
    assert.match(latestUserText(messages)!, /context assembly/);
  });
});

describe("pointer pack formatter (pure)", () => {
  it("formats_pointers_only_with_locators_and_wikilinks", () => {
    const pack = formatPointerPack(askPayload, new Set());
    assert.equal(pack.blocks.length, 1);
    const body = pack.blocks[0]!.content as string;
    assert.match(body, /ExtensionKernel \(class\) — src\/kernel\.ts:12 — \[\[n1\]\]/);
    // pointers-only invariant: no fenced source bodies
    assert.ok(!body.includes("```"));
    assert.equal(pack.freshIds.length, 3);
  });

  it("drops_seen_nodes_and_reports_saved_tokens_when_nothing_remains", () => {
    const seen = new Set(["n1", "n2", "n3"]);
    const pack = formatPointerPack(askPayload, seen);
    assert.deepEqual(pack.blocks, []);
    assert.deepEqual(pack.freshIds, []);
    assert.ok(pack.savedTokensApprox > 0);
  });

  it("handles_unknown_payload_shapes_without_throwing", () => {
    assert.deepEqual(formatPointerPack(null, new Set()).blocks, []);
    assert.deepEqual(formatPointerPack({ unexpected: true }, new Set()).blocks, []);
  });
});

describe("seen-set cap (pure)", () => {
  it("evicts_oldest_beyond_cap", () => {
    let state: SeenState = { ids: new Set<string>(), savedTokensApprox: 0 };
    for (let index = 0; index < SEEN_CAP + 1; index += 1) {
      state = { ids: new Set(nextSeen(state, [`id${index}`])), savedTokensApprox: 0 };
    }
    assert.equal(state.ids.size, SEEN_CAP);
    assert.equal(state.ids.has("id0"), false); // oldest evicted
    assert.equal(state.ids.has(`id${SEEN_CAP}`), true); // newest retained
  });
});

describe("orientation loader + injector", () => {
  const dir = mkdtempSync(join(tmpdir(), "graft-orient-"));
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("returns_undefined_for_missing_index", () => {
    assert.equal(loadOrientation(join(dir, "graft", "INDEX.md"), undefined), undefined);
  });

  it("caps_index_at_8kib_and_prepends_staleness_banner", () => {
    const graftDir = join(dir, "graft");
    mkdirSync(graftDir, { recursive: true });
    writeFileSync(join(graftDir, "INDEX.md"), "z".repeat(ORIENTATION_MAX_BYTES + 100));
    const capped = loadOrientation(join(dir, "graft", "INDEX.md"), undefined)!;
    assert.ok(Buffer.byteLength(capped, "utf8") <= ORIENTATION_MAX_BYTES);
    assert.match(capped, /\(truncated\)$/);

    writeFileSync(join(graftDir, "INDEX.md"), "# Orientation\ngraph overview.");
    const stale = loadOrientation(join(dir, "graft", "INDEX.md"), {
      checkedAt: new Date().toISOString(),
      fresh: false,
      missing: 2,
      stale: 1,
    })!;
    assert.match(stale, /\[graft\] graph may be stale \(3 missing\/stale entries\)/);
    assert.match(stale, /# Orientation/);
  });

  it("injector_emits_first_turn_instructions_only_when_orientation_exists", () => {
    const present = createGraftOrientationInjector(() => "# Orientation");
    assert.equal(present.apply({} as never).when, "first_turn");
    assert.equal(present.apply({} as never).instructions, "# Orientation");

    const absent = createGraftOrientationInjector(() => undefined);
    const contribution = absent.apply({} as never);
    assert.equal(contribution.when, "first_turn");
    assert.equal(contribution.instructions, undefined);
  });
});

describe("context provider shell", () => {
  it("gates_before_spawning_and_aborts_cleanly", async () => {
    let asked = 0;
    const provider = createGraftContextProvider({
      runAsk: async () => {
        asked += 1;
        return askPayload;
      },
      getSeen: async () => ({ ids: new Set<string>(), savedTokensApprox: 0 }),
      onEmitted: () => {},
    });

    assert.deepEqual(await provider.resolve({ messages: [{ role: "user", content: [{ type: "text", text: "short" }] }] }), []);
    assert.equal(asked, 0);

    const blocks = await provider.resolve({ messages: userTurn("walk me through the extension kernel setup") });
    assert.equal(blocks.length, 1);
    assert.equal(asked, 1);

    // failure ⇒ empty contribution
    const failing = createGraftContextProvider({
      runAsk: async () => null,
      getSeen: async () => ({ ids: new Set<string>(), savedTokensApprox: 0 }),
      onEmitted: () => {},
    });
    assert.deepEqual(await failing.resolve({ messages: userTurn("another reasonable retrieval prompt") }), []);

    // throw inside runAsk also degrades to empty
    const throwing = createGraftContextProvider({
      runAsk: async () => {
        throw new Error("aborted");
      },
      getSeen: async () => ({ ids: new Set<string>(), savedTokensApprox: 0 }),
      onEmitted: () => {},
    });
    assert.deepEqual(await throwing.resolve({ messages: userTurn("one more reasonable retrieval prompt") }), []);
  });

  it("dedups_across_turns_via_seen_state_and_persists_emissions", async () => {
    const seen = new Set<string>();
    let persisted: readonly string[] | undefined;
    const provider = createGraftContextProvider({
      runAsk: async () => askPayload,
      getSeen: async () => ({ ids: seen, savedTokensApprox: 0 }),
      onEmitted: (freshIds) => {
        for (const id of freshIds) seen.add(id);
        persisted = freshIds;
      },
    });

    const first = await provider.resolve({ messages: userTurn("explain the kernel wiring end to end") });
    assert.equal(first.length, 1);
    assert.equal(persisted!.length, 3);

    const second = await provider.resolve({ messages: userTurn("now explain the kernel wiring again please") });
    assert.deepEqual(second, []); // all nodes already shown this session
  });
});

import { resolve } from "node:path";
import { createExtensionKernel } from "@arnilo/prism";
import { createGraftExtension, shouldRegisterPushSurface } from "../extension.js";
import type { GraftExtensionOptions } from "../types.js";

const sessionCallbacks = () => ({
  appendEntry: async () => {},
  getEntries: () => [],
});

const fixtureRoot = resolve(import.meta.dirname, "../../fixtures/graft-package-fixture");

describe("push surface wiring", () => {
  it("registers_provider_on_skill_and_orientation_injector_in_push_mode", async () => {
    const kernel = createExtensionKernel({ errorPolicy: "throw" });
    await kernel.load([
      createGraftExtension({
        packageRoot: fixtureRoot,
        projectDir: fixtureRoot,
        mode: "push",
        quietStartup: true,
        ...sessionCallbacks(),
      } as GraftExtensionOptions),
    ]);
    const skill = kernel.registries.skills.get("graft")!;
    assert.equal(skill.context?.length, 1);
    assert.equal(skill.context![0]!.name, "graft-context");
    assert.ok(kernel.registries.instructionInjectors.get("graft-orient"), "orientation injector missing");
    assert.equal(kernel.registries.tools.list().length, 0); // push-only: no pull tools
    assert.equal(kernel.registries.commands.get("graft-build") !== undefined, true);
  });

  it("pull_mode_registers_neither_push_surface_piece", async () => {
    const kernel = createExtensionKernel({ errorPolicy: "throw" });
    await kernel.load([
      createGraftExtension({
        packageRoot: fixtureRoot,
        projectDir: fixtureRoot,
        quietStartup: true,
        ...sessionCallbacks(),
      } as GraftExtensionOptions),
    ]);
    assert.equal(kernel.registries.skills.get("graft")!.context, undefined);
    assert.equal(kernel.registries.instructionInjectors.get("graft-orient"), undefined);
  });

  it("shouldRegisterPushSurface_matches_plan_matrix", () => {
    assert.deepEqual(
      (["pull", "push", "both", "off"] as const).map((mode) => shouldRegisterPushSurface(mode as import("../types.js").GraftMode)),
      [false, true, true, false],
    );
  });
});
