/**
 * Hermetic doc checks. Two artifacts must stay in sync with the repo:
 *
 * - `docs/live-testing.md` credential matrix ↔ `scripts/live-matrix.json`
 *   (regenerate with `bun scripts/generate-live-docs.mjs --write`)
 * - `docs/peer-dependencies.md` peer matrix ↔ every workspace manifest's
 *   third-party `peerDependencies`.
 *
 * Register in the root test chain next to the other static gates.
 */

import { test } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifest, regeneratedDoc } from "./generate-live-docs.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(join(ROOT, relative), "utf8");

test("docs/live-testing.md credential matrix is in sync with scripts/live-matrix.json", () => {
  const doc = read("docs/live-testing.md");
  const expected = regeneratedDoc(doc, loadManifest());
  assert.equal(doc, expected, "docs/live-testing.md is stale — run: bun scripts/generate-live-docs.mjs --write");
});

test("credential matrix keeps the least-privilege scope column populated", () => {
  const { suites } = loadManifest();
  for (const suite of suites) {
    assert.ok(typeof suite.scope === "string" && suite.scope.trim().length > 0, `suite ${suite.id} must document a least-privilege scope`);
    assert.ok(typeof suite.cost === "string" && suite.cost.trim().length > 0, `suite ${suite.id} must document its cost`);
  }
});

// --- peer matrix ↔ manifests -------------------------------------------------

const PEER_NETWORK = ["pg", "@nats-io/jetstream", "@nats-io/transport-node", "playwright-core", "e2b"];
const unquote = (cell) => cell.trim().replace(/^`|`$/g, "").replace(/\\\|/g, "|");

function workspacePackages() {
  // Grouped layout (plan 147/152): `packages/<group>/` holds packages one level deeper.
  const dirs = [];
  for (const name of readdirSync(join(ROOT, "packages"))) {
    if (existsSync(join(ROOT, "packages", name, "package.json"))) {
      dirs.push(name);
      continue;
    }
    for (const child of readdirSync(join(ROOT, "packages", name))) {
      if (existsSync(join(ROOT, "packages", name, child, "package.json"))) dirs.push(`${name}/${child}`);
    }
  }
  return dirs
    .map((dir) => ({ dir, manifest: JSON.parse(read(`packages/${dir}/package.json`)) }))
    .filter((entry) => typeof entry.manifest.name === "string");
}

/** Every third-party peer declaration in the workspace (internal @arnilo/* peers are lockstep). */
function declaredPeers() {
  const rows = [];
  for (const { dir, manifest } of workspacePackages()) {
    for (const [peer, range] of Object.entries(manifest.peerDependencies ?? {})) {
      if (peer.startsWith("@arnilo/")) continue;
      rows.push({
        peer,
        range,
        optional: manifest.peerDependenciesMeta?.[peer]?.optional === true,
        pkg: manifest.name,
        dir,
        exports: Object.keys(manifest.exports ?? {}),
      });
    }
  }
  return rows;
}

function matrixRows() {
  const lines = read("docs/peer-dependencies.md").split("\n");
  const header = lines.findIndex((line) => line.startsWith("| Peer | Declared range |"));
  assert.ok(header > 0, "docs/peer-dependencies.md must keep the `| Peer | Declared range | ... |` matrix header");
  const rows = [];
  for (const line of lines.slice(header + 2)) {
    if (!line.startsWith("|")) break;
    const cells = line
      .split(/(?<!\\)\|/)
      .slice(1, -1)
      .map((cell) => cell.trim());
    assert.equal(cells.length, 7, `peer matrix row must have 7 columns: ${line}`);
    const [peer, range, optional, pkg] = [cells[0], cells[1], cells[2], cells[3]].map(unquote);
    assert.match(optional, /^(yes|no)$/, `row ${peer}: optional must be yes/no`);
    assert.match(cells[6], /^(yes|no)$/, `row ${peer}: network must be yes/no`);
    rows.push({
      peer,
      range,
      optional: optional === "yes",
      pkg,
      unlocks: cells[4],
      install: unquote(cells[5]),
      network: cells[6] === "yes",
      line,
    });
  }
  assert.ok(rows.length > 0, "peer matrix is empty");
  return rows;
}

test("docs/peer-dependencies.md lists exactly the workspace third-party peer declarations", () => {
  const declared = declaredPeers();
  const rows = matrixRows();
  const key = (row) => `${row.peer} -> ${row.pkg}`;
  assert.deepEqual(
    rows.map(key).sort(),
    declared.map(key).sort(),
    "peer matrix rows must match the workspace third-party peer declarations exactly (add/remove a row when a manifest changes)",
  );
  for (const row of rows) {
    const manifestRow = declared.find((entry) => key(entry) === key(row));
    assert.equal(row.range, manifestRow.range, `row ${key(row)}: documented range must match the manifest`);
    assert.equal(row.optional, manifestRow.optional, `row ${key(row)}: optional flag must match peerDependenciesMeta`);
  }
});

test("every peer matrix row names live package subpaths, install specs, and its network footprint", () => {
  const rows = matrixRows();
  const peers = new Set(rows.map((row) => row.peer));
  const declared = declaredPeers();
  for (const row of rows) {
    const manifestRow = declared.find((entry) => entry.peer === row.peer && entry.pkg === row.pkg);
    const subpaths = [...row.unlocks.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
    assert.ok(subpaths.length > 0, `row ${row.peer}: Unlocks must name at least one subpath in backticks`);
    for (const subpath of subpaths) {
      assert.ok(
        manifestRow.exports.includes(subpath),
        `row ${row.peer}: ${row.pkg} does not export ${subpath} (exports: ${manifestRow.exports.join(", ")})`,
      );
    }

    const specs = row.install.replace(/^bun add\s+/, "").split(/\s+/);
    assert.ok(row.install.startsWith("bun add "), `row ${row.peer}: Install must be a bun add command`);
    const named = (spec) => spec.match(/^(@[^/]+\/[^@]+)/)?.[1] ?? spec.match(/^([^@]+)/)?.[1];
    const own = specs.find((spec) => named(spec) === row.peer);
    assert.ok(own, `row ${row.peer}: Install must name ${row.peer}`);
    if (/^\d/.test(row.range)) {
      assert.equal(own, `${row.peer}@${row.range}`, `row ${row.peer}: an exact pin must be installed with its exact version`);
    } else {
      assert.equal(own, row.peer, `row ${row.peer}: a range peer must be installed without a version`);
    }
    for (const spec of specs) {
      assert.ok(peers.has(named(spec)), `row ${row.peer}: Install names ${named(spec)}, which is not a matrix peer`);
    }

    const expectedNetwork = PEER_NETWORK.includes(row.peer);
    assert.equal(
      row.network,
      expectedNetwork,
      `row ${row.peer}: Network must be "${expectedNetwork ? "yes" : "no"}" for the supply-chain review column`,
    );
  }
});

// --- peer page links ---------------------------------------------------------

test("every markdown link in the peer page resolves", () => {
  for (const page of ["docs/peer-dependencies.md"]) {
    const base = dirname(page);
    for (const match of read(page).matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
      const target = match[1];
      if (/^[a-z]+:/i.test(target)) continue;
      assert.doesNotThrow(() => read(join(base, target)), `${page} links to missing ${target}`);
    }
  }
});
