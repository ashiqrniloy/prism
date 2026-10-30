import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import confirmatory from "./confirmatory.json" with { type: "json" };
import heldoutV2 from "./heldout-v2.json" with { type: "json" };
import heldoutV3 from "./heldout-v3.json" with { type: "json" };
import { isRobustnessSubset, robustnessDraw } from "./robustness.mjs";
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
    format: "parquet",
    bytes: 1491588,
    sha256: "24d5c3f09ce0ce15625cb9f8a98f44f0d864ca6c94d7b4ad04eb697ca3a5ff45",
    license: "MIT",
    url: "https://huggingface.co/datasets/ai-hyz/MemoryAgentBench/resolve/7ea066982b140a19337e17e60d45d4076e042faf/data/Conflict_Resolution-00000-of-00001.parquet",
    licenseUrl: "https://huggingface.co/datasets/ai-hyz/MemoryAgentBench/blob/7ea066982b140a19337e17e60d45d4076e042faf/README.md",
  },
  // Plan 202 Task 2: the robustness suite. Pins verified against the Hugging Face tree API on
  // 2026-10-27. LongMemEval-M is one 2.7 GB JSON array, read incrementally (see loadDataset).
  "longmemeval-m": {
    file: "longmemeval-m.json",
    format: "json-array-stream",
    bytes: 2737100077,
    sha256: "9d79e5524794a2e6900a3aa9cb7d9152c5a3e8319c9a87c25494ba1eacee495f",
    license: "MIT",
    url: "https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/98d7416c24c778c2fee6e6f3006e7a073259d48f/longmemeval_m_cleaned.json",
    licenseUrl: "https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/blob/98d7416c24c778c2fee6e6f3006e7a073259d48f/README.md",
  },
  "beam-100k": {
    file: "beam-100k.parquet",
    format: "parquet",
    parquetLiterals: ["probing_questions"],
    bytes: 5429768,
    sha256: "c0519be25907005ba873c927c50877471d550873039d96c041554d0075a78ace",
    license: "CC BY-SA 4.0",
    url: "https://huggingface.co/datasets/Mohammadta/BEAM/resolve/3205395e897e7318c7b094ef4e6047b9b82dbb03/data/100K-00000-of-00001.parquet",
    licenseUrl: "https://huggingface.co/datasets/Mohammadta/BEAM/blob/3205395e897e7318c7b094ef4e6047b9b82dbb03/README.md",
  },
  "beam-500k": {
    file: "beam-500k.parquet",
    format: "parquet",
    parquetLiterals: ["probing_questions"],
    bytes: 33956263,
    sha256: "af05921c979355038e1761b7cde3d2dd713200dd3071b278de0200f6c7f30122",
    license: "CC BY-SA 4.0",
    url: "https://huggingface.co/datasets/Mohammadta/BEAM/resolve/3205395e897e7318c7b094ef4e6047b9b82dbb03/data/500K-00000-of-00001.parquet",
    licenseUrl: "https://huggingface.co/datasets/Mohammadta/BEAM/blob/3205395e897e7318c7b094ef4e6047b9b82dbb03/README.md",
  },
  "beam-1m": {
    file: "beam-1m.parquet",
    format: "parquet",
    parquetLiterals: ["probing_questions"],
    bytes: 66156374,
    sha256: "41b5acbbb55a586b1305514ef9d9fb03365d9b3331b598a1c2dd7603d93ef533",
    license: "CC BY-SA 4.0",
    url: "https://huggingface.co/datasets/Mohammadta/BEAM/resolve/3205395e897e7318c7b094ef4e6047b9b82dbb03/data/1M-00000-of-00001.parquet",
    licenseUrl: "https://huggingface.co/datasets/Mohammadta/BEAM/blob/3205395e897e7318c7b094ef4e6047b9b82dbb03/README.md",
  },
  // Optional track; two parts. `parts` pins supersede `file` for this suite only.
  "beam-10m": {
    format: "parquet",
    parquetLiterals: ["probing_questions"],
    parts: [
      {
        file: "beam-10m-0.parquet",
        bytes: 153844664,
        sha256: "31d96fd47ec56221d202e68792f26c00e49467dd4b36ee105c36ebd19ef78ad5",
        url: "https://huggingface.co/datasets/Mohammadta/BEAM-10M/resolve/9b2096193fe74e2837e4713e483351e19817773c/data/10M-00000-of-00002.parquet",
      },
      {
        file: "beam-10m-1.parquet",
        bytes: 189980875,
        sha256: "a4f13fe25af51d57405ae41008689c31d1421377f3efde56a024b441deb2ee65",
        url: "https://huggingface.co/datasets/Mohammadta/BEAM-10M/resolve/9b2096193fe74e2837e4713e483351e19817773c/data/10M-00001-of-00002.parquet",
      },
    ],
    license: "CC BY-SA 4.0",
    licenseUrl: "https://huggingface.co/datasets/Mohammadta/BEAM-10M/blob/9b2096193fe74e2837e4713e483351e19817773c/README.md",
  },
  memorycode: {
    file: "memorycode.parquet",
    format: "parquet",
    bytes: 11666648,
    sha256: "1edb12380ea3410c888fffa795f6ddd3251e4e634b84a7142c8386e7c2869733",
    license: "Apache-2.0",
    url: "https://huggingface.co/datasets/CohereLabsCommunity/memorycode/resolve/32d888b11c73c67be91414e571dfe98c5c20feac/data/test-00000-of-00001-a45d1855e46f30cb.parquet",
    licenseUrl: "https://huggingface.co/datasets/CohereLabsCommunity/memorycode/blob/32d888b11c73c67be91414e571dfe98c5c20feac/README.md",
  },
  // Generated, not downloaded: the project-owned 12-persona coding lifecycle suite (188.6 Task 4).
  "coding-longitudinal": {
    generated: "lifecycle-personas",
    file: "coding-longitudinal.json",
    license: "project-owned synthetic generator",
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
/**
 * Plan 202 Task 2: LongMemEval-M is a single 2.7 GB JSON array, larger than JavaScript's maximum
 * string length, so `JSON.parse` on the whole file cannot work. Split the top-level array at the
 * buffer level and parse one question at a time. Escapes and nested objects are tracked so a
 * brace or quote inside text never ends a row.
 */
export function parseJsonArrayIncremental(bytes) {
  let first = 0;
  while (first < bytes.length && (bytes[first] === 0x20 || bytes[first] === 0x0a || bytes[first] === 0x0d || bytes[first] === 0x09))
    first++;
  let last = bytes.length - 1;
  while (last >= 0 && (bytes[last] === 0x20 || bytes[last] === 0x0a || bytes[last] === 0x0d || bytes[last] === 0x09)) last--;
  if (bytes[first] !== 0x5b || bytes[last] !== 0x5d) throw new MemoryBenchDatasetError("Dataset is not a JSON array");
  const rows = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < bytes.length; index++) {
    const byte = bytes[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (byte === 0x5c) escaped = true;
      else if (byte === 0x22) inString = false;
      continue;
    }
    if (byte === 0x22) inString = true;
    else if (byte === 0x7b || byte === 0x5b) {
      if (depth === 0 && byte === 0x7b) start = index;
      if (byte === 0x7b) depth++;
    } else if (byte === 0x7d) {
      depth--;
      if (depth === 0 && start >= 0) {
        rows.push(JSON.parse(bytes.toString("utf8", start, index + 1)));
        start = -1;
      }
      if (depth < 0) throw new MemoryBenchDatasetError("Unbalanced JSON array stream");
    }
  }
  if (depth !== 0 || inString || escaped) throw new MemoryBenchDatasetError("Unterminated JSON array stream");
  return rows;
}
/** Parquet needs benchmark-only pyarrow==23.0.1; the 1M/10M tracks exceed the old 32 MiB buffer. */
const PARQUET_READER = `import ast,json,sys
import pyarrow,pyarrow.parquet as p
assert pyarrow.__version__ == "23.0.1"
rows = p.read_table(pyarrow.BufferReader(sys.stdin.buffer.read())).to_pylist()
for row in rows:
    for key in [k for k in sys.argv[1].split(",") if k]:
        if isinstance(row.get(key), str):
            try: row[key] = ast.literal_eval(row[key])
            except Exception: pass
print(json.dumps(rows))`;
function readParquet(bytes, pin) {
  try {
    return JSON.parse(
      execFileSync(process.env.PRISM_MEMORY_BENCH_PYTHON ?? "python3", ["-c", PARQUET_READER, (pin.parquetLiterals ?? []).join(",")], {
        input: bytes,
        timeout: 300_000,
        maxBuffer: 512 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );
  } catch {
    throw new MemoryBenchDatasetError("Parquet decoding requires benchmark-only pyarrow==23.0.1; see README and PRISM_MEMORY_BENCH_PYTHON");
  }
}
export async function loadDataset(suite, options) {
  const pin = DATASETS[suite];
  if (!pin) throw new MemoryBenchDatasetError(`Unknown benchmark suite: ${suite}`);
  if (pin.generated) return [];
  if (pin.parts) {
    const parts = [];
    for (const part of pin.parts)
      parts.push(...readParquet(await loadPinnedArtifact({ ...part, license: pin.license, licenseUrl: pin.licenseUrl }, options), pin));
    return parts;
  }
  const bytes = await loadPinnedArtifact(pin, options);
  if (pin.format === "jsonl")
    return bytes
      .toString("utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  if (pin.format === "json-array-stream") return parseJsonArrayIncremental(bytes);
  if (pin.format === "parquet") return readParquet(bytes, pin);
  return JSON.parse(bytes);
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
export const BEAM_NORMALIZATION_VERSION = "beam-source-annotations-v1";

function beamSourceKey(id) {
  return typeof id === "string" && id.length > 0 ? id : Number.isSafeInteger(id) ? String(id) : null;
}

/** Source ids are local to one plan; duplicate ids are ambiguous, never array offsets. */
function beamSourceAnnotations(item, messageBySourceId) {
  const references = [];
  const visit = (value, label = null) => {
    if (Array.isArray(value)) {
      for (const id of value) visit(id, label);
    } else if (value !== null && typeof value === "object") {
      for (const [key, ids] of Object.entries(value)) visit(ids, label === null ? key : `${label}.${key}`);
    } else {
      const key = beamSourceKey(value);
      const messageId = key === null ? undefined : messageBySourceId.get(key);
      references.push({
        sourceId: value,
        label,
        messageId: messageId ?? null,
        status: messageId ? "resolved" : messageId === null ? "ambiguous" : "unknown",
      });
    }
  };
  if (item.source_chat_ids !== undefined) visit(item.source_chat_ids);
  return { sourceChatIds: item.source_chat_ids ?? null, references, rubric: item.rubric ?? null };
}
/** BEAM anchors look like "March-15, 2024" or "March 15, 2024"; fall back rather than fail the suite. */
function beamDate(value, fallbackDate) {
  try {
    return isoDate(String(value ?? "").replace(/-(?=\d{1,2},)/, " "));
  } catch {
    return /\d{4}-\d{2}-\d{2}/.test(fallbackDate) ? `${fallbackDate.slice(0, 10)}T00:00:00.000Z` : "2000-01-01T00:00:00.000Z";
  }
}
export function normalizeDataset(rows, suite) {
  if (["dreambench-swe", "vibemembench"].includes(suite)) return rows.map((row) => normalizeCodingItem(row, suite));
  // Generated by the project-owned lifecycle generator; each item is one persona setting.
  if (suite === "coding-longitudinal")
    return Array.from({ length: 12 }, (_, index) => ({ id: `p${index}`, ability: "coding-lifecycle", sessions: [] }));
  if (suite === "longmemeval-s" || suite === "longmemeval-m")
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
  if (suite.startsWith("beam-"))
    return rows.flatMap((row) => {
      const plans = Array.isArray(row.plans) ? row.plans : [row];
      return plans.flatMap((plan, planIndex) => {
        const conversationId = String(plan.conversation_id ?? row.conversation_id ?? planIndex);
        const prefix = `${conversationId}${planIndex ? `:plan${planIndex}` : ""}`;
        const messageBySourceId = new Map();
        const sessions = (plan.chat ?? []).map((messages, i) => ({
          id: `${prefix}:s${i}`,
          date: beamDate(messages[0]?.time_anchor, `${conversationId}:${i}`),
          messages: messages.map((message, j) => {
            const id = `${prefix}:s${i}:m${j}`;
            const key = beamSourceKey(message.id);
            if (key !== null) messageBySourceId.set(key, messageBySourceId.has(key) ? null : id);
            return { id, sourceId: message.id ?? null, role: message.role, text: String(message.content ?? "") };
          }),
        }));
        const probing = plan.probing_questions ?? {};
        return Object.entries(probing).flatMap(([ability, items]) =>
          items.map((item, j) => {
            const sourceAnnotations = beamSourceAnnotations(item, messageBySourceId);
            return {
              id: `${conversationId}${planIndex ? `:plan${planIndex}` : ""}:${ability}:${j}`,
              cluster: `beam-${conversationId}`,
              ability,
              question: String(item.question),
              // Abilities label their gold under different keys; never fall back to a wrong field.
              answers: [
                String(item.answer ?? item.ideal_answer ?? item.ideal_response ?? item.ideal_summary ?? item.expected_compliance ?? ""),
              ],
              date: sessions.at(-1)?.date ?? "2000-01-01T00:00:00.000Z",
              sessions,
              evidence: [...new Set(sourceAnnotations.references.filter((ref) => ref.status === "resolved").map((ref) => ref.messageId))],
              sourceAnnotations,
            };
          }),
        );
      });
    });
  if (suite === "memorycode")
    return rows.map((row) => {
      const sessions = JSON.parse(row.sessions);
      const instructions = sessions.flatMap((session, i) =>
        (session.type ?? []).map((type, j) => ({ type, topic: session.topic[j], session: i })),
      );
      return {
        id: String(row.id),
        cluster: `memorycode-${row.id}`,
        ability: instructions.some((instruction) => instruction.type === "instruction-update") ? "instruction-update" : "instruction-add",
        // The final session's query is the one that must apply the latest instruction.
        question: sessions.at(-1).session_eval_query.at(-1),
        answers: (sessions.at(-1).topic ?? []).map(String),
        instructions,
        date: `2000-01-01T00:${String(row.id % 60).padStart(2, "0")}:00.000Z`,
        sessions: sessions.map((session, i) => ({
          id: `mc${row.id}:s${i}`,
          date: `2000-01-01T00:${String(i % 60).padStart(2, "0")}:00.000Z`,
          messages: [{ id: `mc${row.id}:s${i}:m0`, role: "user", text: String(session.text ?? "") }],
        })),
      };
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
      sourceKind: "fact-list",
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
  if (isRobustnessSubset(subset)) {
    // The frozen draw is the only source of ids; a missing id fails closed below.
    const draw = robustnessDraw(suite);
    ids = ability ? draw.abilities[subset][ability] : Object.values(draw.abilities[subset]).flat();
  } else if (suite === "longmemeval-s") {
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
  else if (suite === "memoryagentbench-cr") ids = subsets.memoryagentbench.pairs.map((pair) => pair.join(":"));
  else ids = questions.map((row) => row.id);
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
