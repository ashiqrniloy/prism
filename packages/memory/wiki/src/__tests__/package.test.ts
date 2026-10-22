import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "bun:test";
import { createAgent, definePackage, type PackageInstance } from "@arnilo/prism";
import { packageConformance } from "@arnilo/prism/testing";
import { memoryWiki } from "../index.js";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "prism-wiki-"));
}

/** A stub package providing `web.fetch`, so the wiki's url ingest has a backend to consume. */
function webFetchPackage(fetch: (url: string) => Promise<unknown>): PackageInstance {
  const definition = definePackage({
    name: "@test/wiki-web-fetch",
    version: "0.0.0",
    requires: { api: 1 },
    setup(prism) {
      prism.services.provide("web.fetch", { fetch });
    },
  });
  return definition();
}

function webDocument(url: string, markdown: string) {
  return {
    citationId: "doc-1",
    provider: "firecrawl" as const,
    url,
    markdown,
    retrievedAt: "2026-01-01T00:00:00.000Z",
    untrusted: true as const,
  };
}

describe("wiki package", () => {
  it("memory_wiki_package_conformance", async () => {
    const dir = tempRoot();
    try {
      const result = await packageConformance(memoryWiki({ workspaceRoot: dir, autoDeploySkills: false }));
      assert.equal(result.ok, true, JSON.stringify(result.checks, null, 2));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("memory_wiki_ingest_url_uses_web_fetch", async () => {
    const dir = tempRoot();
    const calls: string[] = [];
    const agent = await createAgent({
      model: { provider: "mock", model: "wiki" },
      packages: [
        webFetchPackage(async (url) => {
          calls.push(url);
          return webDocument(url, "# Fetched page\n\nBody.");
        }),
        memoryWiki({ workspaceRoot: dir, autoDeploySkills: false }),
      ],
    });
    try {
      const result = (await agent.commands.run("wiki-ingest", { url: "https://example.com/docs/page.html" })) as {
        value: { url?: string; sourcePath: string; extract: string };
      };
      const value = result.value;
      assert.equal(value.url, "https://example.com/docs/page.html");
      assert.match(value.extract, /Fetched page/);
      assert.ok(value.sourcePath.endsWith("source.html"), `staged filename must keep the url extension: ${value.sourcePath}`);
      assert.deepEqual(calls, ["https://example.com/docs/page.html"]);
    } finally {
      await agent.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("memory_wiki_ingest_url_without_web_fetch_fails_tool_only", async () => {
    const dir = tempRoot();
    const agent = await createAgent({
      model: { provider: "mock", model: "wiki" },
      packages: [memoryWiki({ workspaceRoot: dir, autoDeploySkills: false })],
    });
    try {
      const notes = agent.inspect().statusNotes;
      assert.deepEqual(
        notes.map((note) => note.level),
        ["warn"],
        "setup notes the missing web.fetch service",
      );
      assert.match(notes[0]?.message ?? "", /web\.fetch/);
      await assert.rejects(
        () => agent.commands.run("wiki-ingest", { url: "https://example.com/docs/page.html" }),
        /web\.fetch/,
      );
      // File ingest still works in the same agent.
      const file = (await agent.commands.run("wiki-ingest", { text: "local note", title: "Local" })) as { value: { extract: string } };
      assert.match((file.value as { extract: string }).extract, /local note/);
    } finally {
      await agent.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("memory_wiki_no_workspace_write_by_default", async () => {
    const dir = tempRoot();
    const agent = await createAgent({
      model: { provider: "mock", model: "wiki" },
      packages: [memoryWiki({ workspaceRoot: dir })],
    });
    try {
      assert.equal(existsSync(join(dir, ".agents")), false, "setup writes nothing without autoDeploySkills");
      assert.equal(existsSync(join(dir, "raw")), false);
    } finally {
      await agent.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("memory_wiki_skills_registered", async () => {
    const dir = tempRoot();
    const agent = await createAgent({
      model: { provider: "mock", model: "wiki" },
      packages: [memoryWiki({ workspaceRoot: dir, autoDeploySkills: false })],
    });
    try {
      assert.deepEqual(
        agent.inspect().skills.map((skill) => skill.name).sort(),
        ["wiki-maintainer", "wiki-searcher"],
      );
    } finally {
      await agent.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("wiki_package_rejects_private_url", async () => {
    const dir = tempRoot();
    let calls = 0;
    const agent = await createAgent({
      model: { provider: "mock", model: "wiki" },
      packages: [
        webFetchPackage(async (url) => {
          calls += 1;
          return webDocument(url, "should not run");
        }),
        memoryWiki({ workspaceRoot: dir, autoDeploySkills: false }),
      ],
    });
    try {
      await assert.rejects(() => agent.commands.run("wiki-ingest", { url: "http://127.0.0.1/private" }), /ssrf|rejected|public/i);
      assert.equal(calls, 0);
    } finally {
      await agent.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
