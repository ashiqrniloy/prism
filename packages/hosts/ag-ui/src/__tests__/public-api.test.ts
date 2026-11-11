import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Host libraries may import only allow-listed names from the kernel root and a small set of peers. */
const ALLOWED_PACKAGES = new Set(["@arnilo/prism", "@arnilo/prism-extensions/mcp"]);
const FORBIDDEN_KERNEL_NAMES = new Set([
  "createAgent",
  "createAgentRunLifecycle",
  "AgentRunLifecycle",
  "AgentRunRef",
  "AgentRunStatusResult",
  "dispatchToolCall",
  "createToolRegistry",
  "assertPermission",
  "PermissionPolicy",
  "createRunLimitTracker",
  "ToolEffectStore",
  "ToolRegistry",
  "ToolExecutionContext",
  "ToolDefinition",
]);

function sourceFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      out.push(...sourceFiles(path));
    } else if (entry.name.endsWith(".ts")) {
      out.push(path);
    }
  }
  return out;
}

function namedImports(content: string, specifier: string): string[] {
  const names: string[] = [];
  const pattern = new RegExp(`import\\s+(?:type\\s+)?\\{([^}]*)\\}\\s+from\\s+["']${specifier.replace("/", "\\/")}["']`, "g");
  for (const match of content.matchAll(pattern)) {
    for (const part of match[1].split(",")) {
      const name = part
        .replace(/^\s*type\s+/, "")
        .trim()
        .split(/\s+as\s+/)[0]
        ?.trim();
      if (name) names.push(name);
    }
  }
  return names;
}

describe("ag_ui_host_library_uses_public_api", () => {
  it("imports only allow-listed kernel names and never constructs an agent", () => {
    const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..");
    const allowlist = JSON.parse(readFileSync(join(srcDir, "../../../../scripts/host-surface-allowlist.json"), "utf8")) as Record<
      string,
      readonly string[]
    >;
    const allowed = new Set([...allowlist.frozen, ...allowlist.phase11, ...(allowlist.phase16 ?? [])]);
    for (const file of sourceFiles(srcDir)) {
      const content = readFileSync(file, "utf8");
      for (const [, specifier] of content.matchAll(/(?:from|import)\s*\(?\s*["'](@arnilo\/[^"']+)["']/g)) {
        const pkg = specifier.startsWith("@arnilo/prism-extensions/mcp/") ? "@arnilo/prism-extensions/mcp" : specifier;
        assert.ok(ALLOWED_PACKAGES.has(pkg), `${file} imports non-public external package: ${specifier}`);
      }
      for (const name of namedImports(content, "@arnilo/prism")) {
        assert.ok(allowed.has(name), `${file} imports a kernel-internal name: ${name}`);
        assert.ok(!FORBIDDEN_KERNEL_NAMES.has(name), `${file} imports a forbidden kernel name: ${name}`);
      }
      for (const [, specifier] of content.matchAll(/(?:from|import)\s+["'](\.\.\/\.\.[^"']+)["']/g)) {
        assert.equal(specifier, "../../package.json", `${file} has a relative import escaping the host library: ${specifier}`);
      }
      assert.ok(!/\bcreateAgent\s*\(/.test(content), `${file} constructs an agent`);
    }
  });
});
