import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { composeSystemPrompt, mergeSystemPromptConfig } from "../system-prompts.js";

void describe("system prompts", () => {
  it("compose_system_prompt_appends_prepends_and_replaces_in_order", () => {
    const prompt = composeSystemPrompt([
      { id: "run", source: "run", mode: "append", text: "Run" },
      { id: "pkg", source: "package", mode: "append", text: "Package" },
      { id: "app", source: "app", mode: "replace", text: "App" },
      { id: "user", source: "user", mode: "prepend", text: "User" },
    ], { base: "Base" });

    assert.equal(prompt, "User\n\nApp\n\nRun");
  });

  it("disable clears earlier layers", () => {
    assert.equal(composeSystemPrompt([
      { id: "app", source: "app", text: "App" },
      { id: "off", source: "user", mode: "disable", text: "" },
      { id: "run", source: "run", text: "Run" },
    ], { base: "Base" }), "Run");
  });

  it("run override can disable configured layers while keeping base instructions", () => {
    const merged = mergeSystemPromptConfig({ id: "app", source: "app", text: "App" }, false);
    assert.equal(composeSystemPrompt(merged, { base: "Base" }), "Base");
  });
});
