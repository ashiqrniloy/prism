/**
 * Phase 26 Task 2 conformance/adversarial tests for the host-indexed search
 * seam (createIndexedRepositoryOperations + createRepoSearchTool modes).
 * Threat T2: malicious or stale index — cross-root results, bad scores,
 * prompt-injection snippets, silent downgrade, unbounded query/update.
 */
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, test } from "node:test";
import type { ToolExecutionContext, ToolResult } from "@arnilo/prism";
import { createIndexedRepositoryOperations, IndexError } from "../repository/indexed-search.js";
import type {
  IndexFileChange,
  RepositoryIndexBackend,
  RepositoryIndexQueryRequest,
  RepositoryIndexQueryResult,
  RepositoryIndexRemoveRequest,
  RepositoryIndexStatus,
  RepositoryIndexUpdateRequest,
} from "../repository/indexed-search.js";
import type { RepositorySearchResult } from "../repository.js";
import { createLocalRepositoryOperations } from "../repository.js";
import { createRepoSearchTool } from "../search.js";

interface BackendCalls {
  updates: RepositoryIndexUpdateRequest[];
  removes: RepositoryIndexRemoveRequest[];
  searches: RepositoryIndexQueryRequest[];
  statusCalls: number;
  disposed: number;
}

interface FakeOptions {
  state?: RepositoryIndexStatus["state"];
  updatedAt?: number;
  noUpdatedAt?: boolean;
  sourceRevision?: string;
  noSourceRevision?: boolean;
  semantic?: boolean;
  searchImpl?: (request: RepositoryIndexQueryRequest) => Promise<RepositoryIndexQueryResult>;
  statusThrows?: boolean;
  updateThrows?: boolean;
  removeThrows?: boolean;
  searchThrows?: boolean;
  slowSearchMs?: number;
  abortAware?: boolean;
}

function makeBackend(options: FakeOptions = {}): { backend: RepositoryIndexBackend; calls: BackendCalls; entries: Map<string, string> } {
  const entries = new Map<string, string>();
  const calls: BackendCalls = { updates: [], removes: [], searches: [], statusCalls: 0, disposed: 0 };
  const now = options.updatedAt ?? Date.now();
  const { state, sourceRevision, noSourceRevision, noUpdatedAt, semantic, searchImpl, statusThrows, updateThrows, removeThrows, searchThrows, slowSearchMs, abortAware } = options;
  const backend: RepositoryIndexBackend = {
    capabilities: { semantic: semantic ?? true },
    async update(request: RepositoryIndexUpdateRequest) {
      if (updateThrows) throw new Error("backend update exploded");
      calls.updates.push(request);
      for (const change of request.changes) entries.set(change.path, change.bytes !== undefined ? `x`.repeat(change.bytes) : "x");
    },
    async remove(request: RepositoryIndexRemoveRequest) {
      if (removeThrows) throw new Error("backend remove exploded");
      calls.removes.push(request);
      for (const path of request.paths) entries.delete(path);
    },
    async search(request: RepositoryIndexQueryRequest) {
      calls.searches.push(request);
      if (slowSearchMs) await new Promise((resolve) => setTimeout(resolve, slowSearchMs));
      if (abortAware && request.signal?.aborted) throw new Error("aborted by host");
      if (searchThrows) throw new Error("backend search exploded with secret");
      if (searchImpl) return searchImpl(request);
      const hits: Array<{ path: string; score: number; snippet: string }> = [];
      for (const [path, snippet] of entries) {
        if (request.mode === "indexed_literal" && !path.includes(request.query)) continue;
        hits.push({ path, score: 0.75, snippet });
      }
      return { hits: hits.slice(0, request.maxResults), truncated: hits.length > request.maxResults };
    },
    async status() {
      calls.statusCalls++;
      if (statusThrows) throw new Error("backend status exploded");
      return {
        state: state ?? "ready",
        sourceRevision: noSourceRevision ? undefined : (sourceRevision ?? "abc123"),
        updatedAt: noUpdatedAt ? undefined : now,
      };
    },
    async dispose() {
      calls.disposed++;
    },
  };
  return { backend, calls, entries };
}

let root: string;
let fallback: ReturnType<typeof createLocalRepositoryOperations>;

