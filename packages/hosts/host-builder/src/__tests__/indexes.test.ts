import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostBuilderError, loadHostBuilderIndex, readExampleSource } from "../index.js";

describe("host-builder indexes", () => {
  it("loads the shipped indexes lazily and describes the kernel", async () => {
    const api = await loadHostBuilderIndex("api");
    assert.equal(api.schemaVersion, 1);
    const kernel = api.packages.find((pkg) => pkg.name === "@arnilo/prism");
    const createAgent = kernel?.entries.find((entry) => entry.subpath === ".")?.exports.find((row) => row.name === "createAgent");
    assert.equal(createAgent?.kind, "function");
    assert.match(createAgent?.signature ?? "", /createAgent\(/);
    const errors = await loadHostBuilderIndex("errors");
    assert.ok(errors.codes.some((row) => row.code === "skill_conflict" && row.namespace === "short"));
    assert.equal(await loadHostBuilderIndex("api"), api, "a second load is cached");
  });

  it("serves an indexed example and refuses everything else", async () => {
    const source = await readExampleSource("examples/define-package.ts");
    assert.match(source, /definePackage/);
    for (const path of [
      "examples/nope.ts",
      "../package.json",
      "/etc/passwd",
      "examples/../package.json",
      "examples/fixtures/hello-package/package.json",
    ]) {
      await assert.rejects(
        readExampleSource(path),
        (error: unknown) => error instanceof HostBuilderError && error.code === "ERR_PRISM_HOST_BUILDER_EXAMPLE",
        path,
      );
    }
  });

  it("fails with ERR_PRISM_HOST_BUILDER_INDEX on a missing or headerless index", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-host-builder-"));
    try {
      await assert.rejects(
        loadHostBuilderIndex("api", { dataDir: dir }),
        (error: unknown) => error instanceof HostBuilderError && error.code === "ERR_PRISM_HOST_BUILDER_INDEX",
      );
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "api.json"), '{"packages":[]}');
      await assert.rejects(loadHostBuilderIndex("api", { dataDir: dir }), /no schemaVersion 1 header/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
