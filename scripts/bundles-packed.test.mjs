import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadRelease, topologicalOrder } from "./release.mjs";
import { createPackedConsumer } from "./fixtures/packed-consumer.mjs";
import { renderTrustedPublishers, shippedNames } from "./registry-cleanup.mjs";

const release = loadRelease();
const bundles = JSON.parse(readFileSync("scripts/bundles.json", "utf8")).bundles;

test("seven_release_units and release_publish_order_follows_bundle_dependencies", () => {
  assert.equal(release.packages.length, 7);
  assert.deepEqual(readdirSync("packages").sort(), bundles.map((bundle) => bundle.dir.split("/")[1]).sort());
  assert.deepEqual(JSON.parse(readFileSync("package.json", "utf8")).workspaces, ["packages/*", "apps/*"]);
  assert.deepEqual(
    topologicalOrder(release).map((pkg) => pkg.manifest.name),
    [
      "@arnilo/prism",
      "@arnilo/prism-extensions",
      "@arnilo/prism-ai",
      "@arnilo/prism-tools",
      "@arnilo/prism-hosts",
      "@arnilo/prism-memory-system",
      "@arnilo/prism-knowledge",
    ],
  );
});

test("trusted_publishers_lists_seven_names", () => {
  const names = shippedNames();
  const text = renderTrustedPublishers(names, { owner: "owner", repository: "repo", published: new Set(["@arnilo/prism"]) });
  assert.equal(text.split("\n").filter((line) => line.startsWith("- ")).length, 7);
  assert.equal(text.split("\n").filter((line) => line.includes("# never published:")).length, 6);
});

test("every_bundle_installs_and_runs_from_its_tarball and prism_add_subpath_from_packed_bundle", () => {
  const fixture = createPackedConsumer(release.packages.map((pkg) => ({ name: pkg.manifest.name, dir: pkg.path })));
  try {
    assert.equal(fixture.installStatus, 0, fixture.installOut);
    assert.equal(fixture.tarballNames.length, 7);
    const specifiers = [
      "@arnilo/prism-ai/hyper",
      "@arnilo/prism-extensions/approval",
      "@arnilo/prism-tools/openapi",
      "@arnilo/prism-memory-system",
      "@arnilo/prism-knowledge/wiki",
    ];
    writeFileSync(
      join(fixture.consumer, "proof.mjs"),
      `
      import assert from "node:assert/strict";
      import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
      import { join } from "node:path";
      import { createAgent, providerTextDelta, providerDone } from "@arnilo/prism";
      import { providerPackage } from "@arnilo/prism/provider-kit";
      import { install, readManifest, scopeDirs } from "@arnilo/prism/manifest";
      import { routeHostUi } from "@arnilo/prism-hosts/headless";
      const provider = { id: "mock", async *generate() { yield providerTextDelta("packed-ok"); yield providerDone(); } };
      for (const specifier of ${JSON.stringify(specifiers)}) {
        const definition = (await import(specifier)).default;
        assert.equal(definition.name, specifier);
        const config = specifier.endsWith("/wiki") ? { workspaceRoot: process.cwd() } : {};
        const agent = await createAgent({ model: { provider: "mock", model: "test" }, packages: [providerPackage("test-provider", [provider]), definition(config)] });
        try {
          const session = await agent.session({ create: true });
          const result = await session.run("hi");
          assert.equal(result.status, "completed", specifier);
          await session.close();
        } finally { await agent.dispose(); }
      }
      const host = routeHostUi([{ name: "unavailable", ui: { request: async () => ({ status: "unavailable" }) } }]);
      const hosted = await createAgent({ model: { provider: "mock", model: "hosted" }, host: { ui: host }, packages: [providerPackage("host-provider", [provider])] });
      try { const session = await hosted.session({ create: true }); assert.equal((await session.run("hi")).status, "completed"); await session.close(); } finally { await hosted.dispose(); }
      const manifest = JSON.parse(readFileSync("package.json", "utf8"));
      for (const specifier of ["@arnilo/prism-extensions/approval", "@arnilo/prism-knowledge/wiki"]) {
        const root = specifier.split("/").slice(0, 2).join("/");
        const project = join(process.cwd(), root.split("/")[1] + "-install");
        const dirs = scopeDirs({ scope: "project", root: project });
        mkdirSync(dirs.packagesDir, { recursive: true });
        writeFileSync(join(dirs.packagesDir, "package.json"), JSON.stringify({ private: true, overrides: manifest.overrides }));
        const entry = await install(specifier, { scope: "project", root: project, packFrom: manifest.overrides[root].slice(5) });
        assert.equal(entry.name, specifier);
        assert.equal((await readManifest(dirs)).packages[0].name, specifier);
      }
    `,
    );
    const result = spawnSync("bun", ["proof.mjs"], { cwd: fixture.consumer, encoding: "utf8", timeout: 120_000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally {
    fixture.cleanup();
  }
});