before(async () => {
  root = await mkdtemp(join(tmpdir(), "phase26-index-"));
  await writeFile(join(root, "a.ts"), "export const needle = 1;\n");
  await writeFile(join(root, "b.md"), "no match here\n");
  fallback = createLocalRepositoryOperations();
});

function seed(backend: RepositoryIndexBackend, paths: string[]): Promise<void> {
  return backend.update({ sourceRevision: "abc123", changes: paths.map((path) => ({ path, kind: "add" as const, bytes: 4 })) });
}

function makeComposite(options: {
  state?: RepositoryIndexStatus["state"];
  updatedAt?: number;
  noUpdatedAt?: boolean;
  sourceRevision?: string;
  noSourceRevision?: boolean;
  semantic?: boolean;
  allowedModes?: readonly ("literal" | "indexed_literal" | "semantic")[];
  requireSourceRevision?: boolean;
  staleMaxAgeMs?: number;
  limits?: Record<string, number>;
  searchImpl?: (request: RepositoryIndexQueryRequest) => Promise<RepositoryIndexQueryResult>;
  updateThrows?: boolean;
  searchThrows?: boolean;
  slowSearchMs?: number;
  abortAware?: boolean;
  statusThrows?: boolean;
}) {
  const { backend, calls, entries } = makeBackend(options);
  const composite = createIndexedRepositoryOperations(root, {
    index: backend,
    fallback,
    allowedModes: options.allowedModes ?? ["literal", "indexed_literal", "semantic"],
    stale: { maxAgeMs: options.staleMaxAgeMs, requireSourceRevision: options.requireSourceRevision },
    limits: options.limits,
  });
  return { composite, backend, calls, entries };
}

function expectIndexError(promise: Promise<unknown>, code: IndexError["code"]): Promise<IndexError> {
  return promise.then(
    () => assert.fail(`expected IndexError ${code}`),
    (error) => {
      assert.ok(error instanceof IndexError, `expected IndexError, got ${String(error)}`);
      assert.equal(error.code, code);
      return error;
    },
  );
}

test("default parity: literal routes to the fallback and is not labeled untrusted", async () => {
  const { composite, calls } = makeComposite({});
  const result = (await composite.search({ root, query: "needle", mode: "literal" })) as RepositorySearchResult;
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]!.path, "a.ts");
  assert.equal(result.untrusted_index, undefined);
  assert.equal(calls.searches.length, 0, "literal mode never touches the index");
});

test("indexed_literal query: freshness gate, validated hits, provenance metadata", async () => {
  const { composite, backend } = makeComposite({});
  await seed(backend, ["src/a.ts", "src/b.ts", "vendor/x.ts"]);
  const result = (await composite.search({ root, query: "src", mode: "indexed_literal" })) as RepositorySearchResult;
  assert.equal(result.untrusted_index, true);
  assert.equal(result.indexed?.mode, "indexed_literal");
  assert.equal(result.indexed?.state, "ready");
  assert.equal(result.indexed?.sourceRevision, "abc123");
  assert.ok(result.indexed?.updatedAt !== undefined);
  assert.equal(result.matches.length, 2); // src/a.ts + src/b.ts (vendor/x.ts misses)
  assert.equal(result.matches[0]!.score, 0.75);
  assert.equal(result.matches[0]!.line, 0);
});

test("semantic mode requires explicit capability and explicit allow", async () => {
  const noCapability = makeComposite({ semantic: false });
  await expectIndexError(noCapability.composite.search({ root, query: "q", mode: "semantic" }), "ERR_PRISM_INDEX_UNSUPPORTED");

  const notAllowed = makeComposite({ allowedModes: ["literal", "indexed_literal"] });
  await expectIndexError(notAllowed.composite.search({ root, query: "q", mode: "semantic" }), "ERR_PRISM_INDEX_UNSUPPORTED");
  // indexed_literal also fails when not allowed; no silent downgrade to literal
  const literalOnly = makeComposite({ allowedModes: ["literal"] });
  await expectIndexError(literalOnly.composite.search({ root, query: "q", mode: "indexed_literal" }), "ERR_PRISM_INDEX_UNSUPPORTED");

  const allowed = makeComposite({ semantic: true });
  const result = (await allowed.composite.search({ root, query: "q", mode: "semantic" })) as RepositorySearchResult;
  assert.equal(result.indexed?.mode, "semantic");
});

