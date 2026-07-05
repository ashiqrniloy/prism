import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { composeSystemPrompt, mergeSystemPromptConfig } from "../system-prompts.js";

void describe("system prompts", () => {
  it("compose_system_prompt_appends_prepends_and_replaces_in_order", () => {
    // Phase 31 rank: user(0) → package(1) → app(2) → run(3); user is the global base layer (SYSTEM.md).
    const prompt = composeSystemPrompt([
      { id: "run", source: "run", mode: "append", text: "Run" },
      { id: "pkg", source: "package", mode: "append", text: "Package" },
      { id: "app", source: "app", mode: "replace", text: "App" },
      { id: "user", source: "user", mode: "prepend", text: "User" },
    ], { base: "Base" });

    // user prepends onto Base, package appends, app replaces everything, run appends.
    assert.equal(prompt, "App\n\nRun");
  });

  it("disable clears earlier layers before higher-ranked appends", () => {
    // disable must outrank the layers it clears. Unknown custom sources rank before app/run,
    // so a run-source disable clears them too.
    assert.equal(composeSystemPrompt([
      { id: "app", source: "app", text: "App" },
      { id: "off", source: "run", mode: "disable", text: "" },
      { id: "after", source: "post", text: "After" },
    ], { base: "Base" }), undefined);
  });

  it("unknown source replace cannot override run replace", () => {
    assert.equal(composeSystemPrompt([
      { id: "run", source: "run", mode: "replace", text: "Run wins" },
      { id: "custom", source: "custom", mode: "replace", text: "Custom loses" },
    ]), "Run wins");
  });

  it("unknown sources keep stable input order before app and run", () => {
    assert.equal(composeSystemPrompt([
      { id: "run", source: "run", text: "Run" },
      { id: "second", source: "custom-b", text: "Second" },
      { id: "app", source: "app", text: "App" },
      { id: "first", source: "custom-a", text: "First" },
    ], { base: "Base" }), "Base\n\nSecond\n\nFirst\n\nApp\n\nRun");
  });

  it("run override can disable configured layers while keeping base instructions", () => {
    const merged = mergeSystemPromptConfig({ id: "app", source: "app", text: "App" }, false);
    assert.equal(composeSystemPrompt(merged, { base: "Base" }), "Base");
  });
});
