import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function runtimeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (path.includes("src/__tests__") || path.includes("src/providers/openai-compatible")) return [];
    return statSync(path).isDirectory() ? runtimeFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
}

describe("phase 12 primitive review", () => {
  it("phase12_core_has_no_requested_provider_runtime_branching", () => {
    const text = runtimeFiles("src").map((file) => readFileSync(file, "utf8")).join("\n").toLowerCase();
    for (const forbidden of ["openrouter", "zai", "kimi", "opencode", "openai-codex", "chatgpt", "moonshot"])
      assert.equal(text.includes(forbidden), false, `core runtime source contains provider-specific literal ${forbidden}`);
  });
});
