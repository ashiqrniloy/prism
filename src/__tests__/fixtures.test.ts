import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "bun:test";

/** The example fixtures the JSONL store package parses; a secret here would ship to readers. */
const fixturesDir = "examples/fixtures";

test("no_fixture_file_contains_a_real_looking_secret", async () => {
  const secret = /(?:sk-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{20,}|ghp_[A-Za-z0-9]{20,})/;
  for (const file of readdirSync(fixturesDir)) {
    if (!file.endsWith(".jsonl")) continue;
    const text = readFileSync(`${fixturesDir}/${file}`, "utf8");
    assert.ok(!secret.test(text), `${file} contains a real-looking secret`);
  }
});
