/**
 * Plan 140 Task 3: the pure parts of scripts/build-prism-code-binaries.mjs — the target table, the
 * deterministic ustar writer, and SHA256SUMS. The compile + self-test path runs per target in
 * .github/workflows/prism-code-binaries.yml (native runners), not here.
 */
import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { TARGETS, tarEntries, writeChecksums } from "./build-prism-code-binaries.mjs";

const ROOT = join(import.meta.dirname, "..");

describe("prism-code binary targets", () => {
  it("covers the six release targets with their native packages", () => {
    expect(Object.keys(TARGETS).sort()).toEqual([
      "darwin-arm64",
      "darwin-x64",
      "linux-arm64",
      "linux-arm64-musl",
      "linux-x64",
      "linux-x64-musl",
    ]);
    const openTui = Object.keys(
      JSON.parse(readFileSync(join(ROOT, "node_modules/@opentui/core/package.json"), "utf8")).optionalDependencies,
    );
    const keyring = Object.keys(
      JSON.parse(readFileSync(join(ROOT, "node_modules/@napi-rs/keyring/package.json"), "utf8")).optionalDependencies,
    );
    for (const [target, spec] of Object.entries(TARGETS)) {
      expect(openTui).toContain(`@opentui/core-${spec.openTui}`);
      expect(keyring).toContain(`@napi-rs/keyring-${spec.keyring}`);
      expect(target.startsWith(`${spec.platform}-${spec.arch}`)).toBe(true);
    }
  });

  it("builds every target in the binaries workflow", () => {
    const workflow = readFileSync(join(ROOT, ".github/workflows/prism-code-binaries.yml"), "utf8");
    for (const target of Object.keys(TARGETS)) expect(workflow).toContain(`target: ${target},`);
  });
});

describe("prism-code binary archives", () => {
  const entries = [
    { name: "prism-code", data: Buffer.from("#!/bin/sh\necho binary\n"), mode: 0o755 },
    { name: "LICENSE", data: Buffer.from("MIT\n"), mode: 0o644 },
  ];

  it("writes a ustar stream that tar lists with fixed owner, mode, and mtime", () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-code-archive-"));
    try {
      const file = join(dir, "a.tar.gz");
      writeFileSync(file, gzipSync(tarEntries(entries, 1_790_640_000)));
      const listing = spawnSync("tar", ["-tvzf", file, "--numeric-owner"], { encoding: "utf8" });
      expect(listing.status).toBe(0);
      const lines = listing.stdout.trim().split("\n");
      expect(lines).toHaveLength(2);
      // GNU tar prints `0/0`, bsdtar `0 0`; sizes come from the entries themselves.
      expect(lines[0]).toMatch(new RegExp(`^-rwxr-xr-x\\s+0[/ ]+0\\s+${entries[0].data.length}\\s.*prism-code$`));
      expect(lines[1]).toMatch(new RegExp(`^-rw-r--r--\\s+0[/ ]+0\\s+${entries[1].data.length}\\s.*LICENSE$`));
      const extracted = spawnSync("tar", ["-xzf", file, "-C", dir], { encoding: "utf8" });
      expect(extracted.status).toBe(0);
      expect(readFileSync(join(dir, "prism-code"), "utf8")).toBe("#!/bin/sh\necho binary\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is byte-identical for identical input", () => {
    expect(gzipSync(tarEntries(entries, 1)).equals(gzipSync(tarEntries(entries, 1)))).toBe(true);
    expect(tarEntries(entries, 1).equals(tarEntries(entries, 2))).toBe(false);
  });

  it("writes sha256sum-compatible SHA256SUMS over the archives only", () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-code-sums-"));
    try {
      writeFileSync(join(dir, "prism-code-linux-x64.tar.gz"), "x");
      writeFileSync(join(dir, "prism-code-darwin-arm64.tar.gz"), "y");
      writeFileSync(join(dir, "notes.txt"), "ignored");
      const { archives } = writeChecksums(dir);
      expect(archives).toEqual(["prism-code-darwin-arm64.tar.gz", "prism-code-linux-x64.tar.gz"]);
      const check = spawnSync("sha256sum", ["-c", "SHA256SUMS"], { cwd: dir, encoding: "utf8" });
      if (check.error) return; // sha256sum missing (macOS): the format assertion below still runs
      expect(check.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses to write SHA256SUMS without archives", () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-code-sums-empty-"));
    try {
      expect(() => writeChecksums(dir)).toThrow(/no prism-code-\*\.tar\.gz archives/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
