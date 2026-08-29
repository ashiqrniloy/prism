// Phase 38 CodeQL remediation regressions (plan 038 Task 4).
//
// Exploit-shaped positive and valid-input negative tests per alert group,
// executed against BUILT public entrypoints (threat-suite convention):
//
//   A (36 alerts, js/polynomial-redos): shared `trimTrailingSlashes()` is a
//     linear index scan with `.replace(/\/+$/, "")` semantics — a 200k-slash
//     hostile input completes within a strict bound and no regex is compiled.
//   B (13 alerts, js/polynomial-redos): parsing surfaces (code-checkpoint
//     todos, rag PDF/html, prism-wiki headings/skills) handle hostile
//     nested/unterminated structures with linear work, never re-forming tags.
//   C (2 alerts, incomplete-multi-character-sanitization): the single-pass
//     rag HTML scanner cannot leak script bodies through adjacency tricks.
//   D (alert 22, js/polynomial-redos): sanitizeCacheKey edge trim is
//     index/slice based with preserved allowlist + bound semantics.
//   E (alerts 52-55, insecure-randomness): the phase26 journey fixture
//     generates identifiers from node:crypto, not Math.random.
//   F (alert 56, clear-text-logging): the DR drill never prints raw
//     error.message/stack on a password-handling path.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { describe, it } from "node:test";
import { sanitizeCacheKey, trimTrailingSlashes } from "@arnilo/prism";
import { parseCodingPlanTodos } from "@arnilo/prism-coding-agent";
import { htmlParser, pdfParser } from "@arnilo/prism-rag";
import { parseMarkdownHeading, parseSkillMarkdown } from "@arnilo/prism-wiki";

