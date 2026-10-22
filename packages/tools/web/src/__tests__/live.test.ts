import assert from "node:assert/strict";
import { it } from "bun:test";
import { createBraveSearch, createExaSearch, createFirecrawlFetch } from "../index.js";

const live = process.env.PRISM_LIVE_WEB === "1";
it.skipIf(!live || !process.env.PRISM_BRAVE_SEARCH_TOKEN)(
  "Brave least-privilege live search",
  async () => {
    const result = await createBraveSearch({
      credentials: () => process.env.PRISM_BRAVE_SEARCH_TOKEN,
      limits: { maxResults: 1, timeoutMs: 20_000 },
    }).search("Prism TypeScript SDK", { count: 1 });
    assert.ok(result.results.length <= 1);
  },
  30_000,
);
it.skipIf(!live || !process.env.PRISM_EXA_API_KEY)(
  "Exa least-privilege live search",
  async () => {
    const result = await createExaSearch({
      credentials: () => process.env.PRISM_EXA_API_KEY,
      limits: { maxResults: 1, timeoutMs: 20_000 },
    }).search("Prism TypeScript SDK", { count: 1 });
    assert.ok(result.results.length <= 1);
  },
  30_000,
);
it.skipIf(!live || !process.env.PRISM_FIRECRAWL_API_KEY)(
  "Firecrawl least-privilege live fetch",
  async () => {
    const result = await createFirecrawlFetch({
      credentials: () => process.env.PRISM_FIRECRAWL_API_KEY,
      limits: { maxMarkdownBytes: 64 * 1024, timeoutMs: 20_000 },
    }).fetch("https://example.com/");
    assert.equal(result.untrusted, true);
  },
  30_000,
);
