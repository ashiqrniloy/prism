import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "bun:test";
import { convertHtml, decodeBody } from "../native/convert.js";

const FIXTURE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "article.html"), "utf8");

describe("native HTML conversion", () => {
  it("native_convert_extracts_article_and_drops_chrome", async () => {
    const { markdown, title } = await convertHtml(FIXTURE, "https://bun.sh/blog/bun-v1.4");
    assert.match(markdown, /^## Bun 1\.4 release notes/mu, `the h1 becomes an ATX heading:\n${markdown}`);
    assert.match(markdown, /^## Upgrading$/mu, "the section heading survives as ATX");
    assert.match(markdown, /```\nconst ready/u, "a block becomes a fenced code block");
    assert.equal(markdown.includes("Pricing"), false, "navigation is dropped");
    assert.equal(markdown.includes("Prism footer text"), false, "the footer is dropped");
    assert.equal(markdown.includes("script did not run"), false, "scripts never run or render");
    assert.equal(title, "Prism fetch fixture");
  });

  it("native_convert_absolutizes_links_and_drops_unsafe_schemes", async () => {
    const { markdown } = await convertHtml(FIXTURE, "https://bun.sh/blog/bun-v1.4");
    assert.match(markdown, /\(https:\/\/bun\.sh\/docs\/runtime\)/u, "a root-relative link becomes absolute");
    assert.match(markdown, /\(https:\/\/bun\.sh\/blog\)/u, "an absolute link is kept");
    assert.match(markdown, /\(https:\/\/bun\.sh\/images\/bun\.png\)/u, "an image source becomes absolute");
    assert.equal(markdown.includes("javascript:"), false, "a javascript: link loses its target");
  });

  it("native_convert_falls_back_to_body_without_a_readable_article", async () => {
    const { markdown } = await convertHtml("<html><body><div>tiny page</div></body></html>", "https://example.com/");
    assert.match(markdown, /tiny page/u);
  });

  it("native_convert_honors_meta_charset", async () => {
    // 0xE9 is "é" in ISO-8859-1 and an invalid continuation byte in UTF-8.
    const bytes = new Uint8Array([...Buffer.from('<html><head><meta charset="iso-8859-1"></head><body>caf', "latin1"), 0xe9, ...Buffer.from("</body></html>", "latin1")]);
    assert.match(decodeBody(bytes, "text/html"), /café/u);
    assert.match(decodeBody(bytes, "text/html; charset=iso-8859-1"), /café/u);
    // An unknown label falls back to UTF-8 with replacement instead of throwing.
    assert.equal(decodeBody(bytes, "text/html; charset=not-a-charset").includes("caf"), true);
  });
});
