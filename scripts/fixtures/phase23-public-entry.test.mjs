// Plan 023 Task 5: public-entry importer fixture. Imports every specifier of
// the BUILT public entry surface (package exports map, resolved through the
// @arnilo/prism self-link) and asserts the frozen export surface — run as a
// wrapped leaf so a concurrent emit can never produce a partial read.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const specs = [
  "@arnilo/prism",
  ...Object.keys(pkg.exports)
    .filter((key) => key !== ".")
    .map((key) => `@arnilo/prism${key.slice(1)}`),
];

const loaded = [];
for (const spec of specs) {
  const mod = await import(spec);
  loaded.push(spec);
  if (spec === "@arnilo/prism") {
    assert.equal(mod.version, pkg.version, "public entry must expose the manifest version");
    for (const name of ["createAgent", "AgentRunError", "resumeAgentRunStream", "createMemoryCheckpointStore"]) {
      assert.equal(typeof mod[name], "function", `public entry must export ${name}`);
    }
    assert.equal(typeof mod.AGENT_RUN_STATE_NAMESPACE, "string", "public entry must export AGENT_RUN_STATE_NAMESPACE");
  }
}
console.log(`PUBLIC ENTRY OK (${loaded.length} specifiers, version ${pkg.version})`);
