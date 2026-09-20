/**
 * Vendor token-count calibration legs (plan 103 Task 3).
 *
 * The shipped `MODEL_FAMILY_TOKENS` rows are frozen in
 * `src/__tests__/fixtures/usage-calibration.json`; this leg re-measures them
 * against the vendors that publish a count endpoint:
 *
 *   Anthropic: POST https://api.anthropic.com/v1/messages/count_tokens
 *              header `x-api-key` + `anthropic-version`; response `input_tokens`
 *   Google:    POST https://generativelanguage.googleapis.com/v1beta/models/{model}:countTokens
 *              header `x-goog-api-key`; response `totalTokens`
 *
 * Count-only requests, no generation, no streaming, one fixed corpus (prose,
 * CJK, chat transcript). Every leg compares the array-form estimate — text
 * projection plus one per-message overhead — against the vendor count inside
 * the fixture's documented band, and refreshes
 * `docs/_evidence/phase103-family-token-calibration.md` with model ids, fixture
 * ids, counts, measured-vs-shipped chars/token, date, and the endpoint used.
 *
 * Gating: `PRISM_LIVE_PROVIDER_TESTS=1` plus the vendor key; without either the
 * leg skips with a reason (skip-not-fail, strict mode fails the run not the
 * suite). A rejected credential fails the leg — a release gate wants to know.
 * Credentials come from the environment (`scripts/live.env` through the matrix
 * runner) and never appear in the evidence, which carries env var *names* only.
 *
 * Registered as matrix suite `calibration/vendor-count-tokens`; not in
 * `GATE_FILES` and not under the root `dist/__tests__/*.test.js` glob, so the
 * default `npm test` chain pays nothing.
 */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { estimateMessageTokens } from "@arnilo/prism";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GATE = "PRISM_LIVE_PROVIDER_TESTS";
const EVIDENCE = join(ROOT, "docs/_evidence/phase103-family-token-calibration.md");
const ANTHROPIC_ENDPOINT = "POST /v1/messages/count_tokens";
const GOOGLE_ENDPOINT = "POST /v1beta/models/{model}:countTokens";
const ANTHROPIC_MODEL = process.env.PRISM_LIVE_ANTHROPIC_MODEL?.trim() || "claude-haiku-4-5";
const GOOGLE_MODEL = process.env.PRISM_LIVE_GOOGLE_MODEL?.trim() || "gemini-2.5-flash-lite";

const fixture = JSON.parse(readFileSync(join(ROOT, "src/__tests__/fixtures/usage-calibration.json"), "utf8"));

/** Measurements collected by whichever legs ran; `null` = not measured this run. */
const measurements = { anthropic: null, google: null };

function userText(text) {
  return { role: "user", content: [{ type: "text", text }] };
}

function chatMessages() {
  return fixture.corpus.chat.map((message) => ({ role: message.role, content: [{ type: "text", text: message.text }] }));
}

/** Fixture ids → shipped-estimate messages. The vendor count carries its own
 *  chat-template overhead; so does `estimateMessageTokens` (per message). */
const SAMPLES = [
  { id: "prose", band: "prose", messages: [userText(fixture.corpus.prose)] },
  { id: "cjk", band: "cjk", messages: [userText(fixture.corpus.cjk)] },
  { id: "chat", band: "chat", messages: chatMessages() },
];

function checkBand(family, sample, vendorCount) {
  const estimate = estimateMessageTokens(sample.messages, family).tokens;
  const band = fixture.bands[sample.band];
  const drift = Math.abs(estimate - vendorCount) / vendorCount;
  assert.ok(
    drift <= band,
    `${family} ${sample.id}: shipped ${estimate} vs vendor ${vendorCount} (${(drift * 100).toFixed(1)}% drift, band ${(band * 100).toFixed(0)}%)`,
  );
  return estimate;
}

async function post(url, headers, body) {
  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = String(payload?.error?.message ?? payload?.error?.status ?? response.statusText).slice(0, 200);
    throw new Error(`${url} failed: HTTP ${response.status} ${detail}`);
  }
  return payload;
}

