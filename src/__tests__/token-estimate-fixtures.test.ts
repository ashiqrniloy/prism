import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { estimateMessageTokens, estimateTextTokens, type Message } from "../index.js";
import { estimateTextTokensForFamily } from "../usage-estimation.js";

const fixture = JSON.parse(readFileSync(new URL("../../scripts/token-estimate-fixtures.json", import.meta.url), "utf8")) as {
  text: { id: string; text: string; root: number; familyUnknown: number; familyOpenai: number; familyAnthropic: number }[];
  messages: { id: string; message: Message; root: number }[];
  entries: unknown[];
};

describe("token estimate fixtures", () => {
  it("pins root text, family text, and flattened message estimates", () => {
    assert.ok(fixture.text.length + fixture.messages.length + fixture.entries.length >= 20);
    for (const vector of fixture.text) {
      assert.equal(estimateTextTokens(vector.text), vector.root, vector.id);
      assert.equal(estimateTextTokensForFamily(vector.text), vector.familyUnknown, `${vector.id} unknown`);
      assert.equal(estimateTextTokensForFamily(vector.text, "openai"), vector.familyOpenai, `${vector.id} openai`);
      assert.equal(estimateTextTokensForFamily(vector.text, "anthropic"), vector.familyAnthropic, `${vector.id} anthropic`);
    }
    for (const vector of fixture.messages) {
      assert.equal(estimateMessageTokens(vector.message), vector.root, vector.id);
    }
  });
});
