import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function files(dir: string, predicate: (path: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path, predicate) : predicate(path) ? [path] : [];
  });
}

const srcText = files("src", (path) => path.endsWith(".ts") && !path.includes("src/__tests__"))
  .map((path) => readFileSync(path, "utf8")).join("\n");

describe("phase 24 provider resolver boundaries", () => {
  it("phase24_source_imports_no_synapta_packages", () => {
    // ponytail: Synapta is a consuming app, never a Prism dependency. The
    // resolver seam must stay generic — no domain vocabulary crosses the boundary.
    assert.equal(/from ["']synapta/.test(srcText), false, "src/ imports a synapta* package");
    assert.equal(/\bsynapta\b/i.test(srcText), false, "src/ mentions synapta");
  });

  it("phase24_provider_resolver_signature_has_no_domain_vocabulary", () => {
    // The resolver contract is (model) => AIProvider | undefined — no
    // workflow/node/step Synapta-domain terms leak into the type or helper.
    const providersText = readFileSync("src/providers.ts", "utf8");
    const contractsText = readFileSync("src/contracts.ts", "utf8");
    const resolverText = [
      ...providersText.matchAll(/export[\s\S]*?(?:ProviderResolver|createProviderResolver)[\s\S]*?(?:\nexport|\n}\n|$)/g),
      ...contractsText.matchAll(/ProviderResolver[\s\S]*?(?:\nexport|\n;|\n})/g),
    ].map((m) => m[0]).join("\n");
    for (const term of ["workflow", "node", "step"]) {
      assert.equal(new RegExp(`\\b${term}\\b`, "i").test(resolverText), false, `resolver contract mentions ${term}`);
    }
    assert.equal(new RegExp("\\bworkflow\\b", "i").test(providersText), false, "src/providers.ts mentions workflow");
    assert.equal(new RegExp("\\bworkflow\\b", "i").test(contractsText), false, "src/contracts.ts mentions workflow");
  });

  it("phase24_core_has_no_first_party_provider_runtime_dependency", () => {
    // Core runs mock-only; first-party provider packages are opt-in, not
    // runtime deps. Declaring one would break the "core needs none" contract.
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as Record<string, unknown>;
    const deps = (pkg.dependencies ?? {}) as Record<string, string>;
    for (const name of Object.keys(deps)) {
      assert.equal(name.startsWith("@arnilo/prism-provider-"), false, `core depends on first-party provider package: ${name}`);
    }
    assert.equal(Object.keys(deps).length, 0, "core has runtime dependencies (expected none)");
  });

  it("phase24_source_does_not_import_first_party_provider_packages", () => {
    // The resolver seam must not hard-wire any first-party provider; hosts mix
    // them in themselves via the resolver. Dev deps only live in examples.
    assert.equal(/from ["']@arnilo\/prism-provider-/.test(srcText), false, "src/ imports a first-party provider package");
  });
});
