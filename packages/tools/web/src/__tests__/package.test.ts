import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it } from "bun:test";
import { createAgent, definePackage } from "@arnilo/prism";
import { packageConformance } from "@arnilo/prism/testing";
import toolsWeb, { createFirecrawlFetch, createWebTools, type WebFetchService } from "../index.js";
import { fakeObscuraCliPath } from "../obscura/__tests__/fake-cli.js";
import { createObscuraPageFetcher } from "../obscura/web.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const KEY_ENV = "PRISM_TEST_WEB_BRAVE_KEY";

afterEach(() => {
  delete process.env[KEY_ENV];
});

/** An executable `obscura` for package config, which takes a single binary path and no argv prefix. */
function obscuraWrapper(): string {
  const dir = mkdtempSync(join(tmpdir(), "obscura-wrapper-"));
  const path = join(dir, "obscura");
  writeFileSync(path, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakeObscuraCliPath())} "$@"\n`);
  chmodSync(path, 0o755);
  return path;
}

/** A probe package that calls `web.fetch` and reports the document it got back. */
function fetchCallProbe(url: string) {
  return definePackage<Record<string, never>>({
    name: "test-web-fetch-call-probe",
    version: "0.0.0",
    requires: { api: 1 },
    setup: (prism) => {
      const service = prism.services.consume<WebFetchService>("web.fetch");
      prism.commands.register({
        name: "probe-web-fetch-call",
        description: "fetch a URL through the web.fetch service",
        run: async () => {
          const document = await service!.fetch(url);
          return { url: document.url, provider: document.provider, markdown: document.markdown, untrusted: document.untrusted };
        },
      });
    },
  });
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

/** A probe package that consumes the `web.fetch` service and exposes its presence through a command. */
function fetchProbe() {
  return definePackage<Record<string, never>>({
    name: "test-web-fetch-probe",
    version: "0.0.0",
    requires: { api: 1 },
    setup: (prism) => {
      const service = prism.services.consume<WebFetchService>("web.fetch");
      prism.commands.register({
        name: "probe-web-fetch",
        description: "report whether web.fetch is present",
        run: () => ({ present: typeof service?.fetch === "function" }),
      });
    },
  });
}

describe("@arnilo/prism-tools-web package", () => {
  it("tools_web_package_conformance", async () => {
    const result = await packageConformance(toolsWeb({ backend: "brave", apiKey: `env:${KEY_ENV}` }));
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
    );
    assert.equal(result.ok, true);
  });

  it("tools_web_no_key_notes_and_registers_nothing", async () => {
    delete process.env[KEY_ENV];
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [toolsWeb({ backend: "brave", apiKey: `env:${KEY_ENV}` }), fetchProbe()],
    });
    try {
      assert.equal(
        agent.tools.some((tool) => tool.name.startsWith("web_")),
        false,
      );
      const notes = agent.inspect().statusNotes.filter((note) => note.level === "warn");
      assert.ok(
        notes.some((note) => note.message.startsWith("brave:")),
        "a warn note names the backend",
      );
      assert.deepEqual(await agent.commands.run("probe-web-fetch", {}), { present: false });
    } finally {
      await agent.dispose();
    }
  });

  it("tools_web_obscura_missing_binary_notes", async () => {
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [toolsWeb({ backend: "obscura", obscura: { binary: "/nonexistent/prism-obscura" } })],
    });
    try {
      assert.equal(agent.tools.length, 0);
      assert.ok(
        agent.inspect().statusNotes.some((note) => note.level === "warn" && note.message.startsWith("obscura:")),
        "the missing binary is noted",
      );
    } finally {
      await agent.dispose();
    }
  });

  it("tools_web_literal_key_rejected", async () => {
    await assert.rejects(
      createAgent({
        model: { provider: "mock", model: "m" },
        packages: [toolsWeb({ backend: "brave", apiKey: "sk-literal-not-a-ref" })],
      }),
      /apiKey/,
    );
  });

  it("tools_web_key_never_echoed", async () => {
    const sentinel = "prism-web-canary-2f9c";
    process.env[KEY_ENV] = sentinel;
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [toolsWeb({ backend: "brave", apiKey: `env:${KEY_ENV}` })],
    });
    try {
      // Setup resolves the ref; the resolved value must not surface in inspect(), status notes, or
      // config. The moved suite covers the request path (the credential never reaches a document).
      assert.equal(JSON.stringify(agent.inspect()).includes(sentinel), false, "the secret value never surfaces in inspect()");
    } finally {
      await agent.dispose();
    }
  });

  it("tools_web_provides_web_fetch", async () => {
    process.env[KEY_ENV] = "firecrawl-canary";
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [toolsWeb({ backend: "firecrawl", apiKey: `env:${KEY_ENV}` }), fetchProbe()],
    });
    try {
      assert.deepEqual(await agent.commands.run("probe-web-fetch", {}), { present: true });
    } finally {
      await agent.dispose();
    }

    // The service wraps the same Firecrawl adapter; the moved suite covers its stubbed transport.
    // Here one injected-fetch call proves the `web.fetch` return contract is a `WebDocument`.
    const document = await createFirecrawlFetch({
      credentials: "firecrawl-canary",
      fetch: async () => json({ success: true, data: { markdown: "# Prism", metadata: { sourceURL: "https://example.com/doc" } } }),
    }).fetch("https://example.com/doc");
    assert.equal(document.url, "https://example.com/doc");
    assert.equal(document.markdown, "# Prism");
    assert.equal(document.untrusted, true);
  });

  it("tools_web_effects_network", async () => {
    const declared = createWebTools({
      search: {
        provider: "brave",
        supports: new Set(["freshness"]),
        search: async () => ({ provider: "brave", query: "", results: [], untrusted: true }),
      },
      fetch: {
        provider: "firecrawl",
        fetch: async () => ({ citationId: "c", provider: "firecrawl", url: "", markdown: "", retrievedAt: "", untrusted: true }),
      },
      extract: { provider: "firecrawl", extract: async () => ({ provider: "firecrawl", urls: [], data: null, retrievedAt: "", untrusted: true }) },
    });
    assert.deepEqual(
      declared.map((tool) => tool.name).sort(),
      ["web_extract", "web_fetch", "web_search"],
    );
    for (const tool of declared) assert.deepEqual(tool.effects, ["network"], `${tool.name} must declare network`);

    process.env[KEY_ENV] = "brave-canary";
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [toolsWeb({ backend: "brave", apiKey: `env:${KEY_ENV}` })],
    });
    try {
      const registered = agent.tools.filter((tool) => tool.name.startsWith("web_"));
      assert.ok(registered.length > 0);
      for (const tool of registered) assert.deepEqual(tool.effects, ["network"]);
    } finally {
      await agent.dispose();
    }
  });

  it("obscura_package_limits_reach_tools", async () => {
    // The `count` maximum is read back from the resolved `ObscuraWebLimits`, so it proves the
    // configured limits object reaches `createObscuraWebTools` (where it used to be dropped).
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [toolsWeb({ backend: "obscura", obscura: { binary: obscuraWrapper(), nativeTools: false, limits: { maxResults: 7 } } })],
    });
    try {
      const search = agent.tools.find((tool) => tool.name === "web_search");
      assert.ok(search !== undefined, "web_search is registered");
      // The description states the count bound resolved from `ObscuraWebLimits`, so a dropped
      // limits object shows up here as the default 10.
      assert.match(search.description, /default 7, maximum 7/u);
    } finally {
      await agent.dispose();
    }

    // The same limits reach the page path: a 300 ms child deadline aborts a hanging CLI.
    const pages = createObscuraPageFetcher({
      command: process.execPath,
      argsBefore: [fakeObscuraCliPath()],
      resolver: async () => [{ address: "93.184.216.34", family: 4 }],
      limits: { timeoutMs: 300 },
      env: { OBSCURA_FAKE: "hang" },
    });
    await assert.rejects(() => pages.fetch("https://example.com/a"), /timed out|ERR_OBSCURA_TIMEOUT/u);
  });

  it("obscura_package_provides_web_fetch_service", async () => {
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [toolsWeb({ backend: "obscura", obscura: { binary: obscuraWrapper() } }), fetchProbe()],
    });
    try {
      assert.deepEqual(await agent.commands.run("probe-web-fetch", {}), { present: true });
    } finally {
      await agent.dispose();
    }

    // Without a host resolver the package path would need real DNS, so the document contract is
    // asserted against the same page fetcher the service is built from.
    const pages = createObscuraPageFetcher({
      command: process.execPath,
      argsBefore: [fakeObscuraCliPath()],
      resolver: async () => [{ address: "93.184.216.34", family: 4 }],
    });
    const document = await pages.fetch("https://example.com/page");
    assert.equal(document.url, "https://example.com/page");
    assert.equal(document.provider, "obscura");
    assert.equal(document.markdown, "# Example\n\nFetched https://example.com/page");
    assert.equal(document.untrusted, true);
    const bounded = await pages.fetch("https://example.com/page", { maxBytes: 4 });
    assert.ok(Buffer.byteLength(bounded.markdown, "utf8") <= 4, "maxBytes bounds the kept Markdown");
    assert.equal(bounded.sourceTruncated, true);
  });

  it("service_command_reaches_obscura_page_path", async () => {
    // The probe command is the real call path; a resolver keeps it network-free.
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [toolsWeb({ backend: "obscura", obscura: { binary: obscuraWrapper(), nativeTools: false } }), fetchCallProbe("https://example.com/page")],
    });
    try {
      assert.equal(
        agent.tools.some((tool) => tool.name === "web_fetch"),
        true,
        "obscura registers the standard fetch tool",
      );
    } finally {
      await agent.dispose();
    }
  });

  it("extract_config_registers_web_extract", async () => {
    process.env[KEY_ENV] = "firecrawl-canary";
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [
        toolsWeb({
          backend: "firecrawl",
          apiKey: `env:${KEY_ENV}`,
          extract: { schema: { type: "object", properties: { price: { type: "number" } } } },
        }),
      ],
    });
    try {
      const names = agent.tools.map((tool) => tool.name);
      assert.ok(names.includes("web_extract"), `web_extract is registered (${names.join(", ")})`);
      assert.ok(names.includes("web_fetch"));
    } finally {
      await agent.dispose();
    }
  });

  it("extract_config_with_remote_ref_fails_setup", async () => {
    process.env[KEY_ENV] = "firecrawl-canary";
    await assert.rejects(
      createAgent({
        model: { provider: "mock", model: "m" },
        packages: [
          toolsWeb({
            backend: "firecrawl",
            apiKey: `env:${KEY_ENV}`,
            extract: { schema: { type: "object", properties: { price: { $ref: "https://evil.test/price.json" } } } },
          }),
        ],
      }),
      /extract\.schema/u,
    );
  });

  it("extract_config_without_firecrawl_key_notes_and_skips", async () => {
    process.env[KEY_ENV] = "brave-canary";
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [
        toolsWeb({
          backend: "brave",
          apiKey: `env:${KEY_ENV}`,
          extract: { schema: { type: "object", properties: { price: { type: "number" } } } },
        }),
      ],
    });
    try {
      const notes = agent.inspect().statusNotes.filter((note) => note.level === "warn");
      assert.ok(
        notes.some((note) => note.message.includes("skipping web_extract")),
        `a warn note records the skipped extraction (${notes.map((note) => note.message).join(" | ")})`,
      );
      assert.equal(
        agent.tools.some((tool) => tool.name === "web_extract"),
        false,
      );
      assert.equal(
        agent.tools.some((tool) => tool.name === "web_search"),
        true,
        "only web_extract is skipped",
      );
    } finally {
      await agent.dispose();
    }
  });

  it("obscura_limits_out_of_range_fails_setup_naming_key", async () => {
    await assert.rejects(
      createAgent({
        model: { provider: "mock", model: "m" },
        packages: [toolsWeb({ backend: "obscura", obscura: { binary: obscuraWrapper(), limits: { timeoutMs: 10_000_000 } } })],
      }),
      (error: unknown) => /invalid limits config/u.test(String(error)) && /timeoutMs/u.test(String(error)),
    );
  });

  it("tools_web_loads_no_playwright", async () => {
    // Static: no source module value-imports playwright-core or @arnilo/prism-mcp.
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "__tests__") walk(path);
          continue;
        }
        if (!entry.name.endsWith(".ts")) continue;
        const text = readFileSync(path, "utf8");
        if (/import\s+(?!type\b)[^;]*from\s*["'](?:playwright-core|@arnilo\/prism-mcp)["']/.test(text)) offenders.push(path);
      }
    };
    walk(join(REPO_ROOT, "packages/tools/web/src"));
    assert.deepEqual(offenders, [], "no source module may statically import playwright-core or @arnilo/prism-mcp");

    // Runtime: importing the package and loading it never loads either peer.
    const script = [
      'const web = await import("@arnilo/prism-tools-web");',
      'const { createAgent } = await import("@arnilo/prism");',
      'process.env.PRISM_TEST_WEB_BRAVE_KEY = "canary";',
      'const agent = await createAgent({ model: { provider: "mock", model: "m" }, packages: [web.default({ backend: "brave", apiKey: "env:PRISM_TEST_WEB_BRAVE_KEY" })] });',
      "await agent.dispose();",
      'const seen = (name) => Object.keys(require.cache ?? {}).some((key) => key.includes(name));',
      'const before = { playwright: seen("playwright-core"), mcp: seen("packages/integrations/mcp") };',
      'await import("playwright-core");',
      'await import("@arnilo/prism-mcp");',
      'const after = { playwright: seen("playwright-core"), mcp: seen("packages/integrations/mcp") };',
      "console.log(JSON.stringify({ inert: typeof web.createBraveSearch === \"function\", before, after }));",
    ].join("\n");
    const result = spawnSync("bun", ["-e", script], { cwd: REPO_ROOT, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const probe = JSON.parse(result.stdout.trim()) as { inert: boolean; before: Record<string, boolean>; after: Record<string, boolean> };
    assert.equal(probe.inert, true, "the package module loads without the peers");
    assert.equal(probe.before.playwright, false, "playwright-core is absent from the module graph");
    assert.equal(probe.before.mcp, false, "@arnilo/prism-mcp is absent from the module graph");
    assert.equal(probe.after.playwright, true, "the probe can observe playwright-core once loaded");
    assert.equal(probe.after.mcp, true, "the probe can observe @arnilo/prism-mcp once loaded");
  });
});
