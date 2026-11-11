import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const VENDOR = /\b(claude|codex|agy|antigravity|gemini)\b/i;
const STALE_VENDOR_DRIVER = /prism-driver-(?:claude-code|codex|antigravity|\{)/;

function tsFiles(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const full = join(path, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : tsFiles(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

describe("driver kit stays vendor-neutral", () => {
  it("driver_kit_names_no_vendor", () => {
    // Documentation is intentionally outside this scan: docs/agent-adapters.md and the package README are the
    // only places allowed to name vendors. The scan stays on the kit, the adapter sources, and the host libraries.
    const files = [
      ...tsFiles("src/driver-kit"),
      ...tsFiles("examples/adapters"),
      ...tsFiles("packages/hosts/driver-process/src"),
      ...tsFiles("src/testing"),
      ...readdirSync("src")
        .filter((name) => name === "cli-relay.ts" || name.startsWith("relay"))
        .map((name) => join("src", name)),
      ...tsFiles("packages/hosts/mcp-server/src").filter((file) => /serve-tools.*\.ts$/.test(file)),
      ...tsFiles("packages/tools/coding/src").filter((file) => /workspace.*\.ts$/.test(file)),
    ];
    const hits = files.filter((file) => VENDOR.test(readFileSync(file, "utf8")));
    assert.deepEqual(hits, [], `vendor names in kit sources:\n${hits.join("\n")}`);
  });

  it("driver_kit_not_loaded_by_root_entry", () => {
    const seen = new Set<string>();
    const queue = ["src/index.ts"];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file) || !existsSync(file)) continue;
      seen.add(file);
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/(?:from\s*|import\s*\(\s*)["'](\.[^"']+)["']/g)) {
        const target = join(file, "..", match[1]!.replace(/\.js$/, ".ts"));
        queue.push(existsSync(target) ? target : join(file, "..", match[1]!.replace(/\.js$/, ""), "index.ts"));
      }
    }
    const leaked = [...seen].filter((file) => file.startsWith("src/driver-kit/"));
    assert.deepEqual(leaked, []);
  });

  it("no_stale_vendor_driver_package_names", () => {
    const roots = ["src", "packages", "apps", "scripts", "examples", "docs", "PRODUCT.md", "README.md"];
    const skipDirs = new Set(["node_modules", ".git", "dist", "plans", "history", "_evidence"]);
    const files: string[] = [];
    const walk = (path: string) => {
      if (!existsSync(path)) return;
      if (statSync(path).isDirectory()) {
        if (skipDirs.has(basename(path))) return;
        for (const entry of readdirSync(path)) walk(join(path, entry));
        return;
      }
      if (/\.(?:ts|tsx|js|mjs|cjs|json|md|mdx)$/.test(path)) files.push(path);
    };
    for (const root of roots) walk(root);
    const hits = files.filter((file) => STALE_VENDOR_DRIVER.test(readFileSync(file, "utf8")));
    assert.deepEqual(hits, [], `stale vendor driver package names:\n${hits.join("\n")}`);
  });
});
