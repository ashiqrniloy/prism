import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { type ApiIndex, type ErrorsIndex, type ExamplesIndex, loadHostBuilderIndex } from "../index.js";
import { lookupApi } from "../lookup/api.js";
import { boundedJson, byteLength, MAX_RESULT_BYTES, truncateBytes } from "../lookup/bound.js";
import { DocsIndex } from "../lookup/docs.js";
import { lookupError, parsePitfalls } from "../lookup/errors.js";
import { lookupExamples } from "../lookup/examples.js";
import { nearest } from "../lookup/text.js";
import { cleanup, projectRoot, symlinkOut } from "./fixture.js";

afterEach(cleanup);

async function indexes(): Promise<{ api: ApiIndex; errors: ErrorsIndex; examples: ExamplesIndex }> {
  const [api, errors, examples] = await Promise.all([
    loadHostBuilderIndex("api"),
    loadHostBuilderIndex("errors"),
    loadHostBuilderIndex("examples"),
  ]);
  return { api, errors, examples };
}

describe("prism_api", () => {
  it("prism_api_exact_and_query: an exact symbol returns signature, package, specifier, docs and examples", async () => {
    const { api } = await indexes();
    const result = lookupApi(api, { symbol: "createAgent" });
    assert.equal(result.found, true);
    const match = result.matches[0];
    assert.equal(match?.package, "@arnilo/prism");
    assert.equal(match?.specifier, "@arnilo/prism");
    assert.match(match?.signature ?? "", /createAgent\(config: AgentConfig\): Promise<Agent>/);
    assert.ok((match?.docs.length ?? 0) > 0, "docs pages");
    assert.ok(match?.examples.every((path) => path.startsWith("examples/")));
  });

  it("prism_api_members: an interface lists its fields, so a hook payload field is read and never guessed", async () => {
    const { api } = await indexes();
    const payload = lookupApi(api, { symbol: "ToolCallHookPayload" }).matches[0];
    const members = payload?.members ?? [];
    assert.ok(
      members.some((member) => /^readonly args: /.test(member)),
      members.join("\n"),
    );
    assert.equal(
      members.some((member) => /\barguments\b/.test(member)),
      false,
    );
    const registrar = lookupApi(api, { symbol: "HookRegistrar" }).matches[0];
    assert.ok((registrar?.members ?? []).some((member) => member.startsWith("on<")));
    assert.equal(
      (registrar?.members ?? []).some((member) => member.startsWith("register")),
      false,
    );
    // A function carries a signature and no members.
    assert.equal(lookupApi(api, { symbol: "createAgent" }).matches[0]?.members, undefined);
  });

  it("prism_api_exact_and_query: a symbol is case-sensitive and a miss lists the nearest names", async () => {
    const { api } = await indexes();
    const result = lookupApi(api, { symbol: "createagent" });
    assert.equal(result.found, false);
    assert.ok(result.nearest.includes("createAgent"), result.nearest.join(","));
  });

  it("prism_api_exact_and_query: a query ranks a name hit above a signature hit and honours package", async () => {
    const { api } = await indexes();
    const result = lookupApi(api, { query: "package conformance" });
    assert.equal(result.found, true);
    assert.equal(result.matches[0]?.name, "packageConformance");
    const none = lookupApi(api, { query: "package conformance", package: "@arnilo/prism-extensions/approval" });
    assert.ok(none.matches.every((match) => match.specifier === "@arnilo/prism-extensions/approval"));
    const unknown = lookupApi(api, { symbol: "createAgent", package: "@arnilo/prism-extensions/approvl" });
    assert.equal(unknown.found, false);
    assert.ok(unknown.nearest.includes("@arnilo/prism-extensions/approval"));
  });

  it("prism_api_exact_and_query: an empty request is not found, not an exception", async () => {
    const { api } = await indexes();
    assert.equal(lookupApi(api, {}).found, false);
    assert.equal(lookupApi(api, { query: "zzzqqqxxx" }).found, false);
  });

  it("answers in under 50 ms once the indexes are loaded", async () => {
    const { api } = await indexes();
    lookupApi(api, { query: "warm up" });
    const started = performance.now();
    lookupApi(api, { symbol: "createAgent" });
    lookupApi(api, { query: "approval mode tool call" });
    const elapsed = (performance.now() - started) / 2;
    assert.ok(elapsed < 50, `${elapsed} ms per lookup`);
  });
});

