import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPackedConsumer } from "./fixtures/packed-consumer.mjs";

test("packed_extensions_resolve_self_references_without_optional_peers", () => {
  const fixture = createPackedConsumer([{ dir: "packages/extensions", name: "@arnilo/prism-extensions" }]);
  try {
    assert.equal(fixture.installStatus, 0, fixture.installOut);
    writeFileSync(
      join(fixture.consumer, "check.ts"),
      `
      import assert from "node:assert/strict";
      import { createAgent } from "@arnilo/prism";
      import approval from "@arnilo/prism-extensions/approval";
      import mcp from "@arnilo/prism-extensions/mcp";
      import { createSqlitePersistence } from "@arnilo/prism-extensions/store-sqlite";
      import { createPostgresPersistence } from "@arnilo/prism-extensions/store-postgres";
      import { defineWorkflow } from "@arnilo/prism-extensions/workflows";
      import * as testing from "@arnilo/prism-extensions/workflows/testing";
      assert.equal(typeof createPostgresPersistence, "function");
      assert.equal(typeof defineWorkflow, "function");
      assert.ok(Object.keys(testing).length > 0);
      const store = createSqlitePersistence({ filename: ":memory:" });
      await store.close();
      const agent = await createAgent({ model: "openai-compatible/test", packages: [approval(), mcp()] });
      await agent.dispose();
      assert.deepEqual(Object.keys(require.cache).filter((path) => /node_modules\\/(pg|@napi-rs|@opentelemetry|@modelcontextprotocol|zod)\\//.test(path)), []);
    `,
    );
    const result = spawnSync("bun", ["check.ts"], { cwd: fixture.consumer, encoding: "utf8", timeout: 30_000 });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    fixture.cleanup();
  }
});

test("extensions_subpath_import_loads_no_optional_peer", () => {
  const result = spawnSync(
    "bun",
    [
      "-e",
      `
    await import("@arnilo/prism-extensions/approval");
    console.log(JSON.stringify(Object.keys(require.cache)));
  `,
    ],
    { cwd: process.cwd(), encoding: "utf8", timeout: 30_000 },
  );
  assert.equal(result.status, 0, result.stderr);
  const loaded = JSON.parse(result.stdout);
  assert.ok(loaded.some((path) => path.includes("/extensions/approval/src/index.ts")));
  assert.deepEqual(
    loaded.filter((path) => /node_modules\/(pg|@napi-rs|@opentelemetry|@modelcontextprotocol|zod)\//.test(path)),
    [],
  );
});

test("extensions_without_optional_peers_report_status_notes", () => {
  const fixture = mkdtempSync(join(tmpdir(), "prism-extensions-peers-"));
  try {
    mkdirSync(join(fixture, "node_modules/@arnilo"), { recursive: true });
    symlinkSync(process.cwd(), join(fixture, "node_modules/@arnilo/prism"));
    cpSync("packages/extensions", join(fixture, "node_modules/@arnilo/prism-extensions"), {
      recursive: true,
      filter: (path) => !path.includes("node_modules") && !path.includes("__tests__"),
    });
    writeFileSync(
      join(fixture, "check.ts"),
      `
      import assert from "node:assert/strict";
      import { createAgent } from "@arnilo/prism";
      for (const [subpath, config, peer] of [
        ["keyring", {}, "keyring"],
        ["mcp", { servers: [{ id: "test", transport: "stdio", command: "unused", allow: "*" }] }, "@modelcontextprotocol/client"],
        ["store-postgres", {}, "pg"],
        ["observability", {}, "@opentelemetry/api"],
      ]) {
        const { default: definition } = await import("@arnilo/prism-extensions/" + subpath);
        const agent = await createAgent({ model: "openai-compatible/test", packages: [definition(config)] });
        try {
          const inspected = agent.inspect();
          assert.ok(inspected.statusNotes.some((note) => note.message.includes(peer)), subpath + JSON.stringify(inspected.statusNotes));
        } finally { await agent.dispose(); }
      }
    `,
    );
    const result = spawnSync("bun", ["check.ts"], { cwd: fixture, encoding: "utf8", timeout: 30_000 });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
