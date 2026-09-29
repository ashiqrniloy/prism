import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { PrismCodeWikiConfig } from "../config.js";
import { validatePrismCodeConfig } from "../config.js";
import { MemoryStoredCredentialStore, PrismCodeCredentialManager } from "../credentials.js";
import { resolveExecutablePath, resolveInstalledCommand, resolveWebTools } from "../web.js";
import { createWikiFetchHook, resolveWikiContributions, resolveWikiSettings } from "../wiki.js";

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `prism-code-web-${prefix}-`));
}

function manager(): PrismCodeCredentialManager {
  return new PrismCodeCredentialManager({ store: new MemoryStoredCredentialStore() });
}

function withEnv(name: string, value: string | undefined, fn: () => Promise<void>): Promise<void> {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  return fn().finally(() => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  });
}

describe("web backend resolution", () => {
  it("web off registers no tools", async () => {
    const tempDir = makeTempDir("off");
    try {
      const resolution = await resolveWebTools({ cwd: tempDir, web: "off" }, manager());
      assert.strictEqual(resolution.mode, "off");
      assert.strictEqual(resolution.enabled, false);
      assert.strictEqual(resolution.tools.length, 0);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("configured obscura executable registers standard tools; native tools need explicit opt-in", async () => {
    const tempDir = makeTempDir("obscura");
    try {
      const binary = join(tempDir, "obscura");
      writeFileSync(binary, "#!/bin/sh\nexit 0\n");
      chmodSync(binary, 0o755);

      const standard = await resolveWebTools({ cwd: tempDir, web: { mode: "obscura", command: binary } }, manager());
      assert.deepStrictEqual(standard.toolNames, ["web_search", "web_fetch"]);

      const native = await resolveWebTools({ cwd: tempDir, web: { mode: "obscura", command: binary, nativeTools: true } }, manager());
      assert.ok(native.toolNames.includes("obscura_fetch"));
      assert.ok(native.toolNames.includes("obscura_scrape"));
      assert.strictEqual(new Set(native.toolNames).size, native.toolNames.length);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("missing obscura omits both tools and reports a setup hint (no silent invocation failure)", async () => {
    const tempDir = makeTempDir("missing");
    try {
      const configured = await resolveWebTools(
        { cwd: tempDir, web: { mode: "obscura", command: "/nonexistent/prism-test-obscura" } },
        manager(),
      );
      assert.strictEqual(configured.tools.length, 0);
      assert.ok(configured.notes.some((note) => note.includes("not an executable file")));

      await withEnv("PATH", "", async () => {
        const resolved = await resolveWebTools({ cwd: tempDir }, manager());
        assert.strictEqual(resolved.mode, "off");
        assert.strictEqual(resolved.tools.length, 0);
        assert.deepStrictEqual(resolved.notes, [], "implicit missing Obscura must not warn on launch");
        assert.ok(resolved.unavailableReason?.includes("PATH"));
        const explicit = await resolveWebTools({ cwd: tempDir, web: "obscura" }, manager());
        assert.strictEqual(explicit.mode, "obscura");
        assert.ok(explicit.notes.some((note) => note.includes("PATH")));
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("resolves an installed obscura from absolute PATH entries only", async () => {
    const tempDir = makeTempDir("path");
    try {
      const binary = join(tempDir, "obscura");
      writeFileSync(binary, "#!/bin/sh\nexit 0\n");
      chmodSync(binary, 0o755);

      await withEnv("PATH", tempDir, async () => {
        const resolved = resolveInstalledCommand("obscura");
        assert.ok(resolved);
        assert.ok(isAbsolute(resolved));
        assert.strictEqual(resolved, binary);
        const tools = await resolveWebTools({ cwd: tempDir }, manager());
        assert.deepStrictEqual(tools.toolNames, ["web_search", "web_fetch"]);
      });

      assert.strictEqual(resolveExecutablePath("obscura"), undefined);
      assert.strictEqual(resolveInstalledCommand("../obscura"), undefined);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("brave mode without a firecrawl backend registers web_search only and says so", async () => {
    const tempDir = makeTempDir("brave-no-fetch");
    try {
      await withEnv("FIRECRAWL_API_KEY", undefined, async () => {
        const resolution = await resolveWebTools({ cwd: tempDir, web: "brave" }, manager());
        assert.deepStrictEqual(resolution.toolNames, ["web_search"]);
        assert.ok(resolution.notes.some((note) => note.includes("Firecrawl")));
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("brave mode with a firecrawl credential registers search and fetch with no credential leak", async () => {
    const tempDir = makeTempDir("brave-fetch");
    try {
      await withEnv("FIRECRAWL_API_KEY", "fc-secret-test-key", async () => {
        const resolution = await resolveWebTools({ cwd: tempDir, web: "brave" }, manager());
        assert.deepStrictEqual(resolution.toolNames, ["web_search", "web_fetch"]);
        assert.strictEqual(new Set(resolution.toolNames).size, resolution.toolNames.length);
        assert.strictEqual(JSON.stringify(resolution.tools).includes("fc-secret-test-key"), false);
      });

      await withEnv("FIRECRAWL_API_KEY", "fc-secret-test-key", async () => {
        const disabled = await resolveWebTools({ cwd: tempDir, web: { mode: "brave", fetchBackend: "off" } }, manager());
        assert.deepStrictEqual(disabled.toolNames, ["web_search"]);
        assert.ok(disabled.notes.some((note) => note.includes("web_search only")));
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("config parsing rejects relative obscura paths and stale fetchBackend values", () => {
    assert.throws(() => validatePrismCodeConfig({ web: { command: "obscura" } }), /absolute path/);
    assert.throws(() => validatePrismCodeConfig({ web: { fetchBackend: "curl" } }), /fetchBackend/);
    assert.throws(() => validatePrismCodeConfig({ wiki: { autoDeploySkills: "yes" } }), /autoDeploySkills/);

    const parsed = validatePrismCodeConfig({
      web: { mode: "brave", fetchBackend: "off", nativeTools: true },
      wiki: { enabled: true, autoDeploySkills: true },
    });
    assert.deepStrictEqual(parsed.web, { mode: "brave", fetchBackend: "off", nativeTools: true });
    assert.strictEqual((parsed.wiki as { autoDeploySkills?: boolean }).autoDeploySkills, true);
  });
});

describe("wiki contributions", () => {
  it("wiki disabled is truly inert for every config shape", async () => {
    const tempDir = makeTempDir("wiki-off");
    const shapes: (PrismCodeWikiConfig | undefined)[] = [undefined, false, "off", { enabled: false }];
    try {
      for (const wiki of shapes) {
        const contributions = await resolveWikiContributions({ cwd: tempDir, ...(wiki === undefined ? {} : { wiki }) });
        assert.strictEqual(contributions.enabled, false);
        assert.strictEqual(
          contributions.tools.length +
            contributions.skills.length +
            contributions.commands.length +
            contributions.instructionInjectors.length,
          0,
        );
        assert.strictEqual(contributions.fetchUrl, undefined);
      }
      assert.strictEqual(resolveWikiSettings(undefined).enabled, false);
      assert.strictEqual(resolveWikiSettings({ enabled: false }).enabled, false);
      assert.strictEqual(resolveWikiSettings("on").enabled, true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("wiki enabled registers tools, skills, commands and the instruction injector without deploying skills by default", async () => {
    const tempDir = makeTempDir("wiki-on");
    try {
      const contributions = await resolveWikiContributions({ cwd: tempDir, wiki: true });
      assert.strictEqual(contributions.enabled, true);
      assert.deepStrictEqual(contributions.tools.map((tool) => tool.name).sort(), [
        "wiki_ingest",
        "wiki_read_page",
        "wiki_record_insight",
        "wiki_search",
      ]);
      assert.deepStrictEqual(contributions.commands.map((command) => command.name).sort(), [
        "wiki-ingest",
        "wiki-init",
        "wiki-lint",
        "wiki-refresh",
      ]);
      assert.deepStrictEqual(contributions.skills.map((skill) => skill.name).sort(), ["wiki-maintainer", "wiki-searcher"]);
      assert.ok(contributions.instructionInjectors.some((injector) => injector.name === "wiki-guidance"));
      assert.strictEqual(existsSync(join(tempDir, ".agents")), false, "skills must not deploy without explicit opt-in");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("wiki skill auto-deploy happens only on explicit opt-in", async () => {
    const tempDir = makeTempDir("wiki-deploy");
    try {
      const contributions = await resolveWikiContributions({
        cwd: tempDir,
        wiki: { enabled: true, autoDeploySkills: true },
      });
      assert.strictEqual(contributions.autoDeploySkills, true);
      assert.ok(existsSync(join(tempDir, ".agents", "skills")), "opt-in deployment writes wiki skills");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("wiki fetchUrl hook reuses web_fetch, SSRF-checks first, and fails closed without a backend", async () => {
    assert.strictEqual(createWikiFetchHook([]), undefined);

    let calls = 0;
    const fakeFetch = {
      name: "web_fetch",
      description: "test fetch",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      async execute(_args: Record<string, unknown>, context: { toolCallId: string }) {
        calls++;
        return { toolCallId: context.toolCallId, name: "web_fetch", value: { markdown: "# Fetched" } };
      },
    };
    const hook = createWikiFetchHook([fakeFetch as never]);
    if (!hook) throw new Error("expected a wiki fetch hook");

    const fetched = await hook({ url: "https://example.com/docs/page.html" });
    assert.strictEqual(fetched?.text, "# Fetched");
    assert.strictEqual(fetched?.filename, "page.html");
    assert.strictEqual(calls, 1);

    await assert.rejects(() => hook({ url: "http://127.0.0.1/private" }), /public HTTP\(S\)/);
    assert.strictEqual(calls, 1, "SSRF-denied URL never reaches the fetch backend");
  });

  it("wiki contributions reuse the selected web plane's fetch hook when available", async () => {
    const tempDir = makeTempDir("wiki-hook");
    const binary = join(tempDir, "obscura");
    try {
      writeFileSync(binary, "#!/bin/sh\nexit 0\n");
      chmodSync(binary, 0o755);
      const web = await resolveWebTools({ cwd: tempDir, web: { mode: "obscura", command: binary } }, manager());
      const contributions = await resolveWikiContributions({ cwd: tempDir, wiki: true }, { webTools: web.tools });
      assert.ok(contributions.fetchUrl);

      const noWeb = await resolveWikiContributions({ cwd: tempDir, wiki: true });
      assert.strictEqual(noWeb.fetchUrl, undefined, "URL ingest fails closed without a web backend");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