describe("prism_errors", () => {
  it("prism_errors_known_and_unknown: a known code returns meaning, declaration, docs and the pitfall fix", async () => {
    const { errors } = await indexes();
    const result = lookupError(errors, "model_required");
    assert.equal(result.found, true);
    const match = result.matches[0];
    assert.equal(match?.package, "@arnilo/prism");
    assert.match(match?.declared ?? "", /model-errors\.ts:\d+$/);
    assert.match(match?.meaning ?? "", /no `model`/);
    assert.match(match?.pitfall?.fix ?? "", /model: "provider\/model"/);
  });

  it("prism_errors_known_and_unknown: a code the pitfalls do not list has no pitfall field", async () => {
    const { errors } = await indexes();
    const result = lookupError(errors, "no_model");
    assert.equal(result.found, true);
    assert.equal(result.matches[0]?.pitfall, undefined);
  });

  it("prism_errors_known_and_unknown: an unknown code returns the nearest codes", async () => {
    const { errors } = await indexes();
    const result = lookupError(errors, "ERR_PRISM_SLOT_CONFLCT");
    assert.equal(result.found, false);
    assert.ok(result.nearest.includes("ERR_PRISM_SLOT_CONFLICT"), result.nearest.join(","));
  });

  it("parsePitfalls reads only rows whose first column is a backticked code", () => {
    const rows = parsePitfalls("| Code | What | Fix |\n| --- | --- | --- |\n| `a_b` | broke | do `x` \\| y |\n| not code | x | y |\n");
    assert.deepEqual([...rows.keys()], ["a_b"]);
    assert.equal(rows.get("a_b")?.fix, "do `x` \\| y");
  });
});

describe("prism_examples", () => {
  it("returns the verbatim source of an indexed path", async () => {
    const { examples } = await indexes();
    const result = await lookupExamples(examples, { path: "examples/define-package.ts" });
    assert.equal(result.found, true);
    assert.match(result.source ?? "", /definePackage/);
  });

  it("prism_examples_path_outside_index_not_found: traversal, absolute and unlisted paths are not found", async () => {
    const { examples } = await indexes();
    for (const path of ["../../package.json", "/etc/passwd", "examples/../package.json", "examples/nope.ts", "data/api.json"]) {
      const result = await lookupExamples(examples, { path });
      assert.equal(result.found, false, path);
      assert.equal(result.source, undefined, path);
    }
  });

  it("ranks by query and filters by imported package", async () => {
    const { examples } = await indexes();
    const ranked = await lookupExamples(examples, { query: "define package" });
    assert.equal(ranked.matches[0]?.path, "examples/define-package.ts");
    const approval = await lookupExamples(examples, { package: "@arnilo/prism-extensions/approval" });
    assert.ok(
      approval.matches.length > 0 && approval.matches.every((match) => match.imports.includes("@arnilo/prism-extensions/approval")),
    );
  });
});