async function countAnthropic(key, messages) {
  const payload = await post(
    "https://api.anthropic.com/v1/messages/count_tokens",
    { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    { model: ANTHROPIC_MODEL, messages: messages.map(({ role, content }) => ({ role, content: content[0].text })) },
  );
  assert.ok(Number.isInteger(payload.input_tokens) && payload.input_tokens > 0, "anthropic response must carry input_tokens");
  return payload.input_tokens;
}

async function countGoogle(key, messages) {
  const payload = await post(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GOOGLE_MODEL)}:countTokens`,
    { "content-type": "application/json", "x-goog-api-key": key },
    {
      contents: messages.map(({ role, content }) => ({
        role: role === "assistant" ? "model" : "user",
        parts: [{ text: content[0].text }],
      })),
    },
  );
  assert.ok(Number.isInteger(payload.totalTokens) && payload.totalTokens > 0, "google response must carry totalTokens");
  return payload.totalTokens;
}

async function runVendor(family, model, endpoint, countFn) {
  const samples = [];
  for (const sample of SAMPLES) {
    const vendorCount = await countFn(sample.messages);
    const estimate = checkBand(family, sample, vendorCount);
    const chars = sample.messages.reduce((sum, message) => sum + message.content[0].text.length, 0);
    samples.push({
      id: sample.id,
      messages: sample.messages.length,
      chars,
      vendorCount,
      estimate,
      charsPerToken: chars / vendorCount,
      drift: estimate / vendorCount - 1,
    });
  }
  return { family, model, endpoint, samples };
}

function buildEvidence() {
  const corpus = [
    `| \`prose\` | 1 | ${fixture.corpus.prose.length} |`,
    `| \`cjk\` | 1 | ${fixture.corpus.cjk.length} |`,
    `| \`chat\` | ${fixture.corpus.chat.length} | ${fixture.corpus.chat.reduce((sum, message) => sum + message.text.length, 0)} |`,
  ].join("\n");
  const rows = Object.entries(fixture.rows)
    .map(
      ([family, row]) =>
        `| \`${family}\` | ${row.provenance} | ${row.charsPerToken} | ${row.perMessageOverhead} | ${row.proseTokens} | ${row.cjkTokens} | ${row.chatTokens} | ${row.source} |`,
    )
    .join("\n");
  const measured = [measurements.anthropic, measurements.google].filter(Boolean);
  const measuredTable =
    measured.length === 0
      ? [
          "| vendor | model | endpoint | status |",
          "| --- | --- | --- | --- |",
          `| anthropic | \`${ANTHROPIC_MODEL}\` | ${ANTHROPIC_ENDPOINT} | not measured — run with \`${GATE}=1\` and \`ANTHROPIC_API_KEY\` |`,
          `| google | \`${GOOGLE_MODEL}\` | ${GOOGLE_ENDPOINT} | not measured — run with \`${GATE}=1\` and \`GEMINI_API_KEY\`/\`GOOGLE_API_KEY\` |`,
        ].join("\n")
      : [
          "| vendor | model | endpoint | sample | vendor count | shipped estimate | drift | measured chars/token | shipped chars/token | band |",
          "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
          ...measured.flatMap((measurement) =>
            measurement.samples.map(
              (sample) =>
                `| ${measurement.family} | \`${measurement.model}\` | ${measurement.endpoint} | \`${sample.id}\` | ${sample.vendorCount} | ${sample.estimate} | ${(sample.drift * 100).toFixed(1)}% | ${sample.charsPerToken.toFixed(2)} | ${fixture.rows[measurement.family].charsPerToken} | ±${(fixture.bands[sample.id] * 100).toFixed(0)}% |`,
            ),
          ),
        ].join("\n");

  return [
    "# Phase 103 — Family token calibration",
    "",
    `Plan: [103-Usage-Estimation-And-Context-Meter-Follow-Ups.md](../../plans/103-Usage-Estimation-And-Context-Meter-Follow-Ups.md)`,
    `Task 3. Corpus frozen ${fixture.recordedAt} in \`src/__tests__/fixtures/usage-calibration.json\`; regenerated by \`scripts/usage-calibration-live.test.mjs\`.`,
    "",
    "Reference counts are text-only: a tokenizer/oracle count of the sample text without chat-template overhead. The",
    "deterministic leg (`src/__tests__/usage-calibration.test.ts`) compares the estimator's text projection and checks",
    "the recorded per-message overhead separately; the live legs below compare the array-form estimate (text + overhead",
    "per message) against the vendor count, which carries the vendor's own template overhead.",
    "",
    "## Corpus (fixture ids)",
    "",
    "| id | messages | chars |",
    "| --- | --- | --- |",
    corpus,
    "",
    "## Frozen rows and provenance",
    "",
    "| family | provenance | shipped chars/token | overhead/message | prose tokens | CJK tokens | chat tokens | source |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    rows,
    "",
    "## Live vendor measurements",
    "",
    measuredTable,
    "",
    "`anthropic` uses `x-api-key` + `anthropic-version` and reads `input_tokens`; `google` uses `x-goog-api-key`",
    "and reads `totalTokens`. Count-only requests — no generation, no streaming. A missing key skips that vendor",
    "with the reason above; a rejected credential fails the leg.",
    "",
    "## Recalibration procedure",
    "",
    "1. Run `PRISM_LIVE_PROVIDER_TESTS=1` with `ANTHROPIC_API_KEY` and/or `GEMINI_API_KEY`/`GOOGLE_API_KEY` set, and",
    "   `node --test scripts/usage-calibration-live.test.mjs` (or the matrix suite `calibration/vendor-count-tokens`).",
    "2. A drift inside the band means the shipped row is still good — leave it. A drift outside the band means the",
    "   vendor count moved: update the row in `src/usage-estimation.ts`, the recorded counts in the fixture, and this",
    "   file, in one change.",
    "3. `deepseek` and `openrouter-generic` have no public count endpoint; their rows stay row-basis frozen values.",
    "   `mistral` has published guidance only until a Mistral-compatible count endpoint is added.",
    "",
    "Secrets: this file carries env var names and model ids only — never a key, never a vendor response body beyond a count.",
    "",
  ].join("\n");
}

