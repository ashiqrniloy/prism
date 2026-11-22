/**
 * Plan 218.3 Task 10: the gate record's `sessionBench` section, computed from the code (never typed by hand). It pins
 * the benchmark (G1: `templateHash`, `idsHash`, `sessionsHash`), every arm's memory configuration (G6), the reference
 * prompts and the third-party pins (G10), Mem0's live embedder, and the live model's per-arm `configHashes` and
 * `sharedConfigHash` (plan 218.3 Task 11); `gate_record_pins_every_arm` fails when the code drifts from the record.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sessionBenchPartitions } from "../generate.mjs";
import { armMemoryConfig, CALIBRATION_ARMS, configHash, PRISM_ARMS, SESSION_BENCH_ARMS, SIDE_ARMS } from "./prism.mjs";
import { REFERENCE_PROMPTS, REFERENCE_SOURCE } from "./references.mjs";
import { GEMINI_EMBEDDER, LOCAL_EMBEDDER, MEM0_PIN, THIRD_PARTY_CANDIDATES } from "./third-party.mjs";

const LOCK = join(dirname(fileURLToPath(import.meta.url)), "lock");
const sha256File = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const role = (arm) =>
  PRISM_ARMS.includes(arm) ? "decision" : SIDE_ARMS.includes(arm) ? "side" : CALIBRATION_ARMS.includes(arm) ? "calibration" : "unknown";

export async function sessionBenchPinSection() {
  const file = sessionBenchPartitions();
  // Lazy: live.mjs imports the runner; the pins of the live model (each arm's config hash, the shared hash, G6).
  const live = (await import("../live.mjs")).liveConfigHashes();
  // Task 12's screen on its own model (owner, 2026-11-19): its live pins beside the test run's.
  const { liveConfigHashes } = await import("../live.mjs");
  const { SESSION_BENCH_SCREEN_RULE } = await import("../screen.mjs");
  const screenLive = liveConfigHashes(SESSION_BENCH_SCREEN_RULE);
  return {
    pinnedBy: "plan 218.3 Task 10 (2026-11-18)",
    version: file.version,
    templateHash: file.templateHash,
    idsHash: file.idsHash,
    sessionsHash: file.sessionsHash,
    arms: Object.fromEntries(
      SESSION_BENCH_ARMS.map((arm) => [arm, { role: role(arm), memoryConfigHash: configHash(armMemoryConfig(arm)) }]),
    ),
    pinnedV3By:
      "plan 218.3 Task 12 (2026-11-19): Session-Bench v3 (the D4 check requires the new value only; D3 hardened with look-alike flags that must stay off)",
    ownerDecisions: [
      {
        date: "2026-11-18",
        decision:
          "memory-off-llm (and the reference and Mem0 arms on its compaction) keep keepRecentTokens = 20% of the input cap, session memory's rule, not the compaction package's absolute 20,000 (which overflows W = 32K)",
        text: "Match 20% (Recommended) (owner, 2026-11-18, plan 218.3 Task 10)",
      },
    ],
    references: {
      ...REFERENCE_SOURCE,
      prompts: Object.fromEntries(Object.entries(REFERENCE_PROMPTS).map(([arm, row]) => [arm, row.sha256])),
    },
    thirdParty: {
      candidates: THIRD_PARTY_CANDIDATES.map((row) => ({
        id: row.id,
        version: row.version,
        included: row.included,
        ...(row.reason ? { reason: row.reason } : {}),
      })),
      mem0: {
        ...MEM0_PIN,
        lockSha256: sha256File(join(LOCK, "mem0/package-lock.json")),
        sqliteShimSha256: sha256File(join(LOCK, "mem0/better-sqlite3-bun/index.js")),
        // Task 12's screen (owner 2026-11-19): a local embedder, a recorded G10 deviation.
        liveEmbedder: {
          ...JSON.parse(JSON.stringify(LOCAL_EMBEDDER)),
          pinnedBy: "plan 218.3 Task 12 (2026-11-19)",
        },
        // Task 11's test run (its rule names this embedder).
        testEmbedder: {
          provider: GEMINI_EMBEDDER.provider,
          model: GEMINI_EMBEDDER.model,
          dims: GEMINI_EMBEDDER.dims,
          endpoint: GEMINI_EMBEDDER.endpoint,
          tokens: GEMINI_EMBEDDER.tokens,
          deviation: GEMINI_EMBEDDER.deviation,
          pinnedBy: "plan 218.3 Task 11 (2026-11-18)",
        },
      },
    },
    live: { pinnedBy: "plan 218.3 Task 11 (2026-11-18), before any paid call", ...live },
    screenLive: { pinnedBy: "plan 218.3 Task 12 (2026-11-19), before any paid call", ...screenLive },
  };
}
