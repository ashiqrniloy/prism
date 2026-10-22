import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createAgent } from "../index.js";

// Optional-package setup invariants: every first-party capability package must
// import from its public entrypoint and set up inertly (no network, no provider
// invocation) so hosts can register it without side effects. Consolidated from
// the former phase12/13/14 boundary tests (plan 079, Task 5).

// Plan 152 Tasks 3-4: the extracted provider packages publish TypeScript source, so each tuple
// carries its own entrypoint and factory name. Config is ref-only, so a literal key is replaced by
// an `env:` ref that never resolves — setup notes a warning and still registers.
const providerPackages = [
  ["hyper", "hyper", "listHyperModels", { apiKey: "env:PRISM_TEST_HYPER_KEY" }, "../../packages/providers/hyper/src/index.ts"],
  [
    "opencode-go",
    "opencodeGo",
    "listOpenCodeGoModels",
    { apiKey: "env:PRISM_TEST_OPENCODE_KEY" },
    "../../packages/providers/opencode-go/src/index.ts",
  ],
  ["typesafe", "typesafe", "typeSafeModels", { apiKey: "env:PRISM_TEST_TYPESAFE_KEY" }, "../../packages/providers/typesafe/src/index.ts"],
  ["laya", "laya", "layaModels", { apiKey: "env:PRISM_TEST_LAYA_KEY" }, "../../packages/providers/laya/src/index.ts"],
] as const;

describe("optional package setup boundaries", () => {
  it("provider packages expose their public factory and discovery", async () => {
    for (const [, factory, discovery, , specifier] of providerPackages) {
      const mod = (await import(specifier)) as Record<string, unknown>;
      assert.equal(typeof mod[factory], "function", `missing ${factory}`);
      assert.ok(mod[discovery] !== undefined, `missing ${discovery}`);
    }
  });

  it("provider packages set up without network", async () => {
    for (const [, factory, , options, specifier] of providerPackages) {
      let fetchCalls = 0;
      const mod = (await import(specifier)) as Record<string, (options: unknown) => unknown>;
      const instance = mod[factory]!({
        ...options,
        fetch: (() => {
          fetchCalls++;
          throw new Error("network disabled");
        }) as typeof fetch,
      });
      const agent = await createAgent({
        model: { provider: "probe", model: "probe" },
        packages: [instance as never],
      });
      await agent.dispose();
      assert.equal(fetchCalls, 0, `${specifier} setup called fetch`);
    }
  });
  it("provider_factories_split_fetch", async () => {
    for (const [, factory, , options, specifier] of providerPackages) {
      const mod = (await import(specifier)) as Record<string, (options: unknown) => unknown>;
      const fetchStub = (() => {
        throw new Error("network disabled");
      }) as typeof fetch;
      const instance = mod[factory]!({ ...options, fetch: fetchStub }) as { readonly config?: Readonly<Record<string, unknown>> };

      assert.ok(
        instance.config === undefined || !("fetch" in instance.config),
        `${specifier} routed the factory-only fetch into its validated JSON config`,
      );
    }
  });
});