test("stale semantics: failed/empty/building/aged/missing-revision all fail closed", async () => {
  await expectIndexError(makeComposite({ state: "failed" }).composite.search({ root, query: "q", mode: "indexed_literal" }), "ERR_PRISM_INDEX_FAILED");
  await expectIndexError(makeComposite({ state: "empty" }).composite.search({ root, query: "q", mode: "indexed_literal" }), "ERR_PRISM_INDEX_STALE");
  await expectIndexError(makeComposite({ state: "building" }).composite.search({ root, query: "q", mode: "indexed_literal" }), "ERR_PRISM_INDEX_STALE");
  // age: default staleMaxAgeMs is 60s; updatedAt 61s ago must be stale
  await expectIndexError(
    makeComposite({ updatedAt: Date.now() - 61_000 }).composite.search({ root, query: "q", mode: "indexed_literal" }),
    "ERR_PRISM_INDEX_STALE",
  );
  // host may widen the window
  const widened = makeComposite({ updatedAt: Date.now() - 61_000, staleMaxAgeMs: 300_000 });
  assert.equal(((await widened.composite.search({ root, query: "q", mode: "indexed_literal" })) as RepositorySearchResult).untrusted_index, true);
  // requireSourceRevision with missing revision
  await expectIndexError(
    makeComposite({ noSourceRevision: true, requireSourceRevision: true }).composite.search({ root, query: "q", mode: "indexed_literal" }),
    "ERR_PRISM_INDEX_STALE",
  );
  // missing updatedAt means no attestation
  await expectIndexError(
    makeComposite({ noUpdatedAt: true }).composite.search({ root, query: "q", mode: "indexed_literal" }),
    "ERR_PRISM_INDEX_STALE",
  );
  // unknown state
  await expectIndexError(
    makeComposite({ state: "bogus" as RepositoryIndexStatus["state"] }).composite.search({ root, query: "q", mode: "indexed_literal" }),
    "ERR_PRISM_INDEX_FAILED",
  );
});

test("hostile backend: path escapes, scope escapes, invalid scores fail closed", async () => {
  const hostile = (hits: unknown[]) =>
    makeComposite({
      searchImpl: async () => ({ hits: hits as never, truncated: false }),
    }).composite;

  await expectIndexError(
    hostile([{ path: "/etc/passwd", score: 0.5, snippet: "x" }]).search({ root, query: "q", mode: "indexed_literal" }),
    "ERR_PRISM_INDEX_UNTRUSTED",
  );
  await expectIndexError(
    hostile([{ path: "../escape", score: 0.5, snippet: "x" }]).search({ root, query: "q", mode: "indexed_literal" }),
    "ERR_PRISM_INDEX_UNTRUSTED",
  );
  await expectIndexError(
    hostile([{ path: "a\\b", score: 0.5, snippet: "x" }]).search({ root, query: "q", mode: "indexed_literal" }),
    "ERR_PRISM_INDEX_UNTRUSTED",
  );
  await expectIndexError(
    hostile([{ path: "src/../../etc", score: 0.5, snippet: "x" }]).search({ root, query: "q", mode: "indexed_literal" }),
    "ERR_PRISM_INDEX_UNTRUSTED",
  );
  // outside the requested path scope
  await expectIndexError(
    hostile([{ path: "other/x.ts", score: 0.5, snippet: "x" }]).search({ root, query: "q", path: "src", mode: "indexed_literal" }),
    "ERR_PRISM_INDEX_UNTRUSTED",
  );
  // scores: NaN, Infinity, >1, <0
  for (const score of [NaN, Infinity, -Infinity, 1.5, -0.1]) {
    await expectIndexError(
      hostile([{ path: "a.ts", score, snippet: "x" }]).search({ root, query: "q", mode: "indexed_literal" }),
      "ERR_PRISM_INDEX_UNTRUSTED",
    );
  }
});

