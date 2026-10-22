import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getInspectorScript, inspectorPageResponse, UI_CSP } from "../ui/assets.js";
import { describeRecord, formatJson, LIVE_FEED_LIMIT, REPLAY_PAGE_SIZE } from "../ui/inspector.js";

describe("devtools page", () => {
  it("labels a session entry or event by its type and id", () => {
    assert.equal(describeRecord({ type: "message", id: "m1" }), "message m1");
    assert.equal(describeRecord({ type: "run.started" }), "run.started");
    assert.equal(describeRecord({}), "record");
    assert.equal(describeRecord("plain"), "plain");
    assert.equal(describeRecord(null), "null");
  });

  it("formats JSON for display", () => {
    assert.equal(formatJson({ a: 1 }), '{\n  "a": 1\n}');
    assert.equal(formatJson(undefined), "undefined");
  });

  it("bounds the live feed and the replay page", () => {
    assert.equal(LIVE_FEED_LIMIT, 500);
    assert.equal(REPLAY_PAGE_SIZE, 100);
  });

  it("serves the page under the strict CSP", async () => {
    const response = inspectorPageResponse();
    assert.equal(response.headers.get("content-security-policy"), UI_CSP);
    const html = await response.text();
    assert.match(html, /<title>prism devtools<\/title>/);
    assert.match(html, /id="compare-input"/);
    assert.doesNotMatch(html, /<script>(?!<\/script>)/, "no inline script: the CSP forbids it");
  });

  it("transpiles the browser module without imports and renders text only", () => {
    const script = getInspectorScript();
    assert.doesNotMatch(script, /^import /m);
    assert.match(script, /export function mount/);
    assert.doesNotMatch(script, /innerHTML/, "payloads must render as text nodes");
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../ui/inspector.ts"), "utf8");
    assert.doesNotMatch(source, /^import\s/m, "the browser module has no imports");
  });
});
