import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "bun:test";
import { createNativeFetch, type NativeFetchRequest } from "../native/fetch.js";

const FIXTURE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "article.html"), "utf8");
const ARTICLE_URL = "https://bun.sh/blog/bun-v1.4";

function html(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}
function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}
function adapter(request: NativeFetchRequest, extra: { maxRedirects?: number; limits?: { maxResponseBytes?: number } } = {}) {
  return createNativeFetch({ userAgent: "Prism-Web-Fetch/test", request, ...extra });
}

describe("native fetch", () => {
  it("native_fetch_converts_article_html_to_markdown", async () => {
    const requested: string[] = [];
    const fetch = adapter(async (url) => {
      requested.push(url.toString());
      return html(FIXTURE);
    });
    const page = await fetch.fetch(ARTICLE_URL);
    assert.deepEqual(requested, [ARTICLE_URL]);
    assert.equal(page.provider, "native");
    assert.equal(page.url, ARTICLE_URL);
    assert.equal(page.untrusted, true);
    assert.match(page.markdown, /^## Bun 1\.4 release notes/mu);
    assert.equal(page.markdown.includes("Pricing"), false, "navigation is absent from the Markdown");
    assert.equal(page.markdown.includes("Prism footer text"), false, "the footer is absent from the Markdown");
  });

  it("native_fetch_follows_redirect_and_cites_final_url", async () => {
    const fetch = adapter(async (url) => (url.pathname === "/start" ? redirect("/final?x=1") : html("<html><body>final page</body></html>")));
    const page = await fetch.fetch("https://example.com/start");
    assert.equal(page.url, "https://example.com/final?x=1");
    assert.deepEqual(page.redirects, ["https://example.com/final?x=1"]);
    assert.match(page.markdown, /final page/u);
  });

  it("native_fetch_refuses_redirect_to_metadata_address", async () => {
    const fetch = adapter(async () => redirect("https://169.254.169.254/latest/meta-data/"));
    await assert.rejects(
      () => fetch.fetch("https://example.com/"),
      (error: { code?: string }) => error.code === "ERR_PRISM_WEB_REQUEST",
    );
  });

  it("native_fetch_refuses_redirect_to_loopback", async () => {
    const fetch = adapter(async () => redirect("http://127.0.0.1/"));
    await assert.rejects(
      () => fetch.fetch("https://example.com/"),
      (error: { code?: string }) => error.code === "ERR_PRISM_WEB_REQUEST" && /https:/u.test((error as Error).message),
    );
  });

  it("native_fetch_stops_after_max_redirects", async () => {
    const seen: string[] = [];
    const fetch = adapter(
      async (url) => {
        seen.push(url.pathname);
        return redirect(`/hop-${url.pathname.length}`);
      },
      { maxRedirects: 2 },
    );
    await assert.rejects(
      () => fetch.fetch("https://example.com/a"),
      (error: { code?: string }) => error.code === "ERR_PRISM_WEB_REDIRECT",
    );
    assert.deepEqual(seen.length, 3, "the start plus two followed hops");
  });

  it("native_fetch_refuses_a_redirect_loop", async () => {
    const fetch = adapter(async (url) => redirect(url.pathname === "/a" ? "/b" : "/a"));
    await assert.rejects(
      () => fetch.fetch("https://example.com/a"),
      (error: { code?: string }) => error.code === "ERR_PRISM_WEB_REDIRECT" && /loop/u.test((error as Error).message),
    );
  });

  it("native_fetch_rejects_public_plaintext_http", async () => {
    const fetch = adapter(async () => html("<html><body>no</body></html>"));
    await assert.rejects(
      () => fetch.fetch("http://example.com/"),
      (error: { code?: string }) => error.code === "ERR_PRISM_WEB_REQUEST" && /http:/u.test((error as Error).message),
    );
  });

  it("native_fetch_passes_json_and_text_through", async () => {
    const fetch = adapter(async (url) =>
      url.pathname === "/data.json"
        ? new Response('{"b":2,"a":1}', { status: 200, headers: { "content-type": "application/json" } })
        : new Response("# Already Markdown\n", { status: 200, headers: { "content-type": "text/markdown" } }),
    );
    const json = await fetch.fetch("https://example.com/data.json");
    assert.equal(json.markdown, '{\n  "b": 2,\n  "a": 1\n}', "JSON is pretty-printed");
    const text = await fetch.fetch("https://example.com/readme.md");
    assert.equal(text.markdown, "# Already Markdown\n");
  });

  it("native_fetch_rejects_binary_content_type", async () => {
    const fetch = adapter(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/png" } }));
    await assert.rejects(
      () => fetch.fetch("https://example.com/logo.png"),
      (error: { code?: string; message: string }) => error.code === "ERR_PRISM_WEB_CONTENT_TYPE" && /image\/png/u.test(error.message),
    );
  });

  it("native_fetch_bounds_the_body_and_keeps_the_head", async () => {
    const fetch = adapter(async () => html(`<html><body>${"x".repeat(10_000)}</body></html>`), { limits: { maxResponseBytes: 64 } });
    await assert.rejects(
      () => fetch.fetch("https://example.com/big"),
      (error: { code?: string }) => error.code === "ERR_PRISM_WEB_LIMIT",
    );
  });

  it("native_fetch_lowers_the_markdown_limit_with_maxBytes", async () => {
    const fetch = adapter(async () => html(FIXTURE));
    const page = await fetch.fetch(ARTICLE_URL, { maxBytes: 40 });
    assert.equal(page.sourceTruncated, true);
    assert.ok(Buffer.byteLength(page.markdown, "utf8") <= 40);
  });
});
