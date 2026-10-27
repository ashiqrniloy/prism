import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "bun:test";
import type { HostConfig } from "../host/index.js";
import { loadHostConfig } from "../host/index.js";
import { createResearchWorker } from "../host/research.js";

const MODEL = { provider: "mock", model: "m", limits: { contextWindow: 64_000, maxOutputTokens: 0 } };
const KEY_ENV = "PRISM_TEST_HOST_BRAVE_KEY";

afterEach(() => {
  delete process.env[KEY_ENV];
});

function configFile(web: Record<string, unknown>): { path: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), "prism-agent-config-"));
  const path = join(root, "prism-agent.json");
  writeFileSync(
    path,
    JSON.stringify({
      models: { orchestrator: MODEL, coding: MODEL, research: MODEL },
      storePath: join(root, "sessions.db"),
      workspace: join(root, "workspace"),
      approval: "ask",
      web,
    }),
  );
  return { path, root };
}

test("host_config_accepts_web_fetch_domains_cache", () => {
  const { path, root } = configFile({
    backend: "brave",
    apiKey: `env:${KEY_ENV}`,
    searxngOrigin: "https://search.example.org",
    fetch: { backend: "native" },
    domains: { allow: ["*.mozilla.org", "bun.sh"], block: ["ads.example.com"] },
    cache: { ttlSeconds: 900, maxEntries: 16, maxBytes: 1048576 },
  });
  try {
    assert.deepEqual(loadHostConfig(path).web, {
      backend: "brave",
      apiKey: `env:${KEY_ENV}`,
      searxngOrigin: "https://search.example.org",
      fetch: { backend: "native" },
      domains: { allow: ["*.mozilla.org", "bun.sh"], block: ["ads.example.com"] },
      cache: { ttlSeconds: 900, maxEntries: 16, maxBytes: 1048576 },
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("host_config_rejects_unknown_web_keys", () => {
  for (const web of [
    { backend: "brave", fetch: { backend: "native", prompt: {} } },
    { backend: "brave", domains: { allow: ["a.test"], deny: ["b.test"] } },
    { backend: "brave", cache: { ttlSeconds: 60, ttl: 60 } },
  ]) {
    const { path, root } = configFile(web);
    try {
      assert.throws(() => loadHostConfig(path), /unknown key/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  const { path, root } = configFile({ backend: "brave", fetch: { backend: "bogus" } });
  try {
    assert.throws(() => loadHostConfig(path), /fetch\.backend must be native, firecrawl, or off/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("research_worker_registers_web_fetch_with_search_backend", async () => {
  process.env[KEY_ENV] = "brave-canary";
  const root = mkdtempSync(join(tmpdir(), "prism-agent-web-"));
  const config: HostConfig = {
    models: { orchestrator: MODEL, coding: MODEL, research: MODEL },
    storePath: join(root, "sessions.db"),
    workspace: join(root, "workspace"),
    approval: "ask",
    web: { backend: "brave", apiKey: `env:${KEY_ENV}`, fetch: { backend: "native" } },
  };
  try {
    const agent = await createResearchWorker(config);
    try {
      const names = agent.tools.map((tool) => tool.name);
      assert.ok(names.includes("web_search"), "the search backend stays registered");
      assert.ok(names.includes("web_fetch"), "the worker can read what it finds");
      assert.equal(names.includes("obscura_fetch"), false, "native Obscura tools stay off in the host");
      const notes = agent
        .inspect()
        .statusNotes.filter((entry) => entry.level === "warn" && entry.package === "@arnilo/prism-tools-web");
      assert.deepEqual(notes, [], "a resolved key and a keyless fetch need no note");
    } finally {
      await agent.dispose();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
