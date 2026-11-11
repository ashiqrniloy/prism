import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgent, definePackage, type PackageInstance } from "@arnilo/prism";
import { packageConformance } from "@arnilo/prism/testing";
import memorySystem from "@arnilo/prism-memory-system";
import wikiDefault, {
  WIKI_CONSOLIDATE_COMMAND_NAME,
  WIKI_INGEST_COMMAND_NAME,
  WIKI_INGEST_TOOL_NAME,
  WIKI_LINT_COMMAND_NAME,
  WIKI_READ_TOOL,
  WIKI_SEARCH_TOOL,
  WIKI_STATUS_COMMAND_NAME,
  wiki as wikiPackage,
} from "../index.js";

const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "../../../package.json");

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "prism-wiki-"));
}

/** `packageConformance` loads one package alone: the wiki needs no other package, so it is checked as shipped. */
function conformanceSubject(config: { workspaceRoot: string }): PackageInstance {
  return wikiPackage({ ...config, root: join(config.workspaceRoot, "wiki") });
}

/** A stub package providing `web.fetch`, so the wiki's url ingest has a backend to consume. */
function webFetchPackage(fetch: (url: string) => Promise<unknown>): PackageInstance {
  return definePackage({
    name: "@test/wiki-web-fetch",
    version: "0.0.0",
    requires: { api: 1 },
    setup(prism) {
      prism.services.provide("web.fetch", { fetch });
    },
  })();
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

const mock = { provider: "mock", model: "wiki" } as const;

describe("wiki package: knowledge outside memory", () => {
  it("package_metadata_ships_one_entry_and_no_bin_or_skills", () => {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    assert.equal(pkg.name, "@arnilo/prism-knowledge");
    assert.deepEqual(Object.keys(pkg.exports).sort(), ["./rag", "./wiki"]);
    assert.equal(pkg.bin, undefined, "the prism-wiki bin is retired");
    assert.equal(pkg.files.includes("skills"), false, "the bundled skills are retired");
    assert.equal(pkg.peerDependencies["@arnilo/prism"], ">=0.13.0 <1.0.0");
    // Installing the bundle does not activate the memory package; core is its shared library.
    assert.equal(pkg.peerDependencies["@arnilo/prism-memory-system"], undefined);
    assert.deepEqual(pkg.dependencies, { "@arnilo/prism-memory-system": pkg.version });
    assert.equal(pkg.publishConfig?.access, "public");
    assert.equal(wikiDefault.name, "@arnilo/prism-knowledge/wiki");
  });

  it("wiki_runs_without_memory_on_its_own_sources", async () => {
    const dir = tempRoot();
    const agent = await createAgent({ model: mock, packages: [wikiPackage({ workspaceRoot: dir })] });
    try {
      const ingested = (await agent.commands.run(WIKI_INGEST_COMMAND_NAME, { text: "Deploys go out on Tuesdays.", title: "Deploys" })) as {
        value: { indexed: boolean; noteId: string };
      };
      assert.equal(ingested.value.indexed, true);
      assert.ok(existsSync(join(dir, ".prism", "wiki", "sources")), "sources live under the wiki's default root");
      const status = (await agent.commands.run(WIKI_STATUS_COMMAND_NAME, {})) as { memory: boolean; sources: number; text: string };
      assert.equal(status.memory, false);
      assert.equal(status.sources, 1);
      assert.match(status.text, /memory: not installed; the wiki runs on its own sources\./);
    } finally {
      await agent.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("wiki_with_semantic_off_loads_and_reports_no_memory", async () => {
    const dir = tempRoot();
    const agent = await createAgent({
      model: mock,
      packages: [memorySystem({ ltm: { semantic: false } }), wikiPackage({ workspaceRoot: dir })],
    });
    try {
      const status = (await agent.commands.run(WIKI_STATUS_COMMAND_NAME, {})) as { memory: boolean };
      assert.equal(status.memory, false, "the fabric provides memory.ltm only with indexed notes");
    } finally {
      await agent.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("wiki_registers_three_tools_four_commands_and_the_pointer", async () => {
    const dir = tempRoot();
    const agent = await createAgent({ model: mock, packages: [memorySystem({ ltm: {} }), wikiPackage({ workspaceRoot: dir })] });
    try {
      const inspected = agent.inspect();
      const wikiTools = inspected.tools.map((tool) => tool.name).filter((name) => name.startsWith("wiki"));
      assert.deepEqual(wikiTools.sort(), [WIKI_INGEST_TOOL_NAME, WIKI_READ_TOOL, WIKI_SEARCH_TOOL].sort());
      const commands = inspected.commands.map((command) => command.name).filter((name) => name.startsWith("wiki"));
      assert.deepEqual(
        commands.sort(),
        [WIKI_CONSOLIDATE_COMMAND_NAME, WIKI_INGEST_COMMAND_NAME, WIKI_LINT_COMMAND_NAME, WIKI_STATUS_COMMAND_NAME].sort(),
      );
      assert.deepEqual(
        inspected.skills.map((skill) => skill.name).filter((name) => name.startsWith("wiki")),
        [],
      );
      assert.equal(inspected.hooks["context.build"]?.some((hook) => hook.id.endsWith("#wiki-pointer")) ?? false, true);
      assert.equal(existsSync(join(dir, "sources")), false, "setup writes nothing");
      assert.equal(existsSync(join(dir, ".agents")), false);
    } finally {
      await agent.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("wiki_listed_before_the_fabric_still_loads", async () => {
    const dir = tempRoot();
    const agent = await createAgent({ model: mock, packages: [wikiPackage({ workspaceRoot: dir }), memorySystem({ ltm: {} })] });
    try {
      const status = (await agent.commands.run(WIKI_STATUS_COMMAND_NAME, {})) as { subjects: number };
      assert.equal(status.subjects, 0);
    } finally {
      await agent.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("wiki_status_reports_counts_without_model_call", async () => {
    const dir = tempRoot();
    const agent = await createAgent({ model: mock, packages: [memorySystem({ ltm: {} }), wikiPackage({ workspaceRoot: dir })] });
    try {
      const result = (await agent.commands.run(WIKI_STATUS_COMMAND_NAME, {})) as {
        subjects: number;
        dirty: number;
        scopes: { scope: string; subjects: number; dirty: number }[];
        text: string;
      };
      assert.equal(result.subjects, 0);
      assert.equal(result.dirty, 0);
      assert.ok(result.scopes.length > 0);
      assert.match(result.text, /^wiki: 0 subjects, 0 dirty, 0 sources\./);
      // The mock provider has no scripted turn: any model call would have thrown.
    } finally {
      await agent.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("wiki_package_conformance", async () => {
    const dir = tempRoot();
    try {
      const result = await packageConformance(conformanceSubject({ workspaceRoot: dir }));
      assert.equal(result.ok, true, JSON.stringify(result.checks, null, 2));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("wiki_config_rejects_the_retired_fields", async () => {
    for (const retired of ["wikiRoot", "rawRoots", "profile", "qmdPath", "autoDeploySkills"]) {
      await assert.rejects(
        () => createAgent({ model: mock, packages: [memorySystem({ ltm: {} }), wikiPackage({ [retired]: true } as never)] }),
        (error: unknown) =>
          (error as { code?: string }).code === "config_unknown_key" || /unknown|additional/i.test((error as Error).message),
        retired,
      );
    }
  });

  it("memory_wiki_ingest_url_uses_web_fetch", async () => {
    const dir = tempRoot();
    const calls: string[] = [];
    const agent = await createAgent({
      model: mock,
      packages: [
        memorySystem({ ltm: { tools: { root: dir } } }),
        webFetchPackage(async (url) => {
          calls.push(url);
          return webDocument(url, "# Fetched page\n\nBody.");
        }),
        wikiPackage({ workspaceRoot: dir }),
      ],
    });
    try {
      const result = (await agent.commands.run(WIKI_INGEST_COMMAND_NAME, { url: "https://example.com/docs/page.html" })) as {
        value: { url?: string; sourcePath: string; extract: string };
      };
      assert.equal(result.value.url, "https://example.com/docs/page.html");
      assert.match(result.value.extract, /Fetched page/);
      assert.ok(result.value.sourcePath.endsWith("source.html"), `staged filename must keep the url extension: ${result.value.sourcePath}`);
      assert.match(result.value.sourcePath, /^sources\//);
      assert.deepEqual(calls, ["https://example.com/docs/page.html"]);
    } finally {
      await agent.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ingest_url_without_web_fetch_fails_closed", async () => {
    const dir = tempRoot();
    const agent = await createAgent({
      model: mock,
      packages: [memorySystem({ ltm: { tools: { root: dir } } }), wikiPackage({ workspaceRoot: dir })],
    });
    try {
      const notes = agent.inspect().statusNotes.filter((note) => note.message.startsWith("wiki:"));
      assert.deepEqual(
        notes.map((note) => note.level),
        ["warn"],
        "setup notes the missing web.fetch service",
      );
      assert.match(notes[0]?.message ?? "", /web\.fetch/);
      await assert.rejects(() => agent.commands.run(WIKI_INGEST_COMMAND_NAME, { url: "https://example.com/docs/page.html" }), /web\.fetch/);
      const file = (await agent.commands.run(WIKI_INGEST_COMMAND_NAME, { text: "local note", title: "Local" })) as {
        value: { extract: string };
      };
      assert.match(file.value.extract, /local note/);
    } finally {
      await agent.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("wiki_package_rejects_private_url", async () => {
    const dir = tempRoot();
    let calls = 0;
    const agent = await createAgent({
      model: mock,
      packages: [
        memorySystem({ ltm: { tools: { root: dir } } }),
        webFetchPackage(async (url) => {
          calls += 1;
          return webDocument(url, "should not run");
        }),
        wikiPackage({ workspaceRoot: dir }),
      ],
    });
    try {
      await assert.rejects(
        () => agent.commands.run(WIKI_INGEST_COMMAND_NAME, { url: "http://127.0.0.1/private" }),
        /ssrf|rejected|public/i,
      );
      assert.equal(calls, 0);
    } finally {
      await agent.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
