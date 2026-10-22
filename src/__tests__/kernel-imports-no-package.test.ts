import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}

// Static import/export-from and dynamic import() of a package specifier.
const PACKAGE_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)[`"']@arnilo\/prism-[^`"']+[`"']/g;

describe("kernel imports no package", () => {
  it("kernel_imports_no_package", () => {
    const offenders: string[] = [];
    for (const file of tsFiles("src")) {
      if (file.includes("__tests__")) continue;
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(PACKAGE_IMPORT)) offenders.push(`${file}: ${match[0]}`);
    }
    assert.deepEqual(offenders, [], `kernel source must not import @arnilo/prism-*:\n${offenders.join("\n")}`);
  });

  // Plan 159 Task 8: identity left the kernel. `Principal` is the only identity type it names.
  it("kernel_has_no_identity_module", () => {
    const hits: string[] = [];
    const banned = /\b(AgentIdentity|IdentityVerifier|IdentityError|assertIdentityActive)\b/;
    for (const file of tsFiles("src")) {
      if (file.includes("__tests__")) continue;
      const text = readFileSync(file, "utf8");
      if (banned.test(text)) hits.push(file);
    }
    assert.deepEqual(hits, [], `kernel source still names a moved identity symbol:\n${hits.join("\n")}`);
    assert.equal(
      tsFiles("src").some((file) => file.endsWith("src/identity.ts")),
      false,
    );
  });
});
