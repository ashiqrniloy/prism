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

/**
 * An executable `obscura` for package config, which takes a single binary path and no argv prefix.
 * `version` is what the fake reports for `--version` (a version string, `garbage`, or `fail`).
 */
function obscuraWrapper(version?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "obscura-wrapper-"));
  const path = join(dir, "obscura");
  const reported = version === undefined ? "" : `OBSCURA_FAKE_VERSION=${JSON.stringify(version)} `;
  writeFileSync(path, `#!/bin/sh\n${reported}exec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakeObscuraCliPath())} "$@"\n`);
  chmodSync(path, 0o755);
  return path;
}

/** Tool names an `obscura` package registers for a binary reporting `version`. */
async function obscuraToolNames(version?: string): Promise<{ names: string[]; notes: string[]; fetchDescription: string }> {
  const agent = await createAgent({
    model: { provider: "mock", model: "m" },
    packages: [toolsWeb({ backend: "obscura", obscura: { binary: obscuraWrapper(version) } })],
  });
  try {
    return {
      names: agent.tools.map((tool) => tool.name),
      notes: agent
        .inspect()
        .statusNotes.filter((note) => note.level === "warn")
        .map((note) => note.message),
      fetchDescription: agent.tools.find((tool) => tool.name === "web_fetch")?.description ?? "",
    };
  } finally {
    await agent.dispose();
  }
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

/** A probe that reports a tool's argument names, which `agent.tools` does not publish. */
function toolParameterProbe(name: string) {
  return definePackage<Record<string, never>>({
    name: "test-tool-parameter-probe",
    version: "0.0.0",
    requires: { api: 1 },
    setup: (prism) => {
      prism.commands.register({
        name: "probe-tool-parameters",
        description: "report one tool's argument names",
        run: () => {
          const tool = prism.tools.list().find((candidate) => candidate.name === name);
          const properties = (tool?.parameters as { properties?: Record<string, unknown> } | undefined)?.properties ?? {};
          return { arguments: Object.keys(properties) };
        },
      });
    },
  });
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

  it("domain_policy_applies_to_web_fetch_service", async () => {
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [toolsWeb({ backend: "native", domains: { allow: ["allowed.test"] } }), fetchCallProbe("https://blocked.test/page")],
    });
    try {
      await assert.rejects(agent.commands.run("probe-web-fetch-call", {}), /does not permit blocked\.test/u);
    } finally {
      await agent.dispose();
    }
  });

  it("cache_config_exposes_refresh_and_fails_on_a_bad_ttl", async () => {
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [toolsWeb({ backend: "native", cache: { ttlSeconds: 900 } }), toolParameterProbe("web_fetch")],
    });
    try {
      const fetch = agent.tools.find((tool) => tool.name === "web_fetch");
      assert.ok(fetch, "web_fetch is registered");
      const { arguments: names } = (await agent.commands.run("probe-tool-parameters", {})) as { arguments: string[] };
      assert.ok(names.includes("refresh"), `with cache config the model gets a refresh argument (${names.join(", ")})`);
      assert.match(fetch.description ?? "", /refresh: true/u);
      assert.deepEqual(
        agent.inspect().statusNotes.filter((note) => note.level === "warn"),
        [],
        "a valid cache config does not warn",
      );
    } finally {
      await agent.dispose();
    }
    await assert.rejects(
      createAgent({
        model: { provider: "mock", model: "m" },
        packages: [toolsWeb({ backend: "native", cache: { ttlSeconds: 0 } })],
      }),
      /cache[/.]ttlSeconds/u,
    );
  });

  it("new_backend_missing_config_notes_and_registers_nothing", async () => {
    for (const backend of ["tavily", "kagi"] as const) {
      const agent = await createAgent({ model: { provider: "mock", model: "m" }, packages: [toolsWeb({ backend })] });
      try {
        assert.deepEqual(agent.tools, [], `${backend} without a key registers nothing`);
        assert.ok(
          agent.inspect().statusNotes.some((note) => note.level === "warn" && note.message === `${backend}: apiKey ref is required`),
          `${backend} says what is missing`,
        );
      } finally {
        await agent.dispose();
      }
    }
    const agent = await createAgent({ model: { provider: "mock", model: "m" }, packages: [toolsWeb({ backend: "searxng" })] });
    try {
      assert.deepEqual(agent.tools, []);
      assert.ok(
        agent.inspect().statusNotes.some((note) => note.level === "warn" && note.message === "searxng: searxng.origin is required"),
      );
    } finally {
      await agent.dispose();
    }
  });

  it("searxng_registers_search_and_native_fetch_without_a_key", async () => {
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [toolsWeb({ backend: "searxng", searxng: { origin: "https://search.example.org" } }), fetchProbe()],
    });
    try {
      assert.deepEqual(agent.tools.map((tool) => tool.name).sort(), ["web_fetch", "web_search"]);
      assert.deepEqual(
        agent.inspect().statusNotes.filter((note) => note.level === "warn"),
        [],
        "a keyless instance needs no note",
      );
      assert.deepEqual(await agent.commands.run("probe-web-fetch", {}), { present: true });
    } finally {
      await agent.dispose();
    }
  });

  it("tavily_registers_web_search_with_the_resolved_key_kept_out_of_inspect", async () => {
    const sentinel = "tvly-prism-canary-7c1d";
    process.env[KEY_ENV] = sentinel;
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [toolsWeb({ backend: "tavily", apiKey: `env:${KEY_ENV}` })],
    });
    try {
      assert.deepEqual(agent.tools.map((tool) => tool.name).sort(), ["web_fetch", "web_search"]);
      assert.equal(JSON.stringify(agent.inspect()).includes(sentinel), false);
    } finally {
      await agent.dispose();
    }
  });

  it("fetch_prompt_config_exposes_prompt_argument", async () => {
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [toolsWeb({ backend: "native", fetch: { prompt: { model: { provider: "mock", model: "m" } } } }), toolParameterProbe("web_fetch")],
    });
    try {
      const { arguments: names } = (await agent.commands.run("probe-tool-parameters", {})) as { arguments: string[] };
      assert.ok(names.includes("prompt"), `fetch.prompt adds the prompt argument (${names.join(", ")})`);
      assert.match(agent.tools.find((tool) => tool.name === "web_fetch")?.description ?? "", /one extra model call/u);
      assert.ok(!agent.inspect().statusNotes.some((note) => note.level === "warn" && note.message.includes("fetch.prompt")));
    } finally {
      await agent.dispose();
    }
  });

  it("fetch_prompt_with_an_unresolvable_model_warns_and_drops_the_argument", async () => {
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [toolsWeb({ backend: "native", fetch: { prompt: { model: "" } } }), toolParameterProbe("web_fetch")],
    });
    try {
      const { arguments: names } = (await agent.commands.run("probe-tool-parameters", {})) as { arguments: string[] };
      assert.ok(!names.includes("prompt"), "a bad model ref leaves the page-reading path intact");
      assert.ok(
        agent.inspect().statusNotes.some((note) => note.level === "warn" && note.message.startsWith("fetch.prompt:")),
        "and says why",
      );
    } finally {
      await agent.dispose();
    }
  });

  it("domain_policy_rejects_a_malformed_entry_at_setup", async () => {
    await assert.rejects(
      createAgent({
        model: { provider: "mock", model: "m" },
        packages: [toolsWeb({ backend: "native", domains: { allow: ["https://example.com/x"] } })],
      }),
      /invalid domains config: .*bare hostname/u,
    );
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

  it("obscura_fetch_tools_require_guarded_version", async () => {
    const guarded = await obscuraToolNames("0.1.8");
    assert.deepEqual(guarded.names, ["web_search", "web_fetch", "obscura_fetch", "obscura_scrape"]);
    assert.match(guarded.fetchDescription, /Obscura/u, "0.1.8 keeps the browser-backed fetch");
    assert.deepEqual(guarded.notes, [], "a guarded binary needs no note");

    const current = await obscuraToolNames("0.2.5");
    assert.deepEqual(current.names, guarded.names);

    const older = await obscuraToolNames("0.1.7");
    assert.deepEqual(older.names, ["web_search", "web_fetch"], "an unguarded binary loses the Obscura page path");
    assert.ok(!older.fetchDescription.includes("Obscura"), "web_fetch comes from the native backend");
  });

  it("obscura_unverified_version_falls_back_to_native_web_fetch", async () => {
    const dev = await obscuraToolNames("0.2.5-dev+abc123");
    assert.deepEqual(dev.names, ["web_search", "web_fetch"], "a source build is not trusted");
    assert.ok(
      dev.notes.some((note) => /obscura: version unverified/u.test(note) && note.includes("needs 0.1.8+")),
      `the warn note names the fallback: ${JSON.stringify(dev.notes)}`,
    );
    assert.ok(!dev.fetchDescription.includes("Obscura"));

    const older = await obscuraToolNames("0.1.7");
    assert.ok(
      older.notes.some((note) => note.includes("version 0.1.7") && note.includes("native backend")),
      `the note names the probed version: ${JSON.stringify(older.notes)}`,
    );
  });

  it("obscura_probe_failure_falls_back_to_native", async () => {
    const failed = await obscuraToolNames("fail");
    assert.deepEqual(failed.names, ["web_search", "web_fetch"], "a failed probe is the fallback, not a package failure");
    assert.ok(failed.notes.some((note) => note.includes("obscura:") && note.includes("web_fetch")));
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

  it("brave_without_fetch_config_registers_native_web_fetch", async () => {
    process.env[KEY_ENV] = "brave-canary";
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [toolsWeb({ backend: "brave", apiKey: `env:${KEY_ENV}` }), fetchProbe()],
    });
    try {
      const names = agent.tools.map((tool) => tool.name);
      assert.ok(names.includes("web_search"));
      assert.ok(names.includes("web_fetch"), `web_fetch defaults to the keyless native backend (${names.join(", ")})`);
      assert.deepEqual(await agent.commands.run("probe-web-fetch", {}), { present: true });
      assert.equal(
        agent.inspect().statusNotes.filter((note) => note.level === "warn").some((note) => note.message.includes("fetch")),
        false,
        "a native fetch needs no key, so no warn note mentions the fetch backend",
      );
    } finally {
      await agent.dispose();
    }
  });

  it("native_backend_registers_web_fetch_without_a_key", async () => {
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [toolsWeb({ backend: "native" }), fetchProbe()],
    });
    try {
      assert.deepEqual(
        agent.tools.map((tool) => tool.name),
        ["web_fetch"],
        "the native backend is fetch-only",
      );
      assert.deepEqual(await agent.commands.run("probe-web-fetch", {}), { present: true });
      assert.deepEqual(agent.inspect().statusNotes.filter((note) => note.level === "warn"), []);
    } finally {
      await agent.dispose();
    }
  });

  it("native_html_deps_not_loaded_until_first_conversion", async () => {
    // Static: only the converter names the three dependencies, and only dynamically.
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
        if (/import\s+(?!type\b)[^;]*from\s*["'](?:linkedom|turndown|@mozilla\/readability)["']/.test(text)) offenders.push(path);
      }
    };
    walk(join(REPO_ROOT, "packages/tools/web/src"));
    assert.deepEqual(offenders, [], "only native/convert.ts may load the HTML/Markdown dependencies, dynamically");

    const script = [
      'const web = await import("@arnilo/prism-tools-web");',
      'const seen = (name) => Object.keys(require.cache ?? {}).some((key) => key.includes(name));',
      'const before = { linkedom: seen("linkedom"), turndown: seen("turndown"), readability: seen("@mozilla/readability") };',
      'const fetch = web.createNativeFetch({ userAgent: "test", request: async () => new Response("<html><body><article><h1>Hi</h1><p>Body</p></article></body></html>", { status: 200, headers: { "content-type": "text/html" } }) });',
      'const page = await fetch.fetch("https://example.com/");',
      'const after = { linkedom: seen("linkedom"), turndown: seen("turndown"), readability: seen("@mozilla/readability") };',
      'console.log(JSON.stringify({ before, after, converted: page.markdown.includes("Body") }));',
    ].join("\n");
    const result = spawnSync("bun", ["-e", script], { cwd: REPO_ROOT, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const probe = JSON.parse(result.stdout.trim()) as { before: Record<string, boolean>; after: Record<string, boolean>; converted: boolean };
    assert.deepEqual(probe.before, { linkedom: false, turndown: false, readability: false }, "importing the package loads none of them");
    assert.equal(probe.converted, true, "the first HTML conversion works");
    assert.deepEqual(probe.after, { linkedom: true, turndown: true, readability: true }, "the first conversion loads all three");
  });
});
