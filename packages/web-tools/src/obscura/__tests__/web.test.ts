import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_OBSCURA_SEARCH_PROFILE } from "../search-profile.js";
import { createObscuraWebTools } from "../web.js";
import { fakeObscuraCliPath } from "./fake-cli.js";

const EXEC = process.execPath;
const FAKE = fakeObscuraCliPath();

function tools(overrides: Record<string, unknown> = {}) {
  return createObscuraWebTools({
    command: EXEC,
    argsBefore: [FAKE],
    limits: { timeoutMs: 5000 },
    ...overrides,
  });
}

function context() {
  return { sessionId: "s", runId: "r", toolCallId: "c1" };
}

async function call(toolSet: ReturnType<typeof tools>, name: string, args: Record<string, unknown>) {
  const tool = toolSet.tools.find((t) => t.name === name);
  assert.ok(tool, `${name} present`);
  return tool.execute(args as never, context());
}

test("default suite exposes web_search, web_fetch, obscura_fetch, obscura_scrape", () => {
  const toolSet = tools();
  assert.deepEqual(
    toolSet.tools.map((t) => t.name),
    ["web_search", "web_fetch", "obscura_fetch", "obscura_scrape"],
  );
  assert.equal(toolSet.searchProfileId, "default");
});

test("native tools can be disabled, leaving standard web_search/web_fetch only", () => {
  const toolSet = tools({ nativeTools: false });
  assert.deepEqual(
    toolSet.tools.map((t) => t.name),
    ["web_search", "web_fetch"],
  );
});

test("queries are URL-encoded; extraction JS stays constant; results normalize with citations", async () => {
  const toolSet = tools();
  const result = await call(toolSet, "web_search", { query: `node rust "quotes" & spaces` });
  const value = result.value as {
    provider: string;
    results: Array<{ citationId: string; url: string; title?: string; snippet?: string }>;
    untrusted: boolean;
  };
  assert.equal(result.error, undefined);
  assert.equal(value.provider, "obscura");
  assert.equal(value.untrusted, true);
  assert.equal(result.metadata?.trust, "untrusted_external");
  // Duplicate and unsafe rows dropped; malformed row skipped; order preserved.
  assert.deepEqual(
    value.results.map((r) => r.url),
    ["https://example.com/a?q=node%20rust%20%22quotes%22%20%26%20spaces", "https://example.com/b", "https://example.com/c"],
  );
  assert.ok(value.results[0]!.citationId.startsWith("web:obscura:"));
  assert.equal(value.results[0]!.title, "A");
  assert.equal(value.results[0]!.snippet, "first");
  assert.equal(value.results[1]!.snippet, "second");
});

test("count caps results and the default profile keeps the query out of JavaScript source", async () => {
  const toolSet = tools();
  const result = await call(toolSet, "web_search", { query: "test", count: 1 });
  const value = result.value as { results: unknown[] };
  assert.equal(value.results.length, 1);
  // The profile's extraction JS is a constant string — the query appears only in the URL.
  assert.ok(!DEFAULT_OBSCURA_SEARCH_PROFILE.extractionJs.includes("test"));
});

