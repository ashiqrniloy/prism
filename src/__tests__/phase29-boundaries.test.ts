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

const srcFiles = files("src", (path) => path.endsWith(".ts") && !path.includes("src/__tests__"));
const srcText = srcFiles.map((path) => readFileSync(path, "utf8")).join("\n");
const indexText = readFileSync("src/index.ts", "utf8");
const contractsText = readFileSync("src/contracts.ts", "utf8");

// ponytail: discovery touches the FS only via node:fs/node:path; core SDK
// apps consume the `.` barrel (src/index.ts), which must not reach discovery.
const DISCOVERY_FS_MODULES = ["node:fs", "node:fs/promises", "node:path"];

describe("phase 29 contribution discovery boundaries", () => {
  it("phase29_source_imports_no_synapta_packages", () => {
    // ponytail: Synapta is a consuming app, never a Prism dependency. The
    // discovery seam must stay generic — no domain vocabulary crosses the boundary.
    assert.equal(/from ["']synapta/.test(srcText), false, "src/ imports a synapta* package");
    assert.equal(/\bsynapta\b/i.test(srcText), false, "src/ mentions synapta");
  });

  it("phase29_discovery_fs_primitives_live_only_in_src_node", () => {
    // node:fs / node:fs/promises / node:path (the FS primitives discovery
    // walks) must not be imported outside src/node/. The core runtime path
    // that SDK apps use stays fs-free; discovery is opt-in via the
    // `./node/contribution-discovery` subpath.
    // ponytail: node:os is intentionally excluded here — cli-runner.ts no longer imports
    // homedir() (Phase 34 removed the hardcoded ~/.prism/agent/ CLI default), and
    // cli-runner is not reachable from the consumer SDK barrel anyway.
    const offenders = srcFiles
      .filter((path) => !path.startsWith("src/node/"))
      .filter((path) => readFileSync(path, "utf8"))
      .filter((text) => DISCOVERY_FS_MODULES.some((mod) => new RegExp(`from ["']${mod.replace("/", "\\/")}`).test(text)));
    assert.deepEqual(offenders, [], "src/ outside src/node/ imports a discovery FS primitive");
  });

  it("phase29_core_sdk_barrel_does_not_reach_discovery_or_node_builtins", () => {
    // The consumer-facing barrel must not re-export discoverContributions or
    // the node scanner, and must not pull node:fs/node:os/node:path. This is
    // the hard guarantee that discovery is opt-in and unreachable from the
    // core runtime path that SDK apps use.
    for (const token of ["node:fs", "node:os", "node:path", "contribution-discovery", "discoverContributions"]) {
      assert.equal(indexText.includes(token), false, `src/index.ts references ${token}`);
    }
  });

  it("phase29_discovered_contribution_contract_has_no_domain_vocabulary", () => {
    // DiscoveredContribution field names are generic (kind/name/origin/path/
    // skill/declaration/metadata) — no workflow/node/step Synapta-domain
    // terms leak into the discovery envelope.
    const blockStart = contractsText.indexOf("export interface DiscoveredContribution");
    const blockEnd = contractsText.indexOf("export type", blockStart + 1);
    const block = blockStart >= 0 && blockEnd > blockStart ? contractsText.slice(blockStart, blockEnd) : "";
    assert.ok(block.length > 0, "could not locate DiscoveredContribution block in contracts.ts");
    for (const term of ["workflow", "node", "step"]) {
      assert.equal(new RegExp(`\\b${term}\\b`, "i").test(block), false, `DiscoveredContribution mentions ${term}`);
    }
  });
});
