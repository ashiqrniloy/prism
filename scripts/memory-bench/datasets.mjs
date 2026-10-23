import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import confirmatory from "./confirmatory.json" with { type: "json" };
import heldoutV2 from "./heldout-v2.json" with { type: "json" };
import heldoutV3 from "./heldout-v3.json" with { type: "json" };
import screenMsV1 from "./screen-ms-v1.json" with { type: "json" };
import screenV1 from "./screen-v1.json" with { type: "json" };
import subsets from "./subsets.json" with { type: "json" };
/** Plan 188.9 Task 4 screening draw: fixed salt, five ids per LongMemEval ability. */
export const SCREEN_V1_SALT = "prism-188.9-memory-bench-screen-v1";
export const SCREEN_V1_IDS_PER_ABILITY = 5;
/** Plan 188.10 Task 2 live held-out draw, and the development screen that gates it. */
export const HELDOUT_V3_SALT = "prism-188.10-memory-bench-v3";
export const HELDOUT_V3_STRATA = {
  "multi-session": 40,
  "knowledge-update": 20,
  "temporal-reasoning": 20,
  "single-session-user": 14,
  "single-session-assistant": 6,
};
export const SCREEN_MS_V1_SALT = "prism-188.10-memory-bench-screen-ms-v1";
export const SCREEN_MS_V1_DEVELOPMENT_COUNT = 10;

