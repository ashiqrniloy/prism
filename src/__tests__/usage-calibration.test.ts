import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { estimateMessageTokens, type Message, MODEL_FAMILY_TOKENS, type ModelFamily, resolveModelFamily } from "../index.js";
// The text projection is the seam the fixture records: no chat-template overhead.
// Module-private by design (not re-exported from the root barrel).
import { estimateTextTokensForFamily } from "../usage-estimation.js";

// Plan 103 Task 3. Frozen corpus + recorded reference counts for every calibrated
// family, so a silent ratio or overhead edit fails here instead of drifting in
// production. Reference provenance is per row: `measured` (tiktoken o200k_base
// dev-time oracle), `published-range` (vendor chars/token guidance), or
// `row-basis` (no public guidance/endpoint — the row is its own frozen basis).
// Re-measure with `scripts/usage-calibration-live.test.mjs`; that leg also
// refreshes docs/_evidence/phase103-family-token-calibration.md.

interface CalibrationRow {
  readonly provenance: "measured" | "published-range" | "row-basis";
  readonly source: string;
  readonly charsPerToken: number;
  readonly perMessageOverhead: number;
  readonly proseTokens: number;
  readonly cjkTokens: number;
  readonly chatTokens: number;
}
interface CalibrationFixture {
  readonly schemaVersion: number;
  readonly recordedAt: string;
  readonly projection: string;
  readonly bands: { readonly prose: number; readonly cjk: number; readonly chat: number; readonly perMessageOverheadTokens: number };
  readonly corpus: {
    readonly prose: string;
    readonly cjk: string;
    readonly chat: readonly { readonly role: "user" | "assistant"; readonly text: string }[];
  };
  readonly rows: Readonly<Record<string, CalibrationRow>>;
}

const fixture = JSON.parse(readFileSync("src/__tests__/fixtures/usage-calibration.json", "utf8")) as CalibrationFixture;

/** Every family except the conservative `unknown` fallback is a calibrated row. */
const calibratedFamilies = (Object.keys(MODEL_FAMILY_TOKENS) as ModelFamily[]).filter((family) => family !== "unknown");

function userText(text: string): Message {
  return { role: "user", content: [{ type: "text", text }] };
}

function chatMessages(): Message[] {
  return fixture.corpus.chat.map((message) => ({ role: message.role, content: [{ type: "text", text: message.text }] }));
}

/** Fails with both numbers, which is what makes a drifted row debuggable. */
function checkBand(label: string, estimated: number, reference: number, band: number): void {
  const drift = Math.abs(estimated - reference) / reference;
  assert.ok(
    drift <= band,
    `${label}: estimated ${estimated} vs recorded ${reference} (${(drift * 100).toFixed(1)}% drift, band ${(band * 100).toFixed(0)}%)`,
  );
}

describe("family token calibration (plan 103 T3)", () => {
  it("the frozen corpus and rows cover every calibrated family", () => {
    assert.equal(fixture.schemaVersion, 1);
    assert.match(fixture.recordedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(fixture.corpus.prose.length > 0 && fixture.corpus.cjk.length > 0 && fixture.corpus.chat.length >= 2);
    assert.deepEqual(Object.keys(fixture.rows).sort(), [...calibratedFamilies].sort());
    assert.equal(
      new Set(Object.values(fixture.rows).map((row) => row.provenance)).has("measured"),
      true,
      "at least one row is an oracle measurement",
    );
    for (const [family, row] of Object.entries(fixture.rows)) {
      assert.ok(row.provenance === "measured" || row.provenance === "published-range" || row.provenance === "row-basis", family);
      assert.ok(row.source.length > 0, `${family} must name its provenance source`);
      for (const count of [row.proseTokens, row.cjkTokens, row.chatTokens]) {
        assert.ok(Number.isInteger(count) && count > 0, `${family} recorded counts must be positive integers`);
      }
    }
  });

  it("every shipped row estimates the recorded corpus inside its documented band", () => {
    const { bands } = fixture;
    for (const family of calibratedFamilies) {
      const row = fixture.rows[family];
      assert.ok(row, `${family} has no recorded row`);
      checkBand(`${family} prose`, estimateTextTokensForFamily(fixture.corpus.prose, family), row.proseTokens, bands.prose);
      checkBand(`${family} cjk`, estimateTextTokensForFamily(fixture.corpus.cjk, family), row.cjkTokens, bands.cjk);
      const chatText = fixture.corpus.chat.reduce((sum, message) => sum + estimateTextTokensForFamily(message.text, family), 0);
      checkBand(`${family} chat`, chatText, row.chatTokens, bands.chat);
      // The array form is the text projection plus exactly one overhead per message.
      const total = estimateMessageTokens(chatMessages(), family).tokens;
      assert.equal(
        total,
        chatText + MODEL_FAMILY_TOKENS[family].perMessageOverhead * fixture.corpus.chat.length,
        `${family} chat overhead`,
      );
    }
  });

  it("per-message overhead stays inside the recorded ±1 token band", () => {
    for (const family of calibratedFamilies) {
      const recorded = fixture.rows[family].perMessageOverhead;
      assert.ok(
        Math.abs(MODEL_FAMILY_TOKENS[family].perMessageOverhead - recorded) <= fixture.bands.perMessageOverheadTokens,
        `${family} overhead: shipped ${MODEL_FAMILY_TOKENS[family].perMessageOverhead} vs recorded ${recorded} (band ±${fixture.bands.perMessageOverheadTokens})`,
      );
    }
  });

  it("a shifted row fails the band check with both numbers", () => {
    // Negative control: the fixture records 106 prose tokens for openai; a
    // deliberately wrong estimate must fail loudly instead of passing silently.
    assert.throws(
      () => checkBand("openai prose (negative control)", 160, 106, fixture.bands.prose),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        return message.includes("estimated 160") && message.includes("recorded 106") && message.includes("drift");
      },
    );
  });

  it("an unmatched model stays conservative and low-confidence", () => {
    assert.equal(resolveModelFamily("mystery-model-9"), "unknown");
    const unknown = estimateMessageTokens([userText(fixture.corpus.prose)], "mystery-model-9");
    const openai = estimateMessageTokens([userText(fixture.corpus.prose)], "gpt-5");
    assert.equal(unknown.confidence, "low");
    assert.equal(unknown.lowConfidence, true);
    assert.ok(unknown.tokens > openai.tokens, "the unknown table must over-count, never under-count");
  });
});