test("hostile backend: duplicate paths deduped, snippets bounded, results capped", async () => {
  const snippet = "p".repeat(20_000);
  const { composite } = makeComposite({
    limits: { maxSnippetBytes: 4096 },
    searchImpl: async () => ({
      hits: [
        { path: "a.ts", score: 0.9, snippet },
        { path: "a.ts", score: 0.1, snippet: "dup" },
        { path: "b.ts", score: 0.8, snippet: "ok" },
      ],
      truncated: false,
    }),
  });
  const result = (await composite.search({ root, query: "q", mode: "indexed_literal" })) as RepositorySearchResult;
  assert.deepEqual(
    result.matches.map((m) => m.path),
    ["a.ts", "b.ts"],
  );
  assert.ok(Buffer.byteLength(result.matches[0]!.text, "utf8") <= 4096, "snippet truncated to the byte cap");
  assert.equal(result.matches[1]!.text, "ok");

  const capped = makeComposite({
    limits: { maxResults: 2 },
    searchImpl: async () => ({
      hits: [
        { path: "a.ts", score: 0.9, snippet: "1" },
        { path: "b.ts", score: 0.8, snippet: "2" },
        { path: "c.ts", score: 0.7, snippet: "3" },
      ],
      truncated: true,
    }),
  });
  const result2 = (await capped.composite.search({ root, query: "q", mode: "indexed_literal" })) as RepositorySearchResult;
  assert.equal(result2.matches.length, 2);
  assert.equal(result2.truncated, true);
  assert.equal(result2.truncatedBy, "index");
});

test("backend throws, timeout, and abort fail closed without leaking backend text", async () => {
  const throwing = makeComposite({ searchThrows: true });
  const error = await expectIndexError(
    throwing.composite.search({ root, query: "q", mode: "indexed_literal" }),
    "ERR_PRISM_INDEX_FAILED",
  );
  assert.ok(!error.message.includes("exploded"), "generic message never embeds backend error text");

  const slow = makeComposite({ slowSearchMs: 300, limits: { queryTimeoutMs: 40 } });
  await expectIndexError(slow.composite.search({ root, query: "q", mode: "indexed_literal" }), "ERR_PRISM_INDEX_TIMEOUT");

  const abort = makeComposite({ abortAware: true });
  const controller = new AbortController();
  controller.abort();
  await expectIndexError(
    abort.composite.search({ root, query: "q", mode: "indexed_literal", signal: controller.signal }),
    "ERR_PRISM_INDEX_TIMEOUT",
  );
});

test("update lifecycle: add/edit route to update, delete/rename route to remove", async () => {
  const { composite, calls } = makeComposite({});
  const changes: IndexFileChange[] = [
    { path: "src/a.ts", kind: "add", bytes: 10 },
    { path: "src/a.ts", kind: "edit", bytes: 20 },
    { path: "src/gone.ts", kind: "delete" },
    { path: "src/new.ts", kind: "rename", oldPath: "src/old.ts", bytes: 5 },
  ];
  await composite.index.update({ repositoryId: "repo-1", worktreeId: "wt-1", sourceRevision: "rev-9", changes });
  assert.equal(calls.updates.length, 1);
  assert.equal(calls.removes.length, 1);
  assert.equal(calls.updates[0]!.changes.length, 3, "add+edit+rename-as-add");
  assert.deepEqual(calls.updates[0]!.changes.map((c) => c.path), ["src/a.ts", "src/a.ts", "src/new.ts"]);
  assert.deepEqual(calls.removes[0]!.paths, ["src/gone.ts", "src/old.ts"]);
  assert.equal(calls.updates[0]!.repositoryId, "repo-1");
  assert.equal(calls.updates[0]!.worktreeId, "wt-1");
  assert.equal(calls.updates[0]!.sourceRevision, "rev-9");
});