export class MemoryBenchDatasetError extends Error {
  name = "MemoryBenchDatasetError";
}
export const DATASETS = {
  "dreambench-swe": {
    file: "dreambench-swe-v2.jsonl",
    format: "jsonl",
    bytes: 329844,
    sha256: "d6573c46aa6a75cee7a8193034b0bf86a1d63422dc7deef8a03e2b81bbcf4d73",
    license: "Apache-2.0",
    url: "https://raw.githubusercontent.com/iroiro147/dreambench-swe/d340bb2eaf3a81691820ef0683cd652753a9fa5a/experiments/env/sequences_confirmatory_v2.jsonl",
    licenseUrl: "https://github.com/iroiro147/dreambench-swe/blob/d340bb2eaf3a81691820ef0683cd652753a9fa5a/LICENSE",
  },
  vibemembench: {
    file: "vibemembench.parquet",
    format: "parquet",
    bytes: 1104552,
    sha256: "22238743ca143276e3ff4616f569b3921c42945bfee1a6aa8fa376a02feebb98",
    license: "Apache-2.0",
    url: "https://huggingface.co/datasets/Tongyi-ConvAI/VibeMemBench/resolve/11164976b4f920cdb0d0cd570ca572e49acea1e8/test.parquet",
    licenseUrl: "https://huggingface.co/datasets/Tongyi-ConvAI/VibeMemBench/blob/11164976b4f920cdb0d0cd570ca572e49acea1e8/README.md",
  },
  "longmemeval-s": {
    file: "longmemeval-s.json",
    bytes: 277383467,
    sha256: "d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442",
    license: "MIT",
    url: "https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/98d7416c24c778c2fee6e6f3006e7a073259d48f/longmemeval_s_cleaned.json",
    licenseUrl: "https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/blob/98d7416c24c778c2fee6e6f3006e7a073259d48f/README.md",
  },
  locomo: {
    file: "locomo.json",
    bytes: 2805274,
    sha256: "79fa87e90f04081343b8c8debecb80a9a6842b76a7aa537dc9fdf651ea698ff4",
    license: "CC BY-NC 4.0 (noncommercial)",
    url: "https://raw.githubusercontent.com/snap-research/locomo/3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376/data/locomo10.json",
    licenseUrl: "https://github.com/snap-research/locomo/blob/3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376/LICENSE.txt",
  },
  "memoryagentbench-cr": {
    file: "memoryagentbench-cr.parquet",
    bytes: 1491588,
    sha256: "24d5c3f09ce0ce15625cb9f8a98f44f0d864ca6c94d7b4ad04eb697ca3a5ff45",
    license: "MIT",
    url: "https://huggingface.co/datasets/ai-hyz/MemoryAgentBench/resolve/7ea066982b140a19337e17e60d45d4076e042faf/data/Conflict_Resolution-00000-of-00001.parquet",
    licenseUrl: "https://huggingface.co/datasets/ai-hyz/MemoryAgentBench/blob/7ea066982b140a19337e17e60d45d4076e042faf/README.md",
  },
};
async function readPinnedBytes(source, expectedBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of source) {
    size += chunk.byteLength;
    if (size > expectedBytes) throw new MemoryBenchDatasetError("Dataset exceeds pinned byte size");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export async function loadPinnedArtifact(
  pin,
  { cache = join(process.env.PRISM_CACHE_DIR ?? join(homedir(), ".cache/prism"), "memory-bench"), fetch: transport = fetch } = {},
) {
  if (!pin) throw new MemoryBenchDatasetError("Unknown benchmark suite");
  await mkdir(cache, { recursive: true });
  const path = join(cache, pin.file);
  let bytes;
  if (existsSync(path)) bytes = await readPinnedBytes(createReadStream(path), pin.bytes);
  else {
    const response = await transport(pin.url, { signal: AbortSignal.timeout(180_000) });
    if (!response.ok) throw new MemoryBenchDatasetError(`Dataset download failed (${response.status})`);
    bytes = await readPinnedBytes(response.body ?? [], pin.bytes);
  }
  if (
    bytes.length !== pin.bytes ||
    (pin.sha256
      ? createHash("sha256").update(bytes).digest("hex") !== pin.sha256
      : createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") !== pin.gitBlob)
  ) {
    throw new MemoryBenchDatasetError(`Checksum/size mismatch for ${pin.file}; remove the corrupt cache file explicitly`);
  }
  if (!existsSync(path)) {
    const temp = `${path}.${process.pid}.tmp`;
    try {
      await writeFile(temp, bytes);
      await rename(temp, path);
    } finally {
      await rm(temp, { force: true });
    }
  }
  await writeFile(`${path}.license.json`, `${JSON.stringify({ license: pin.license, source: pin.licenseUrl }, null, 2)}\n`);
  return bytes;
}
export async function loadDataset(suite, options) {
  const pin = DATASETS[suite];
  const bytes = await loadPinnedArtifact(pin, options);
  if (pin.format === "jsonl")
    return bytes
      .toString("utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  if (suite !== "memoryagentbench-cr" && pin.format !== "parquet") return JSON.parse(bytes);
  try {
    return JSON.parse(
      execFileSync(
        process.env.PRISM_MEMORY_BENCH_PYTHON ?? "python3",
        [
          "-c",
          'import pyarrow,pyarrow.parquet as p,json,sys; assert pyarrow.__version__ == "23.0.1"; print(json.dumps(p.read_table(pyarrow.BufferReader(sys.stdin.buffer.read())).to_pylist()))',
        ],
        { input: bytes, timeout: 30_000, maxBuffer: 32 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] },
      ),
    );
  } catch {
    throw new MemoryBenchDatasetError("Parquet decoding requires benchmark-only pyarrow==23.0.1; see README and PRISM_MEMORY_BENCH_PYTHON");
  }
}
export function isoDate(value) {
  // LongMemEval dates omit a timezone; dataset dates are treated as UTC, never host-local.
  const locomo = /^(\d+):(\d+) (am|pm) on (.+)$/i.exec(value ?? "");
  const date = locomo
    ? `${locomo[4]} ${(Number(locomo[1]) % 12) + (locomo[3].toLowerCase() === "pm" ? 12 : 0)}:${locomo[2]} UTC`
    : /Z$|[+-]\d\d:\d\d$/.test(value ?? "")
      ? value
      : `${value} UTC`;
  const timestamp = Date.parse(date);
  if (!Number.isFinite(timestamp)) throw new MemoryBenchDatasetError("Invalid dataset timestamp");
  return new Date(timestamp).toISOString();
}
const categories = { 1: "multi-hop", 2: "temporal", 3: "open-domain", 4: "single-hop", 5: "adversarial" };
export function normalizeDataset(rows, suite) {
  if (["dreambench-swe", "vibemembench"].includes(suite)) return rows.map((row) => normalizeCodingItem(row, suite));
  if (suite === "longmemeval-s")
    return rows.map((row) => {
      // The cleaned dataset repeats a session id occasionally. Keep every occurrence, but make
      // entry ids unique and map gold answer sessions onto all copies.
      const seen = new Map();
      const copies = new Map();
      const sessions = row.haystack_sessions.map((messages, i) => {
        const base = String(row.haystack_session_ids[i]);
        const copy = (seen.get(base) ?? 0) + 1;
        seen.set(base, copy);
        const id = copy === 1 ? base : `${base}~${copy}`;
        copies.set(base, [...(copies.get(base) ?? []), id]);
        return {
          id,
          date: isoDate(row.haystack_dates[i]),
          messages: messages.map((message, j) => ({
            id: `${id}:${j}`,
            role: message.role,
            text: message.content,
            hasAnswer: Boolean(message.has_answer),
          })),
        };
      });
      return {
        id: String(row.question_id),
        ability: row.question_id.endsWith("_abs") ? "abstention" : row.question_type,
        question: row.question,
        answers: [String(row.answer)],
        date: isoDate(row.question_date),
        sessions,
        answerSessionIds: (row.answer_session_ids ?? []).flatMap((id) => copies.get(String(id)) ?? [String(id)]),
        // Questions that share a haystack session share context; a question is not an independent unit.
        cluster: `lme-${createHash("sha256")
          .update([...row.haystack_session_ids].sort().join("\n"))
          .digest("hex")
          .slice(0, 12)}`,
      };
    });
  if (suite === "locomo")
    return rows.flatMap((row) => {
      const sessions = Object.keys(row.conversation)
        .filter((key) => /^session_\d+$/.test(key))
        .sort((a, b) => Number(a.slice(8)) - Number(b.slice(8)))
        .map((key) => ({
          id: key,
          date: isoDate(row.conversation[`${key}_date_time`]),
          messages: row.conversation[key].map((message) => ({
            id: message.dia_id,
            role: message.speaker === row.conversation.speaker_a ? "user" : "assistant",
            text: `${message.speaker}: ${message.text}${message.blip_caption ? ` [Image caption: ${message.blip_caption}]` : ""}`,
          })),
        }));
      return row.qa.map((qa, i) => ({
        id: `${row.sample_id}:${i}`,
        conversationId: row.sample_id,
        cluster: `locomo-${row.sample_id}`,
        ability: categories[qa.category],
        question: qa.question,
        // adversarial_answer is the tempting wrong answer, never the gold answer.
        answers: [String(qa.answer ?? "The conversation does not contain enough information to answer.")],
        evidence: qa.evidence ?? [],
        date: sessions.at(-1).date,
        sessions,
      }));
    });
  return rows.flatMap((row, i) => {
    const sessions = row.context
      .split("\n")
      .filter(Boolean)
      .map((text, j) => ({
        date: new Date(Date.UTC(2000, 0, 1, 0, j)).toISOString(),
        messages: [{ id: `fact:${i}:${j}`, role: "user", text }],
      }));
    return row.questions.map((question, j) => ({
      id: `${i}:${j}`,
      cluster: `mab-${i}`,
      source: row.metadata.source,
      ability: row.metadata.source.includes("_mh_") ? "conflict-resolution-multi-hop" : "conflict-resolution-single-hop",
      question,
      answers: row.answers[j].map(String),
      date: sessions.at(-1).date,
      syntheticDates: true,
      sessions,
    }));
  });
}
/** Draw from id/ability metadata only; labels and history never participate. */
export function drawHeldoutV2(questions) {
  const excluded = new Set([
    ...Object.values(subsets.longmemeval.base).flat(),
    ...Object.values(subsets.longmemeval.targeted).flat(),
    ...Object.values(confirmatory.abilities).flat(),
  ]);
  const abilities = {};
  for (const ability of Object.keys(heldoutV2.abilities)) {
    const candidates = questions.filter((row) => row.ability === ability && !excluded.has(row.id));
    if (candidates.length < 20 || new Set(candidates.map((row) => row.id)).size !== candidates.length)
      throw new MemoryBenchDatasetError(`Held-out v2 stratum is short or duplicated: ${ability}`);
    const hash = (id) => createHash("sha256").update(`prism-188.8-memory-bench-v2:${id}`).digest("hex");
    abilities[ability] = candidates
      .sort((a, b) => hash(a.id).localeCompare(hash(b.id)))
      .slice(0, 20)
      .map((row) => row.id);
  }
  return abilities;
}

/**
 * Plan 188.9 Task 4: a frozen 5-per-ability screening draw from the development (confirmatory)
 * pool, so a screen never touches a held-out id and never depends on dataset order.
 */
export function drawScreenV1(abilities = confirmatory.abilities) {
  const hash = (id) => createHash("sha256").update(`${SCREEN_V1_SALT}:${id}`).digest("hex");
  return Object.fromEntries(
    Object.entries(abilities).map(([ability, ids]) => [
      ability,
      [...ids].sort((a, b) => hash(a).localeCompare(hash(b))).slice(0, SCREEN_V1_IDS_PER_ABILITY),
    ]),
  );
}

/**
 * Plan 188.10 Task 2: the live held-out draw. Every prior partition is excluded, including held-out
 * v2, whose labels were read after 188.9's paid runs. Ids and abilities only; the residual pool
 * counts are recorded in `heldout-v3.json` so a stratum that cannot be drawn again is visible.
 */
export function drawHeldoutV3(questions) {
  const excluded = new Set([
    ...Object.values(subsets.longmemeval.base).flat(),
    ...Object.values(subsets.longmemeval.targeted).flat(),
    ...Object.values(confirmatory.abilities).flat(),
    ...Object.values(heldoutV2.abilities).flat(),
  ]);
  const hash = (id) => createHash("sha256").update(`${HELDOUT_V3_SALT}:${id}`).digest("hex");
  const abilities = {};
  for (const [ability, size] of Object.entries(HELDOUT_V3_STRATA)) {
    const candidates = questions.filter((row) => row.ability === ability && !excluded.has(row.id));
    if (candidates.length < size || new Set(candidates.map((row) => row.id)).size !== candidates.length)
      throw new MemoryBenchDatasetError(`Held-out v3 stratum is short or duplicated: ${ability}`);
    abilities[ability] = candidates
      .sort((a, b) => hash(a.id).localeCompare(hash(b.id)))
      .slice(0, size)
      .map((row) => row.id);
  }
  return abilities;
}

/**
 * Plan 188.10 Task 2: development-only screen for the multi-session fix. It reuses the 20 held-out
 * v2 multi-session ids (now development data, with committed `fabric-x` outcomes), draws 10 more
 * from the 30-id development multi-session pool, and keeps `screen-v1`'s 30 non-multi-session ids
 * so a fix for multi-session cannot quietly regress another ability.
 */
export function drawScreenMsV1() {
  const held = heldoutV2.abilities["multi-session"];
  const pool = subsets.longmemeval.targeted["multi-session"];
  const heldSet = new Set(held);
  const hash = (id) => createHash("sha256").update(`${SCREEN_MS_V1_SALT}:${id}`).digest("hex");
  const drawn = pool
    .filter((id) => !heldSet.has(id))
    .sort((a, b) => hash(a).localeCompare(hash(b)))
    .slice(0, SCREEN_MS_V1_DEVELOPMENT_COUNT);
  if (drawn.length < SCREEN_MS_V1_DEVELOPMENT_COUNT)
    throw new MemoryBenchDatasetError("Screen multi-session draw is short: the development pool is exhausted");
  const rest = Object.entries(screenV1.abilities).filter(([ability]) => ability !== "multi-session");
  if (rest.some(([, ids]) => ids.length !== SCREEN_V1_IDS_PER_ABILITY))
    throw new MemoryBenchDatasetError("Screen v1 non-multi-session stratum is short");
  return { "multi-session": [...held, ...drawn], ...Object.fromEntries(rest) };
}

export function selectQuestions(questions, suite, { subset = "base", ability } = {}) {
  if (subset === "all") return questions;
  let ids;
  if (suite === "longmemeval-s") {
    // Frozen draws are the only source of a subset's ids; a wrong id fails closed below.
    const frozen = {
      "screen-v1": screenV1,
      "screen-ms-v1": screenMsV1,
      "heldout-v2": heldoutV2,
      "heldout-v3": heldoutV3,
      confirmatory,
      development: confirmatory,
    }[subset];
    if (frozen) ids = ability ? frozen.abilities[ability] : Object.values(frozen.abilities).flat();
    else if (subset === "targeted") ids = subsets.longmemeval.targeted[ability];
    else ids = Array.from({ length: 10 }, (_, index) => Object.values(subsets.longmemeval.base).map((ids) => ids[index])).flat();
  } else if (suite === "locomo")
    ids = questions.filter((row) => subsets.locomo.conversations.includes(row.conversationId)).map((row) => row.id);
  else ids = subsets.memoryagentbench.pairs.map((pair) => pair.join(":"));
  if (!ids?.length) throw new MemoryBenchDatasetError("Invalid or empty pinned subset");
  const byId = new Map(questions.map((row) => [row.id, row]));
  if (new Set(ids).size !== ids.length || ids.some((id) => !byId.has(id)))
    throw new MemoryBenchDatasetError("Pinned subset ids are missing or duplicated");
  return ids.map((id) => byId.get(id));
}

export function normalizeCodingItem(row, suite) {
  if (suite === "dreambench-swe") {
    if (
      !row.seq_id ||
      !Array.isArray(row.sessions) ||
      !row.sessions.every((s) => typeof s.instruction === "string" && Number.isInteger(s.session_index))
    )
      throw new MemoryBenchDatasetError("DreamBench schema invalid");
    // Oracle labels, decisive literals and validation metadata never enter solver input.
    return {
      id: row.seq_id,
      ability: row.construct_label,
      sessions: row.sessions.map((s) => ({ id: `${row.seq_id}:${s.session_index}`, instruction: s.instruction })),
    };
  }
  if (
    suite !== "vibemembench" ||
    !/^[\w.-]+\/[\w.-]+$/.test(row.repo) ||
    !/^[a-f0-9]{40}$/.test(row.base_commit) ||
    !Number.isSafeInteger(Number(/-(\d+)$/.exec(row.instance_id)?.[1] ?? NaN)) ||
    !row.instance_id.startsWith(`${row.repo.replace("/", "__").toLowerCase()}-`) ||
    typeof row.problem_statement !== "string" ||
    !/^docker\.io\/swerebenchv2\/[a-zA-Z0-9_.:/-]+$/.test(row.image_name)
  )
    throw new MemoryBenchDatasetError("VibeMemBench schema invalid");
  return { id: row.instance_id, ability: "coding", question: row.problem_statement, date: "2000-01-01T00:00:00.000Z", sessions: [] };
}