function writeEvidence() {
  const report = buildEvidence();
  assert.ok(
    !/(?:sk-|sk-ant-|xai-)[A-Za-z0-9_-]{10,}|Bearer\s+[A-Za-z0-9._-]{8,}|(?:api[_-]?key|secret|token)\s*=/i.test(report),
    "evidence must not contain secret-shaped strings",
  );
  for (const key of [process.env.ANTHROPIC_API_KEY, process.env.GEMINI_API_KEY, process.env.GOOGLE_API_KEY]) {
    if (key) assert.ok(!report.includes(key), "evidence must never contain a credential");
  }
  mkdirSync(dirname(EVIDENCE), { recursive: true });
  writeFileSync(EVIDENCE, report);
  return report;
}

const gateReason = process.env[GATE] === "1" ? undefined : `set ${GATE}=1 to run the vendor count-tokens legs`;
const anthropicKey = process.env.ANTHROPIC_API_KEY;
const googleKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

test("the evidence row regenerates with fixture ids, model ids, endpoints, and no secrets", () => {
  const report = writeEvidence();
  for (const expected of [
    "`prose`",
    "`cjk`",
    "`chat`",
    "`anthropic`",
    "`google`",
    ANTHROPIC_ENDPOINT,
    GOOGLE_ENDPOINT,
    ANTHROPIC_MODEL,
    GOOGLE_MODEL,
  ]) {
    assert.ok(report.includes(expected), `evidence must mention ${expected}`);
  }
});

test("anthropic count_tokens lands the shipped row inside the recorded band", {
  skip: gateReason ?? (anthropicKey ? false : "missing ANTHROPIC_API_KEY"),
}, async () => {
  measurements.anthropic = await runVendor("anthropic", ANTHROPIC_MODEL, ANTHROPIC_ENDPOINT, (messages) =>
    countAnthropic(anthropicKey, messages),
  );
});

test("google countTokens lands the shipped row inside the recorded band", {
  skip: gateReason ?? (googleKey ? false : "missing one of GEMINI_API_KEY, GOOGLE_API_KEY"),
}, async () => {
  measurements.google = await runVendor("google", GOOGLE_MODEL, GOOGLE_ENDPOINT, (messages) => countGoogle(googleKey, messages));
});

after(() => {
  writeEvidence();
});