describe("phase38 codeql regressions", () => {
  it("trimTrailingSlashes matches replace semantics and is linear on hostile input", () => {
    // Positive: trailing slashes trimmed.
    assert.equal(trimTrailingSlashes("https://api.example.com/v1/"), "https://api.example.com/v1");
    assert.equal(trimTrailingSlashes("https://api.example.com/v1///"), "https://api.example.com/v1");
    // Negative: interior slashes preserved; empty/root collapse to empty.
    assert.equal(trimTrailingSlashes("https://api.example.com/v1"), "https://api.example.com/v1");
    assert.equal(trimTrailingSlashes("/"), "");
    assert.equal(trimTrailingSlashes(""), "");
    // Exploit-shaped: a 1M-slash input completes in linear time (no regex backtracking).
    const hostile = "/".repeat(1_000_000);
    const started = performance.now();
    assert.equal(trimTrailingSlashes(hostile), "");
    assert.ok(performance.now() - started < 250, `trim must be linear, took ${performance.now() - started}ms`);
    // No regex evaluation path exists in the implementation.
    const compiled = readFileSync("dist/trim-trailing-slashes.js", "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*"))
      .join("\n");
    assert.ok(!compiled.includes("replace("), "compiled primitive must not call String.replace");
  });

  it("sanitizeCacheKey keeps allowlist + bound semantics with index/slice edge trim", () => {
    assert.equal(sanitizeCacheKey("--a-b--", 100), "a-b");
    assert.equal(sanitizeCacheKey("---", 10), undefined);
    assert.equal(sanitizeCacheKey(undefined, 10), undefined);
    assert.equal(sanitizeCacheKey("a b/c", 100), "a-b-c");
    assert.equal(sanitizeCacheKey("abcdefghij", 4), "abcd");
    // Exploit-shaped: long edge-dash input completes fast and stays bounded.
    const started = performance.now();
    assert.equal(sanitizeCacheKey("-".repeat(100_000), 4096), undefined);
    assert.ok(performance.now() - started < 250);
  });

  it("checkpoint todo parsing stays linear on pathological plan lines", () => {
    // Valid input negative + positive spelling.
    const todos = parseCodingPlanTodos("- [x] Write tests");
    assert.equal(todos.length, 1);
    assert.equal(todos[0].done, true);
    assert.equal(todos[0].text, "Write tests");
    // Exploit-shaped: a line of 100k whitespace/garbage must never backtrack.
    const hostile = `- [ ] ${" ".repeat(100_000)}[[[[[[[${" ".repeat(100_000)}`;
    const started = performance.now();
    const parsed = parseCodingPlanTodos(hostile);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].id, "todo-1");
    assert.ok(performance.now() - started < 250);
  });

  it("rag pdf and html scanning reject/absorb hostile structures linearly", async () => {
    // Unterminated + deeply nested pdf literals complete without quadratic scans.
    const hostile = `%PDF-1.4\n/Type /Page\nBT ${"(".repeat(50_000)} ET`;
    const started = performance.now();
    await assert.rejects(
      pdfParser.parse({ data: new TextEncoder().encode(hostile), mediaType: "application/pdf" }),
      /no uncompressed text|not a PDF/u,
    );
    assert.ok(performance.now() - started < 250);

    // Valid negative (no compression markers) still parses.
    const okHtml = await htmlParser.parse({ text: "<p>Hello <b>world</b></p>", mediaType: "text/html" });
    assert.equal(okHtml.text, "Hello world");
  });

  it("rag html scanner cannot leak script content through tag adjacency", async () => {
    const bypasses = ["<scr<script>ipt>alert(1)</scr</script>ipt>", "<!--<script>alert(1)</script>-->", "<script>alert(1)"];
    for (const bypass of bypasses) {
      const parsed = await htmlParser.parse({ text: bypass, mediaType: "text/html" });
      assert.ok(!/<script/u.test(parsed.text), `output must not contain a reformed script tag: ${JSON.stringify(parsed.text)}`);
    }
  });

  it("wiki heading + skill parsing stay linear and keep documented semantics", () => {
    // Positive.
    assert.deepEqual(parseMarkdownHeading("## Section title"), { level: 2, text: "Section title" });
    // Negative: 7 hashes, bare hash, and non-heading lines never match.
    assert.equal(parseMarkdownHeading("####### seven"), undefined);
    assert.equal(parseMarkdownHeading("#nospace"), undefined);
    assert.equal(parseMarkdownHeading("plain line"), undefined);
    // Exploit-shaped: heading run of 1_000_000 hashes resolves instantly.
    const started = performance.now();
    assert.equal(parseMarkdownHeading("#".repeat(1_000_000)), undefined);
    assert.ok(performance.now() - started < 100);
    const skill = parseSkillMarkdown("---\nname: deploy\n---\n# Deploy");
    assert.equal(skill.name, "deploy");
  });

  it("phase26 journey fixture uses crypto randomness (alerts 52-55)", () => {
    const fixture = readFileSync("scripts/fixtures/phase26-coding-journey.mjs", "utf8");
    assert.ok(!fixture.includes("Math.random"), "fixture must not use Math.random identifiers");
    assert.ok(fixture.includes("randomBytes"), "fixture suffix must come from node:crypto");
  });

  it("phase27 DR drill never prints raw error text (alert 56)", () => {
    const drill = readFileSync("scripts/phase27-dr.test.mjs", "utf8");
    assert.ok(!/\$\{error\.message\}/.test(drill), "error.message must not be interpolated into console output");
    assert.ok(!/console\.error\(`[^`]*\$\{error\.(message|stack)/.test(drill));
  });

  it("CodeQL config enables security-extended with no first-party exclusions", () => {
    // Line-based triage of the CodeQL config (no YAML dependency at this scope).
    const config = readFileSync(".github/codeql/codeql-config.yml", "utf8");
    assert.match(config, /^queries:\n( {2}- uses: )?security-extended$/m, "config must select the security-extended suite");
    const ignoredPaths = config
      .split("\n")
      .slice(config.indexOf("paths-ignore:") + 1)
      .filter((l) => /^ {2}- /.test(l))
      .map((l) => l.trim().replace("- ", ""));
    // Only generated/build artifacts may be excluded — never first-party source,
    // threat/fixture directories, or scope-mapped docs.
    const allowed = new Set(["dist", "packages/*/dist", "node_modules", "release-artifacts", "security-artifacts"]);
    for (const path of ignoredPaths) assert.ok(allowed.has(path), `unexpected CodeQL paths-ignore entry: ${path}`);
    // Negative: security suites and fixtures are scanned.
    for (const forbidden of ["scripts", "packages/*/src", "packages/*/fixtures", "docs", "test"])
      assert.ok(!ignoredPaths.some((p) => p === forbidden || p.startsWith(`${forbidden}/`)), `${forbidden} must not be CodeQL-ignored`);

    // Workflow: security-extended runs on push/PR/schedule with the 10-minute bound.
    const workflow = readFileSync(".github/workflows/security.yml", "utf8");
    assert.ok(/push:\n[\s\S]*?branches:/u.test(workflow), "workflow must run on push");
    assert.match(workflow, /^ {2}pull_request:$/m);
    assert.match(workflow, /cron: /);
    assert.match(workflow, /timeout-minutes: 10/);
    assert.match(workflow, /config-file: \.\/\.github\/codeql\/codeql-config\.yml/);
  });
});