test("update caps: change count, byte budget, identity/revision bounds, bad paths", async () => {
  const { composite } = makeComposite({ limits: { maxUpdateFiles: 10 } });
  const tooMany: IndexFileChange[] = Array.from({ length: 11 }, (_, i) => ({ path: `f${i}.ts`, kind: "add" as const }));
  await expectIndexError(composite.index.update({ sourceRevision: "r", changes: tooMany }), "ERR_PRISM_INDEX_LIMIT");

  const byteCapped = makeComposite({ limits: { maxUpdateBytes: 64 } });
  await expectIndexError(
    byteCapped.composite.index.update({
      sourceRevision: "r",
      changes: [{ path: "p".repeat(100), kind: "add" as const }],
    }),
    "ERR_PRISM_INDEX_LIMIT",
  );

  await expectIndexError(composite.index.update({ sourceRevision: "r", changes: [{ path: "/abs", kind: "add" as const }] }), "ERR_PRISM_INDEX_UNTRUSTED");
  await expectIndexError(composite.index.update({ sourceRevision: "", changes: [] }), "ERR_PRISM_INDEX_LIMIT");
  await expectIndexError(
    composite.index.update({ sourceRevision: "r", repositoryId: "y".repeat(600), changes: [] }),
    "ERR_PRISM_INDEX_LIMIT",
  );
  await expectIndexError(
    composite.index.update({ sourceRevision: "r", changes: [{ path: "a.ts", kind: "add" as const, bytes: -3 }] }),
    "ERR_PRISM_INDEX_LIMIT",
  );

  // backend failures map to generic failed
  const throwing = makeComposite({ updateThrows: true });
  await expectIndexError(
    throwing.composite.index.update({ sourceRevision: "r", changes: [{ path: "a.ts", kind: "add" as const }] }),
    "ERR_PRISM_INDEX_FAILED",
  );

  // facade remove validates and routes
  const { composite: c2, calls: c2calls } = makeComposite({});
  await c2.index.remove({ paths: ["a.ts", "b/c.ts"] });
  assert.deepEqual(c2calls.removes[0]!.paths, ["a.ts", "b/c.ts"]);
  await expectIndexError(c2.index.remove({ paths: ["../x"] }), "ERR_PRISM_INDEX_UNTRUSTED");

  // status/dispose passthrough
  const status = await c2.index.status();
  assert.equal(status.state, "ready");
  await c2.index.dispose();
  assert.equal(c2calls.disposed, 1);
});

test("tool: default schema is literal-only; indexed modes need options.modes", async () => {
  const tool = createRepoSearchTool(root);
  const schema = tool.parameters as { properties: { mode?: { enum?: string[] } } };
  assert.deepEqual(schema.properties.mode?.enum, ["literal"]);
  const result = await tool.execute({ query: "needle", mode: "indexed_literal" }, ctx());
  assert.equal(result.error?.message.includes("unsupported search mode"), true);

  const hostile = makeComposite({});
  const indexedTool = createRepoSearchTool(root, { operations: hostile.composite, modes: ["indexed_literal"] });
  const schema2 = indexedTool.parameters as { properties: { mode?: { enum?: string[] } } };
  assert.deepEqual(schema2.properties.mode?.enum, ["literal", "indexed_literal"]);
});

test("tool: indexed result content carries scores and untrusted metadata", async () => {
  const { composite, backend } = makeComposite({});
  await seed(backend, ["src/a.ts", "src/b.ts"]);
  const tool = createRepoSearchTool(root, {
    operations: composite,
    modes: ["literal", "indexed_literal", "semantic"],
  });
  const result = (await tool.execute({ query: "src", mode: "indexed_literal" }, ctx())) as ToolResult;
  assert.equal(result.error, undefined);
  const text = (result.content?.[0] as { type: "text"; text: string } | undefined)?.text ?? "";
  assert.ok(text.includes("[score 0.750]"), `content carries scores: ${text}`);
  const metadata = result.metadata as Record<string, unknown>;
  assert.equal(metadata.untrusted_index, true);
  assert.equal(metadata.indexMode, "indexed_literal");
  assert.equal(metadata.indexState, "ready");
  assert.equal(metadata.indexRevision, "abc123");

  // index errors surface as stable error results through the tool
  const stale = makeComposite({ state: "failed" });
  const staleTool = createRepoSearchTool(root, { operations: stale.composite, modes: ["indexed_literal"] });
  const failed = await staleTool.execute({ query: "q", mode: "indexed_literal" }, ctx());
  assert.ok(failed.error?.message.includes("index is failed"), "stable message, no backend text");
});

let counter = 0;
function ctx(signal?: AbortSignal): ToolExecutionContext {
  return { sessionId: "s", runId: "r", toolCallId: `tc-${counter++}`, signal };
}