describe("prism_docs", () => {
  it("prism_docs_returns_anchored_excerpt: returns a heading-anchored excerpt with a resource URI", async () => {
    const docs = new DocsIndex(await projectRoot());
    const result = docs.search("createAgent model");
    assert.equal(result.found, true);
    const hit = result.hits[0];
    assert.equal(hit?.page, "node_modules/@arnilo/prism/docs/agent.md");
    assert.equal(hit?.heading, "Creating an agent");
    assert.equal(hit?.uri, "prism-docs://prism/docs/agent.md#creating-an-agent");
    assert.match(hit?.excerpt ?? "", /Call `createAgent`/);
  });

  it("skips the retired pages the generator also skips", async () => {
    const docs = new DocsIndex(await projectRoot());
    assert.equal(docs.search("retiredquokka").found, false);
    assert.ok(!docs.listPages().some((page) => /migrat/.test(page.path)));
    assert.ok(docs.listPages().some((page) => page.uri === "prism-docs://prism-extensions/approval/README.md"));
  });

  it("a query that no section fully contains is not found", async () => {
    const docs = new DocsIndex(await projectRoot());
    assert.equal(docs.search("createAgent unicorn").found, false);
    assert.equal(docs.search("").found, false);
  });

  it("a root with no @arnilo packages says so", async () => {
    const docs = new DocsIndex(await projectRoot().then((root) => `${root}/missing`));
    const result = docs.search("agent");
    assert.equal(result.found, false);
    assert.match(result.note ?? "", /no @arnilo packages are installed/);
  });

  it("docs_resource_symlink_escape_refused: a page linked outside node_modules is neither searched nor read", async () => {
    const root = await projectRoot();
    symlinkOut(root, "node_modules/@arnilo/prism/docs/agent.md", "# Agent\n\n## Stolen\n\nleakedsecretword createAgent\n");
    const docs = new DocsIndex(root);
    assert.equal(docs.search("leakedsecretword").found, false);
    assert.equal(docs.read("prism-docs://prism/docs/agent.md"), undefined);
    // The unlinked page still reads.
    assert.match(docs.read("prism-docs://prism-extensions/approval/README.md")?.text ?? "", /Modes/);
  });
});

describe("bounds and nearest", () => {
  it("results_bounded_and_marked: truncateBytes cuts on a character boundary", () => {
    const cut = truncateBytes("é".repeat(10), 5);
    assert.equal(cut.truncated, true);
    assert.ok(byteLength(cut.text) <= 5);
    assert.equal(cut.text, "éé");
    assert.equal(truncateBytes("abc", 5).truncated, false);
  });

  it("results_bounded_and_marked: boundedJson stays within the cap and marks the cut", () => {
    const text = boundedJson({ blob: "x".repeat(MAX_RESULT_BYTES * 2) });
    assert.ok(byteLength(text) <= MAX_RESULT_BYTES, `${byteLength(text)} bytes`);
    assert.match(text, /\[truncated: \d+ bytes omitted\]$/);
    assert.doesNotMatch(boundedJson({ small: 1 }), /truncated/);
  });

  it("results_bounded_and_marked: an example larger than the cap is cut with a marker", async () => {
    const { examples } = await indexes();
    const big: ExamplesIndex = { ...examples, examples: [...examples.examples], support: [...examples.support] };
    const result = await lookupExamples(big, { path: "examples/define-package.ts" }, { dataDir: await bigData() });
    assert.equal(result.truncated, true);
    assert.match(result.source ?? "", /\[truncated: \d+ bytes omitted\]$/);
    assert.ok(byteLength(boundedJson(result)) <= MAX_RESULT_BYTES);
  });

  it("nearest ranks substrings before edit distance and ignores far names", () => {
    assert.deepEqual(nearest(["createAgent", "createAgents", "zzz"], "createAgnt", 2), ["createAgent", "createAgents"]);
    assert.deepEqual(nearest(["aaaa"], "zzzzzzzz"), []);
  });
});

/** A data dir whose `define-package.ts` is far over the bound, with the real examples index. */
async function bigData(): Promise<string> {
  const { tempDir, write } = await import("./fixture.js");
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const dir = tempDir("host-builder-data-");
  const source = fileURLToPath(new URL("../../data/examples.json", import.meta.url));
  write(dir, "examples.json", readFileSync(source, "utf8"));
  write(dir, "examples/define-package.ts", `// ${"x".repeat(MAX_RESULT_BYTES * 2)}\n`);
  return dir;
}
