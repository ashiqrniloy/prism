import { test } from "bun:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPackedConsumer } from "./fixtures/packed-consumer.mjs";

const peers = ["@office-open/docx", "@office-open/pptx", "@office-open/xlsx", "@office-open/xml", "ajv", "fast-xml-parser"];

test("tools_web_import_loads_no_office_or_playwright", () => {
  const result = spawnSync(
    "bun",
    ["-e", 'await import("@arnilo/prism-tools/web"); console.log(JSON.stringify(Object.keys(require.cache)))'],
    { encoding: "utf8", timeout: 30000 },
  );
  assert.equal(result.status, 0, result.stderr);
  const loaded = JSON.parse(result.stdout);
  assert.ok(loaded.some((path) => path.includes("/web/src/index.ts")));
  assert.deepEqual(
    loaded.filter((path) => /node_modules\/(?:@office-open|playwright-core|e2b)\//.test(path)),
    [],
  );
});

test("tools_work_missing_optional_peer_reports_status_note", () => {
  for (const missing of peers) {
    const fixture = mkdtempSync(join(tmpdir(), "prism-tools-peers-"));
    try {
      mkdirSync(join(fixture, "node_modules/@arnilo"), { recursive: true });
      symlinkSync(process.cwd(), join(fixture, "node_modules/@arnilo/prism"));
      cpSync("packages/tools", join(fixture, "node_modules/@arnilo/prism-tools"), {
        recursive: true,
        filter: (path) => !path.includes("node_modules") && !path.includes("__tests__"),
      });
      // Resolve the other peers locally; the absent peer must be the one reported.
      for (const peer of peers.filter((peer) => peer !== missing)) {
        const target = join(fixture, "node_modules", peer);
        mkdirSync(target.substring(0, target.lastIndexOf("/")), { recursive: true });
        symlinkSync(join(process.cwd(), "node_modules", peer), target);
      }
      writeFileSync(
        join(fixture, "check.ts"),
        `
        import assert from "node:assert/strict";
        import { createAgent } from "@arnilo/prism";
        import work from "@arnilo/prism-tools/work";
        const agent = await createAgent({ model: "openai-compatible/test", packages: [work({ root: process.cwd() })] });
        try {
          const notes = agent.inspect().statusNotes;
          assert.ok(notes.some((note) => note.message.includes(${JSON.stringify(missing)})), JSON.stringify(notes));
          assert.equal(agent.tools.some((tool) => tool.name.startsWith("office_")), false);
          assert.ok(agent.skills.length > 0);
        } finally { await agent.dispose(); }
      `,
      );
      const result = spawnSync("bun", ["check.ts"], { cwd: fixture, encoding: "utf8", timeout: 30000 });
      assert.equal(result.status, 0, missing + result.stderr);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  }
});

test("packed_tools_tarball_installs_with_ignore_scripts", () => {
  const fixture = createPackedConsumer([{ dir: "packages/tools", name: "@arnilo/prism-tools" }]);
  try {
    assert.equal(fixture.installStatus, 0, fixture.installOut);
    const { installBytes } = JSON.parse(readFileSync("scripts/budgets.json", "utf8")).tools;
    const measured = Number(
      execFileSync("du", ["-sb", join(fixture.consumer, "node_modules")], { encoding: "utf8", timeout: 10000 }).split(/\s/)[0],
    );
    assert.ok(measured <= installBytes.baseline * (1 + installBytes.tolerance), `tools install footprint ${measured}`);
    for (const peer of [...peers, "playwright-core", "e2b", "@firecrawl/anydoc", "mammoth", "pdf-parse"]) {
      assert.equal(
        spawnSync("bun", ["-e", `import.meta.resolve(${JSON.stringify(peer)})`], {
          cwd: fixture.consumer,
          encoding: "utf8",
          timeout: 10000,
        }).status,
        1,
        `${peer} must not be auto-installed`,
      );
    }
    writeFileSync(
      join(fixture.consumer, "check.ts"),
      `
      import assert from "node:assert/strict";
      import { createAgent } from "@arnilo/prism";
      import web from "@arnilo/prism-tools/web";
      import work from "@arnilo/prism-tools/work";
      import coding from "@arnilo/prism-tools/coding";
      const agent = await createAgent({ model: "openai-compatible/test", packages: [web({ backend: "native" }), work({ root: process.cwd() }), coding({ root: process.cwd() })] });
      try {
        assert.ok(agent.skills.some((skill) => skill.name === "web-research"));
        assert.ok(agent.skills.length > 1);
      } finally { await agent.dispose(); }
    `,
    );
    const result = spawnSync("bun", ["check.ts"], { cwd: fixture.consumer, encoding: "utf8", timeout: 30000 });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    fixture.cleanup();
  }
});
