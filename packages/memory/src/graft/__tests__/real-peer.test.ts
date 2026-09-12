import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";

import { GRAFT_PEER_PACKAGE, GRAFT_PEER_RANGE, GraftResolveError, resolveGraftCli } from "../upstream.js";

/**
 * Contract smoke tests against the real optional peer installed as a devDependency
 * (see plan 070 Task 3). The fixture suite covers fail-closed paths; this covers the
 * documented floor's packaging layout: peer manifest bin discovery (`kind: "peer-bin"`).
 */
describe("graft real peer contract", () => {
  it("resolveGraftCli_resolves_real_peer_bin_without_path", () => {
    const resolved = resolveGraftCli();
    assert.equal(resolved.kind, "peer-bin");
    assert.equal(resolved.command, process.execPath);
    const binPath = resolved.args[0];
    assert.ok(binPath && statSync(binPath).isFile(), "peer bin must be a readable file");
    assert.ok(binPath.endsWith(join("dist", "cli.js")));

    const manifest = JSON.parse(readFileSync(join(dirname(dirname(binPath)), "package.json"), "utf8")) as {
      name?: string;
      version?: string;
    };
    assert.equal(manifest.name, GRAFT_PEER_PACKAGE);
    // Plan 070 Task 12: the peer floor widened to 0.16/0.17/0.18. The installed peer must sit inside the
    // declared range, and the runtime range constant must not drift from the published peer declaration.
    const floors = GRAFT_PEER_RANGE.split("||").map((part) => part.trim().replace(/^\^/, "").split(".").slice(0, 2).join("."));
    const installed = manifest.version?.split(".").slice(0, 2).join(".") ?? "";
    assert.ok(floors.includes(installed), `installed peer ${manifest.version} must be inside ${GRAFT_PEER_RANGE}`);
    const ownManifest = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as {
      peerDependencies?: Record<string, string>;
    };
    assert.equal(
      ownManifest.peerDependencies?.[GRAFT_PEER_PACKAGE],
      GRAFT_PEER_RANGE,
      "GRAFT_PEER_RANGE must match the published peer declaration",
    );
  });

  it("resolveGraftCli_still_fails_closed_for_an_uninstalled_package", () => {
    assert.throws(
      () => resolveGraftCli({ packageName: "@arnilo/prism-graft-fixture-missing-peer" }),
      (error: unknown) => error instanceof GraftResolveError && error.code === "graft_resolve_failed",
    );
  });
});
