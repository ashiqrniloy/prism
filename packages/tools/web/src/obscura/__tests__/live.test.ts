import { test } from "bun:test";
import { createObscuraWebTools } from "../web.js";

/**
 * Opt-in live smoke test: requires a real installed Obscura binary and network access.
 * Run with PRISM_LIVE_OBSCURA=1 PRISM_OBSCURA_BIN=/path/to/obscura. Skipped otherwise,
 * so the default suite stays network-free and deterministic.
 */
const bin = process.env.PRISM_OBSCURA_BIN;

// Enabled-but-missing fails loudly: opting in without a binary is a configuration
// error, never a silent pass (the leg only skips when PRISM_LIVE_OBSCURA is unset).
if (process.env.PRISM_LIVE_OBSCURA && !bin) {
  throw new Error("PRISM_LIVE_OBSCURA is set but PRISM_OBSCURA_BIN is missing — the protected live Obscura leg cannot run silently");
}

test.skipIf(!(process.env.PRISM_LIVE_OBSCURA && bin))("live: Obscura-backed web_search and web_fetch against the public web", async () => {
  const toolSet = createObscuraWebTools({ command: bin! });
  const ctx = { sessionId: "live", runId: "live", toolCallId: "live" } as never;
  const search = toolSet.tools.find((tool) => tool.name === "web_search")!;
  const result = await search.execute({ query: "obscura headless browser" } as never, ctx);
  const value = result.value as { results: Array<{ url: string }> };
  console.log(`web_search returned ${value.results.length} results`);
  if (!Array.isArray(value.results) || value.results.length === 0) {
    throw new Error("live web_search returned no results — the DuckDuckGo profile or the page markup regressed");
  }
  for (const row of value.results) {
    const host = new URL(row.url).hostname;
    if (host === "duckduckgo.com" || host.endsWith(".duckduckgo.com")) {
      throw new Error(`live web_search returned an undecoded DuckDuckGo redirect host: ${row.url}`);
    }
  }
  const fetch = toolSet.tools.find((tool) => tool.name === "web_fetch")!;
  const fetched = await fetch.execute({ url: value.results[0]!.url } as never, ctx);
  const markdown = (fetched.value as { markdown: string }).markdown;
  console.log(`web_fetch markdown bytes: ${markdown.length}`);
  if (markdown.trim().length === 0) throw new Error("live web_fetch of the first result returned no Markdown");
});
