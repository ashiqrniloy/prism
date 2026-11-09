/**
 * Plan 210 Task 2. Ids are the only run-local inputs left once the probe clock is fixed: note ids, concept ids and
 * entry ids come from `randomUUID()`. In the probe process those calls draw from a counter that each probe resets
 * (the prefix probe's loader pattern), so a probe's hashes repeat exactly. No product API is added: the sources are
 * transformed on load. Import this module before anything that loads a memory package.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../../..");
const ID_SOURCES = ["packages/memory/system/src/ltm/create.ts", "packages/knowledge/wiki/src/store.ts", "src/ids.ts"];
const files = new Set(ID_SOURCES.map((path) => join(root, path)));

globalThis.__prismMechanismProbe ??= {
  n: 0,
  nonce: () => `00000000-0000-4000-8000-${String(++globalThis.__prismMechanismProbe.n).padStart(12, "0")}`,
};

Bun.plugin({
  name: "mechanism-probe-deterministic-ids",
  setup(build) {
    build.onLoad({ filter: /(?:memory\/system\/src\/ltm\/create|knowledge\/wiki\/src\/store|\/src\/ids)\.ts$/ }, ({ path }) => {
      const source = readFileSync(path, "utf8");
      if (!files.has(path)) return { contents: source, loader: "ts" };
      assert.ok(source.includes("randomUUID()"), `mechanism probe id source drift: ${path}`);
      return { contents: source.replaceAll("randomUUID()", "globalThis.__prismMechanismProbe.nonce()"), loader: "ts" };
    });
  },
});
