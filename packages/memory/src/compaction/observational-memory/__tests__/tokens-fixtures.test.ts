import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { type Message, type SessionEntry } from "@arnilo/prism";
import { estimateEntryTokens, estimateMessageTokens, estimateTextTokens } from "../tokens.js";

const fixture = JSON.parse(readFileSync(new URL("../../../../../../scripts/token-estimate-fixtures.json", import.meta.url), "utf8")) as {
  text: { id: string; text: string; memoryOmText: number }[];
  messages: { id: string; message: Message; memoryOm: number }[];
  entries: { id: string; entry: SessionEntry; memoryOm: number }[];
};

test("om token fixtures pin this site's columns", () => {
  assert.ok(fixture.text.length + fixture.messages.length + fixture.entries.length >= 20);
  for (const vector of fixture.text) assert.equal(estimateTextTokens(vector.text), vector.memoryOmText, vector.id);
  for (const vector of fixture.messages) assert.equal(estimateMessageTokens(vector.message), vector.memoryOm, vector.id);
  for (const vector of fixture.entries) assert.equal(estimateEntryTokens(vector.entry), vector.memoryOm, vector.id);
});