test("web_fetch returns bounded Markdown with citation metadata", async () => {
  const toolSet = tools();
  const result = await call(toolSet, "web_fetch", { url: "https://example.com/doc" });
  const value = result.value as { provider: string; markdown: string; untrusted: boolean; url: string };
  assert.equal(result.error, undefined);
  assert.equal(value.provider, "obscura");
  assert.equal(value.untrusted, true);
  assert.match(value.markdown, /# Example/);
  assert.match(value.markdown, /example\.com\/doc$/);
});

test("obscura_fetch supports bounded dump modes and selectors; rejects unknown modes", async () => {
  const toolSet = tools();
  const result = await call(toolSet, "obscura_fetch", { url: "https://example.com", dump: "html", selector: "main p" });
  const value = result.value as { dump: string; selector?: string; content: string; truncated: boolean };
  assert.equal(value.dump, "html");
  assert.equal(value.selector, "main p");
  assert.match(value.content, /dump=html/);
  await assert.rejects(call(toolSet, "obscura_fetch", { url: "https://example.com", dump: "cookies" }), /dump mode/);
  await assert.rejects(call(toolSet, "obscura_fetch", { url: "https://example.com", selector: "x".repeat(300) }), /selector/);
});

test("obscura_scrape preserves input association and reports missing rows", async () => {
  const toolSet = tools();
  const result = await call(toolSet, "obscura_scrape", {
    urls: ["https://a.example.com", "https://b.example.com"],
  });
  const value = result.value as {
    results: Array<{ url: string; data?: { index: number; concurrency: string }; error?: string }>;
    untrusted: boolean;
  };
  assert.equal(value.untrusted, true);
  assert.deepEqual(
    value.results.map((r) => r.url),
    ["https://a.example.com", "https://b.example.com"],
  );
  assert.equal(value.results[0]!.data!.index, 0);
  assert.ok(Number(value.results[0]!.data!.concurrency) >= 1);
});

test("obscura_scrape enforces url count, concurrency, and URL policy", async () => {
  const toolSet = tools({ limits: { timeoutMs: 5000, maxUrls: 2, maxConcurrency: 1 } });
  await assert.rejects(
    call(toolSet, "obscura_scrape", { urls: ["https://a.example.com", "https://b.example.com", "https://c.example.com"] }),
    /2 urls/,
  );
  await assert.rejects(call(toolSet, "obscura_scrape", { urls: ["https://a.example.com"], concurrency: 5 }), /concurrency must be 1\.\.1/);
  await assert.rejects(call(toolSet, "obscura_scrape", { urls: ["http://127.0.0.1/x"] }), /ssrf|denied/i);
  await assert.rejects(call(toolSet, "obscura_scrape", { urls: ["http://user:pass@example.com/"] }), /public HTTP/);
});

test("custom scrape expressions fail closed without allowEval and pass with it", async () => {
  const toolSet = tools();
  await assert.rejects(call(toolSet, "obscura_scrape", { urls: ["https://a.example.com"], expression: "process.exit(1)" }), /allowEval/);
  const allowed = tools({ allowEval: true });
  const result = await call(allowed, "obscura_scrape", { urls: ["https://a.example.com"], expression: "JSON.stringify({ok:true})" });
  assert.equal(result.error, undefined);
  // Oversized expressions are rejected even with allowEval.
  await assert.rejects(call(allowed, "obscura_scrape", { urls: ["https://a.example.com"], expression: "x".repeat(8192) }), /exceeds/);
});

test("malformed upstream JSON fails closed", async () => {
  const toolSet = tools({ env: { OBSCURA_FAKE: "garbage" } });
  await assert.rejects(call(toolSet, "web_search", { query: "test" }), /malformed JSON/);
  await assert.rejects(call(toolSet, "obscura_scrape", { urls: ["https://a.example.com"] }), /malformed JSON/);
});

test("oversized output fails closed instead of returning truncated untrusted content", async () => {
  const toolSet = tools({ env: { OBSCURA_FAKE: "oversize" }, limits: { timeoutMs: 5000, maxOutputBytes: 4096 } });
  await assert.rejects(call(toolSet, "web_fetch", { url: "https://example.com/big" }), /byte cap/);
});

test("search profile replacement is validated", () => {
  assert.throws(
    () =>
      tools({
        searchProfile: { id: "custom", searchUrl: () => "https://example.com/?q=x", extractionJs: "" },
      }),
    /extractionJs/,
  );
  assert.throws(
    () =>
      tools({
        searchProfile: {
          id: "custom",
          searchUrl: () => "https://example.com/",
          extractionJs: "x".repeat(8192),
        },
      }),
    /exceeds/,
  );
});

test("obscura_search truth: package never exposes a tool named browser_search", () => {
  const toolSet = tools();
  assert.ok(!toolSet.tools.some((t) => t.name === "browser_search"));
});
