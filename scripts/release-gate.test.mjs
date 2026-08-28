#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { publishArgs } from "./release.mjs";
import {
  assertTarballAllowDeny,
  baselineName,
  diffSurface,
  extractDeclaredSurface,
  parseDeclarationFile,
  parseSurface,
  serializeSurface,
} from "./release-gates.mjs";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "prism-gate-"));
  mkdirSync(join(dir, "dist"), { recursive: true });
  return dir;
}

describe("release gates", () => {
  it("parses local declarations, re-exports, star exports, and default", () => {
    const dir = fixture();
    writeFileSync(
      join(dir, "dist/mod.d.ts"),
      `export declare function foo(a: string): number;
export declare interface Bar { x: number }
export declare const BAZ: "baz";
export default function (): void;
`,
    );
    writeFileSync(
      join(dir, "dist/index.d.ts"),
      `export { foo, Bar as Renamed } from "./mod.js";
export * from "./mod.js";
export * as ns from "./mod.js";
`,
    );
    const surface = extractDeclaredSurface(join(dir, "dist"));
    for (const name of ["foo", "Bar", "BAZ", "default", "Renamed", "ns"]) assert.ok(surface.has(name), `missing ${name}`);
    assert.match(surface.get("foo"), /function foo\(a: string\): number/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("diffs removed, changed, and added names", () => {
    const baseline = parseSurface("a\texport declare function a(): void;\nb\texport declare const b: number;\n");
    const current = parseSurface("a\texport declare function a(x: number): void;\nc\texport declare const c: number;\n");
    const diff = diffSurface(current, baseline);
    assert.deepEqual(diff.removed, ["b"]);
    assert.deepEqual(diff.changed, ["a"]);
    assert.deepEqual(diff.added, ["c"]);
  });

  it("serializes deterministically", () => {
    const surface = new Map([
      ["z", "z-sig"],
      ["a", "a-sig"],
    ]);
    assert.equal(serializeSurface(surface), "a\ta-sig\nz\tz-sig\n");
    assert.equal(serializeSurface(parseSurface(serializeSurface(surface))), serializeSurface(surface));
  });

  it("tarball deny list blocks review/plan/map content and allows clean packs", () => {
    assert.throws(() => assertTarballAllowDeny("pkg", ["dist/index.js", "docs/review-coverage-2026.md"]), /denied paths/);
    assert.throws(() => assertTarballAllowDeny("pkg", ["docs/_evidence/release-0.2.7-evidence.md"]), /denied paths/);
    assert.throws(() => assertTarballAllowDeny("pkg", ["docs/release-0.2.7-evidence.md"]), /denied paths/);
    assert.throws(() => assertTarballAllowDeny("pkg", ["docs/api-page-template.md"]), /denied paths/);
    assert.throws(() => assertTarballAllowDeny("pkg", ["plans/079.md"]), /denied paths/);
    assert.throws(() => assertTarballAllowDeny("pkg", ["dist/index.js.map"]), /denied paths/);
    assert.throws(() => assertTarballAllowDeny("pkg", ["dist/__tests__/x.test.js"]), /denied paths/);
    assert.ok(assertTarballAllowDeny("pkg", ["dist/index.js", "docs/index.md", "README.md", "CHANGELOG.md"]));
  });

  it("tarball deny list rejects unexpected file types and credential material", () => {
    for (const path of [
      "dist/native.node",
      "vendor/libcrypto.so",
      "bin/tool.exe",
      "dist/credentials.pem",
      "config/service-account.key",
      "cert/server.p12",
    ]) {
      assert.throws(() => assertTarballAllowDeny("pkg", [path]), /denied paths/, `${path} must be denied`);
    }
    assert.ok(assertTarballAllowDeny("pkg", ["dist/index.d.ts", "package.json", "LICENSE"]));
  });

  it("publish provenance flag is mandatory in CI and detectable when missing in dry run", () => {
    const pkg = { path: ".", manifest: { name: "@arnilo/prism" } };
    const ci = publishArgs(pkg, false, true);
    assert.ok(ci.includes("--provenance"), "CI publish must request npm provenance");
    const ciDryRun = publishArgs(pkg, true, true);
    assert.ok(ciDryRun.includes("--provenance"), "CI dry-run must keep the provenance flag so the gate is observable");
    // Negative fixture: provenance suppressed in CI (e.g. tampered invocation)
    // is detectable — the flag is absent from the dry-run argument list.
    const suppressed = publishArgs(pkg, true, false);
    assert.ok(!suppressed.includes("--provenance"), "suppressed provenance must be visible in dry-run args");
    const local = publishArgs(pkg, false, false);
    assert.ok(!local.includes("--provenance"), "local publish without OIDC must not claim provenance");
  });

  it("baseline names are filesystem-safe", () => {
    assert.equal(baselineName("@arnilo/prism"), "arnilo__prism.txt");
    assert.equal(baselineName("@arnilo/prism-browser"), "arnilo__prism-browser.txt");
  });

  it("parseDeclarationFile ignores comment-free multi-line signatures by collapsing", () => {
    const dir = fixture();
    const file = join(dir, "dist/x.d.ts");
    writeFileSync(file, "export declare function multi(\n  a: string,\n  b: number\n): Promise<void>;\n");
    const { locals } = parseDeclarationFile(file);
    assert.match(locals.get("multi"), /multi\( a: string, b: number \): Promise<void>/);
    rmSync(dir, { recursive: true, force: true });
  });
});
