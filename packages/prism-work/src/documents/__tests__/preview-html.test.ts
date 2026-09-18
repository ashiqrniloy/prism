import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type DeckModel, type DocModel, renderPreviewHtml, type SheetModel } from "../index.js";

describe("renderPreviewHtml", () => {
  it("renders safe HTML without script tags or active JavaScript protocols", () => {
    const maliciousDoc: DocModel = {
      kind: "doc",
      modelVersion: 1,
      title: 'Security <script>alert("pwned")</script>',
      blocks: [
        {
          type: "heading",
          level: 1,
          text: '<img src="x" onerror="alert(1)"> Title',
        },
        {
          type: "paragraph",
          runs: [
            {
              text: 'Click here <script>eval("evil")</script>',
              link: 'javascript:alert("exploit")',
              bold: true,
            },
          ],
        },
        {
          type: "table",
          rows: 1,
          columns: 1,
          cells: [['<a href="javascript:void(0)">evil link</a>']],
        },
      ],
    };

    const html = renderPreviewHtml(maliciousDoc);

    // 1. Must NOT contain executable script tags, raw img tags, or active javascript pseudo-protocols
    assert.equal(html.includes("<script"), false, "HTML must not contain unescaped <script");
    assert.equal(html.includes("<img"), false, "HTML must not contain raw unescaped <img> tag");
    assert.equal(html.includes("<a href"), false, "HTML must not contain raw unescaped <a> tags");
    assert.equal(html.includes("javascript:"), false, "HTML must not contain javascript: url protocol");

    // 2. Entities must be properly escaped
    assert.ok(html.includes("&lt;script&gt;alert(&quot;pwned&quot;)&lt;/script&gt;"));
    assert.ok(html.includes("&lt;img src=&quot;x&quot; onerror=&quot;alert(1)&quot;&gt;"));
  });

  it("renders sheet models as sanitized HTML tables without external URLs", () => {
    const sheet: SheetModel = {
      kind: "sheet",
      modelVersion: 1,
      title: "Quarterly Financials",
      sheets: [
        {
          name: "Q3 Summary",
          cells: [
            ["Metric", "Value", "External Link"],
            ["Revenue", { type: "decimal", value: "1500000.50" }, "https://example.com/sensitive-doc"],
            ["Formula", { formula: "=SUM(B2:B2)", cachedValue: 1500000.5 }, "http://internal-corp-network"],
          ],
        },
      ],
    };

    const html = renderPreviewHtml(sheet);

    // Assert absence of live hyperlinks and external anchor tags
    assert.equal(html.includes("<a "), false);
    assert.equal(html.includes("href="), false);
    assert.equal(html.includes("http://"), false);
    assert.equal(html.includes("https://"), false);
    assert.ok(html.includes('<table class="prism-table">'));
    assert.ok(html.includes("1500000.50"));
    assert.ok(html.includes("=SUM(B2:B2)"));
  });

  it("renders deck models as clean slide sections with notes", () => {
    const deck: DeckModel = {
      kind: "deck",
      modelVersion: 1,
      title: "Board Presentation",
      slides: [
        {
          layout: "title",
          title: "Annual Strategy",
          subtitle: "2026-2028 Plan",
        },
        {
          layout: "title-and-content",
          title: "Core Priorities",
          bullets: ["Reliability", "Scalability", "Zero-Trust Security"],
          notes: "Confidential speaker note.",
        },
      ],
    };

    const html = renderPreviewHtml(deck);

    assert.ok(html.includes('<div class="prism-preview prism-deck-preview">'));
    assert.ok(html.includes('<h1 class="prism-deck-title">Board Presentation</h1>'));
    assert.ok(html.includes('<section class="prism-slide prism-slide-title" data-slide-index="0">'));
    assert.ok(html.includes('<h2 class="prism-slide-title">Annual Strategy</h2>'));
    assert.ok(html.includes('<ul class="prism-slide-bullets">'));
    assert.ok(html.includes("<li>Zero-Trust Security</li>"));
    assert.ok(html.includes('<aside class="prism-slide-notes"><small>Confidential speaker note.</small></aside>'));
  });

  it("truncates output when exceeding byte budget and appends terminal note", () => {
    const largeDoc: DocModel = {
      kind: "doc",
      modelVersion: 1,
      title: "Massive Document",
      blocks: Array.from({ length: 500 }, (_, i) => ({
        type: "paragraph",
        text: `Paragraph ${i}: This is a long repetition of document text intended to exceed small preview html byte limits.`,
      })),
    };

    const smallBudget = 1024; // 1 KiB
    const html = renderPreviewHtml(largeDoc, { maxHtmlBytes: smallBudget });

    assert.ok(html.length <= smallBudget + 200);
    assert.ok(html.includes("prism-preview-truncated"));
    assert.ok(html.includes("[Preview truncated: byte budget exceeded]"));
  });
});
