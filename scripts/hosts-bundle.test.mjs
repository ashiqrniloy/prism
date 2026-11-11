import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPackedConsumer } from "./fixtures/packed-consumer.mjs";

test("hosts_headless_import_loads_no_protocol_sdk", () => {
  const result = spawnSync(
    "bun",
    [
      "-e",
      `
    await import("@arnilo/prism-hosts/headless");
    console.log(JSON.stringify(Object.keys(require.cache)));
  `,
    ],
    { encoding: "utf8", timeout: 30_000 },
  );
  assert.equal(result.status, 0, result.stderr);
  const loaded = JSON.parse(result.stdout);
  assert.ok(loaded.some((path) => path.includes("/hosts/headless/src/index.ts")));
  assert.deepEqual(
    loaded.filter((path) => /node_modules\/(?:@agentclientprotocol|@ag-ui|@modelcontextprotocol|zod)\//.test(path)),
    [],
  );
});

test("independent_packages_exclude_lockstep_bundles", () => {
  const bundles = JSON.parse(readFileSync("scripts/bundles.json", "utf8")).bundles;
  const independent = JSON.parse(readFileSync("scripts/independent-packages.json", "utf8"));
  assert.equal(bundles.find((bundle) => bundle.name === "@arnilo/prism-hosts").line, "lockstep");
  for (const bundle of bundles.filter((bundle) => bundle.line === "lockstep")) {
    assert.ok(![...independent.packages, ...independent.experimental].includes(bundle.name));
  }
});

test("hosts_bundle_bins_resolve_from_packed_tarball", () => {
  const fixture = createPackedConsumer([
    { dir: "packages/extensions", name: "@arnilo/prism-extensions" },
    { dir: "packages/hosts", name: "@arnilo/prism-hosts" },
  ]);
  try {
    assert.equal(fixture.installStatus, 0, fixture.installOut);
    for (const bin of ["prism-devtools", "prism-host-builder"]) {
      const result = spawnSync(join(fixture.consumer, "node_modules/.bin", bin), bin === "prism-devtools" ? [] : ["--help"], {
        cwd: fixture.consumer,
        encoding: "utf8",
        timeout: 30_000,
      });
      assert.equal(result.status, bin === "prism-devtools" ? 1 : 0, result.stderr);
      assert.match(result.stdout + result.stderr, new RegExp(bin));
      if (bin === "prism-devtools") assert.match(result.stderr, /--model is required/);
    }
    for (const peer of ["@agentclientprotocol/sdk", "@ag-ui/core", "@modelcontextprotocol/server", "zod"]) {
      assert.equal(existsSync(join(fixture.consumer, "node_modules", peer)), false, peer);
    }
    writeFileSync(
      join(fixture.consumer, "check.ts"),
      `
      import assert from "node:assert/strict";
      import { loadHostBuilderIndex } from "@arnilo/prism-hosts/host-builder";
      assert.ok((await loadHostBuilderIndex("api")).packages.length > 0);
      const manifest = await Bun.file("node_modules/@arnilo/prism-hosts/package.json").json();
      for (const sub of ["acp", "ag-ui", "ag-ui/renderer", "mcp-server"]) {
        await assert.rejects(() => import("@arnilo/prism-hosts/" + sub), /Cannot find (?:module|package)/);
      }
      for (const path of Object.keys(manifest.exports).filter((path) => !["./acp", "./ag-ui", "./ag-ui/renderer", "./mcp-server"].includes(path))) {
        const module = await import("@arnilo/prism-hosts" + path.slice(1));
        assert.ok(Object.keys(module).length > 0, path);
      }
    `,
    );
    const result = spawnSync("bun", ["check.ts"], { cwd: fixture.consumer, encoding: "utf8", timeout: 30_000 });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    fixture.cleanup();
  }
});

test("hosts_protocol_subpaths_resolve_with_explicit_peers", () => {
  const peers = Object.fromEntries(
    Object.entries(JSON.parse(readFileSync("packages/hosts/package.json", "utf8")).peerDependencies).filter(
      ([name]) => name !== "@arnilo/prism",
    ),
  );
  const fixture = createPackedConsumer([{ dir: "packages/hosts", name: "@arnilo/prism-hosts" }], peers);
  try {
    assert.equal(fixture.installStatus, 0, fixture.installOut);
    const result = spawnSync(
      "bun",
      ["-e", 'for (const sub of ["acp", "ag-ui", "mcp-server"]) await import("@arnilo/prism-hosts/" + sub)'],
      { cwd: fixture.consumer, encoding: "utf8", timeout: 30000 },
    );
    assert.equal(result.status, 0, result.stderr);
  } finally {
    fixture.cleanup();
  }
});
