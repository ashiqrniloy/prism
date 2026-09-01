import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import { createExtensionKernel } from "@arnilo/prism/testing/extension-conformance";

import { createGraftExtension } from "../extension.js";
import { GraftResolveError, readBoundedFile, redactPaths, resolveGraftCli } from "../upstream.js";

const fixtureRoot = resolve(import.meta.dirname, "../../../fixtures/graft-package-fixture");
const secretPath = join(homedir(), "secret-graft-root");

function sessionCallbacks() {
  return {
    appendEntry: async () => {},
    getEntries: () => [],
  };
}

describe("graft cli resolution", () => {
  it("resolveGraftCli_prefers_explicit_cliPath", () => {
    const explicit = join(fixtureRoot, "bin", "graft.mjs");
    const resolved = resolveGraftCli({ cliPath: explicit, packageRoot: import.meta.dirname });
    assert.deepEqual(resolved, { kind: "explicit", command: explicit, args: [] });
  });

  it("resolveGraftCli_fails_closed_when_explicit_cliPath_missing", () => {
    assert.throws(
      () => resolveGraftCli({ cliPath: "/usr/local/bin/definitely-not-graft" }),
      (error: unknown) => error instanceof GraftResolveError && !error.message.includes("/usr/local/bin"),
    );
  });

  it("resolveGraftCli_rejects_relative_cliPath", () => {
    assert.throws(() => resolveGraftCli({ cliPath: "graft" }), GraftResolveError);
  });

  it("resolveGraftCli_reads_bin_from_packageRoot_fixture", () => {
    const resolved = resolveGraftCli({ packageRoot: fixtureRoot });
    assert.equal(resolved.kind, "peer-bin");
    assert.equal(resolved.command, process.execPath);
    assert.equal(resolved.args.length, 1);
    assert.ok(resolved.args[0]?.endsWith(join("bin", "graft.mjs")));
  });

  it("resolveGraftCli_fails_closed_when_packageRoot_has_no_bin", () => {
    try {
      resolveGraftCli({ packageRoot: import.meta.dirname });
      assert.fail("expected throw");
    } catch (error) {
      assert.ok(error instanceof GraftResolveError);
      assert.equal(error.code, "graft_resolve_failed");
    }
  });

  it("resolveGraftCli_fails_closed_without_path_or_peer", () => {
    assert.throws(
      () => resolveGraftCli({ packageName: "@arnilo/prism-graft-fixture-missing-peer" }),
      (error: unknown) => error instanceof GraftResolveError,
    );
  });

  it("resolveGraftCli_redacts_absolute_paths_in_errors", () => {
    try {
      resolveGraftCli({ packageRoot: secretPath });
      assert.fail("expected throw");
    } catch (error) {
      assert.ok(error instanceof GraftResolveError);
      assert.ok(!error.message.includes(secretPath));
      assert.ok(!error.message.includes(homedir()));
    }
  });

  it("redactPaths_caps_error_length", () => {
    const out = redactPaths("x".repeat(2000));
    assert.ok(out.length <= 512);
  });
});

describe("bounded graph file reads", () => {
  it("readBoundedFile_reads_within_root_and_cap", () => {
    const body = readBoundedFile(fixtureRoot, "bin/graft.mjs", 64 * 1024);
    assert.ok(body.includes("stub"));
  });

  it("readBoundedFile_rejects_escape_and_oversize", () => {
    assert.throws(() => readBoundedFile(fixtureRoot, "../package.json", 64 * 1024), GraftResolveError);
    assert.throws(() => readBoundedFile(fixtureRoot, "bin/graft.mjs", 4), GraftResolveError);
  });
});

describe("prism-graft extension scaffold", () => {
  it("setup_with_unresolvable_cli_fails_closed_and_registers_nothing", async () => {
    const kernel = createExtensionKernel({ errorPolicy: "throw", secrets: [secretPath] });
    await assert.rejects(
      kernel.load([
        createGraftExtension({
          packageName: "@arnilo/prism-graft-fixture-missing-peer",
          ...sessionCallbacks(),
        }),
      ]),
      GraftResolveError,
    );
    assert.equal(kernel.registries.tools.list().length, 0);
    assert.equal(kernel.registries.skills.list().length, 0);
    assert.equal(kernel.registries.commands.list().length, 0);
  });

  it("setup_with_fixture_cli_emits_loaded_event_and_registers_pull_surface", async () => {
    const events: Array<{ type: string; metadata?: Record<string, unknown> }> = [];
    const kernel = createExtensionKernel({ errorPolicy: "throw" });
    kernel.events.on("graft:loaded", (event) => {
      if (event.type === "graft:loaded") events.push({ type: event.type, metadata: event.metadata as Record<string, unknown> });
    });
    await kernel.load([createGraftExtension({ packageRoot: fixtureRoot, quietStartup: false, ...sessionCallbacks() })]);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.metadata?.mode, "pull");
    assert.equal(events[0]?.metadata?.cliKind, "peer-bin");
    assert.equal(kernel.registries.tools.list().length, 6);
  });

  it("quietStartup_suppresses_loaded_event", async () => {
    let loaded = 0;
    const kernel = createExtensionKernel({ errorPolicy: "throw" });
    kernel.events.on("graft:loaded", () => {
      loaded += 1;
    });
    await kernel.load([createGraftExtension({ packageRoot: fixtureRoot, quietStartup: true, ...sessionCallbacks() })]);
    assert.equal(loaded, 0);
  });
});
