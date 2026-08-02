import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import { createExtensionKernel } from "@arnilo/prism/testing/extension-conformance";

import { createPonytailExtension } from "../extension.js";
import { resolveUpstreamRoot, UpstreamResolveError } from "../upstream.js";

const fixtureRoot = resolve(import.meta.dirname, "../../fixtures/upstream-minimal");
const secretPath = join(homedir(), "secret-ponytail-upstream");

function sessionCallbacks() {
  return {
    appendEntry: async () => {},
    getEntries: () => [],
  };
}

describe("ponytail upstream resolution", () => {
  it("resolveUpstreamRoot_accepts_fixture_with_skills_marker", () => {
    const root = resolveUpstreamRoot({ upstreamPath: fixtureRoot });
    assert.equal(root, fixtureRoot);
  });

  it("resolveUpstreamRoot_fails_closed_when_skills_marker_missing", () => {
    assert.throws(
      () => resolveUpstreamRoot({ upstreamPath: import.meta.dirname }),
      (error: unknown) => error instanceof UpstreamResolveError && error.code === "upstream_resolve_failed",
    );
  });

  it("resolveUpstreamRoot_fails_closed_without_path_or_peer", () => {
    assert.throws(
      () => resolveUpstreamRoot({ packageName: "@arnilo/prism-ponytail-fixture-missing-peer" }),
      (error: unknown) => error instanceof UpstreamResolveError,
    );
  });

  it("resolveUpstreamRoot_redacts_absolute_paths_in_errors", () => {
    try {
      resolveUpstreamRoot({ upstreamPath: secretPath });
      assert.fail("expected throw");
    } catch (error) {
      assert.ok(error instanceof UpstreamResolveError);
      assert.ok(!error.message.includes(secretPath));
      assert.ok(!error.message.includes(homedir()));
    }
  });
});

describe("ponytail extension scaffold", () => {
  it("setup_without_upstream_registers_nothing", async () => {
    const kernel = createExtensionKernel({ errorPolicy: "throw", secrets: [secretPath] });
    const extension = createPonytailExtension({
      upstreamPath: secretPath,
      ...sessionCallbacks(),
    });

    await assert.rejects(() => kernel.load([extension]), UpstreamResolveError);
    assert.equal(kernel.registries.skills.list().length, 0);
    assert.equal(kernel.registries.commands.list().length, 0);
    assert.equal(kernel.registries.instructionInjectors.list().length, 0);
  });

  it("setup_with_fixture_upstream_registers_contributions", async () => {
    const kernel = createExtensionKernel({ errorPolicy: "throw" });
    const fixtureFull = resolve(import.meta.dirname, "../../fixtures/upstream-full");
    const extension = createPonytailExtension({
      upstreamPath: fixtureFull,
      defaultMode: "off",
      quietStartup: true,
      ...sessionCallbacks(),
    });

    await kernel.load([extension]);
    assert.ok(kernel.registries.skills.list().length > 0);
    assert.ok(kernel.registries.commands.get("ponytail"));
  });
});
