import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const BIN = join(import.meta.dirname, "../../bin/prism-host-builder.ts");

function run(...args: string[]) {
  return spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", timeout: 30_000 });
}

describe("prism-host-builder bin", () => {
  it("host_builder_bin_usage: --help exits 0 and prints usage", () => {
    for (const flag of ["--help", "-h", "help"]) {
      const result = run(flag);
      assert.equal(result.status, 0, flag);
      assert.match(result.stdout, /Usage: prism-host-builder <command>/);
    }
  });

  it("host_builder_bin_usage: an unknown subcommand exits 2 and names it", () => {
    const result = run("frobnicate");
    assert.equal(result.status, 2);
    assert.match(result.stderr, /unknown command "frobnicate"/);
    assert.match(result.stderr, /Usage: prism-host-builder/);
  });

  it("a missing command exits 2", () => {
    const result = run();
    assert.equal(result.status, 2);
    assert.match(result.stderr, /missing command/);
  });

  it("info prints the Prism version and the index sizes", () => {
    const result = run("info");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^prism \d+\.\d+\.\d+\S*: \d+ packages, \d+ exports, \d+ error codes, \d+ examples$/m);
  });
});
