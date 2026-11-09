/**
 * Frozen 188.7 final-acceptance manifest and verdict vocabulary.
 *
 * Planning estimate was 100-106M input tokens. The owner approved 106M for this
 * campaign only; it is not a reusable ceiling and not a new default budget.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import confirmatory from "./confirmatory.json" with { type: "json" };
import heldoutV2 from "./heldout-v2.json" with { type: "json" };
import heldoutV3 from "./heldout-v3.json" with { type: "json" };
import { metricValue } from "./metrics.mjs";
import screenMsV1 from "./screen-ms-v1.json" with { type: "json" };
import screenV1 from "./screen-v1.json" with { type: "json" };
import { CONFIRMATORY_MIN_CLUSTERS, holm } from "./stats.mjs";

export const ACCEPTANCE_CEILING = 106_000_000;
export const ACCEPTANCE_EVIDENCE = "docs/_evidence/memory-bench/188.7";
export const ACCEPTANCE_JOURNAL = `${ACCEPTANCE_EVIDENCE}/spend-journal.json`;
export const ACCEPTANCE_MANIFEST = `${ACCEPTANCE_EVIDENCE}/acceptance-manifest.json`;
export const ACCEPTANCE_SUMMARY = `${ACCEPTANCE_EVIDENCE}/acceptance-run.json`;
export const CONFIRMATORY_SEED = 1887;
export const LIFECYCLE_SEEDS = Array.from({ length: 12 }, (_, index) => CONFIRMATORY_SEED + index);
export const REQUIRED_LME_CONFIGS = ["full", "om", "fabric", "fabric-agentic", "om+fabric"];
export const LIFECYCLE_ARMS = [
  { name: "full", config: "full", ablate: [] },
  { name: "fabric-promote-off", config: "fabric", ablate: ["fabric.promote=off"] },
  { name: "fabric-promote-on", config: "fabric", ablate: [] },
  { name: "om+fabric", config: "om+fabric", ablate: [] },
];
// The 188.7 pilot showed ~2.48M input per OM question, so the full confirmatory OM arms
// cannot fit the owner cap. They run as one-question feasibility probes, not quality arms.
const LME_CAPS = { full: 22_000_000, om: 3_000_000, fabric: 3_000_000, "fabric-agentic": 8_000_000, "om+fabric": 3_000_000 };
const LIFECYCLE_CAPS = { full: 500_000, fabric: 500_000, "om+fabric": 500_000 };

export class AcceptanceManifestError extends Error {
  name = "AcceptanceManifestError";
}

const slug = (value) => value.replace(/[^\w.+=-]/g, "_");
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function confirmatoryCounts() {
  return Object.fromEntries(Object.entries(confirmatory.abilities).map(([ability, ids]) => [ability, ids.length]));
}

export function confirmatoryIds() {
  return Object.values(confirmatory.abilities).flat();
}

export function acceptanceJobs() {
  const jobs = [];
  for (const config of REQUIRED_LME_CONFIGS) {
    jobs.push({
      id: `accept-lme-${slug(config)}`,
      family: "quality",
      suite: "longmemeval-s",
      config,
      subset: "confirmatory",
      maxInputTokens: LME_CAPS[config],
    });
  }
  for (const config of ["full", "fabric"]) {
    jobs.push({
      id: `accept-mab-cr-${slug(config)}`,
      family: "quality",
      suite: "memoryagentbench-cr",
      config,
      maxInputTokens: config === "full" ? 12_000_000 : 3_000_000,
    });
  }
  jobs.push({ id: "accept-locomo-full", family: "comparison", suite: "locomo", config: "full", maxInputTokens: 5_000_000 });
  for (const seed of LIFECYCLE_SEEDS) {
    for (const arm of LIFECYCLE_ARMS) {
      jobs.push({
        id: `accept-lifecycle-${slug(arm.name)}-p${seed}`,
        family: "safety",
        suite: "lifecycle",
        config: arm.config,
        ablate: arm.ablate,
        seed,
        maxInputTokens: LIFECYCLE_CAPS[arm.config],
      });
    }
  }
  return jobs;
}

export function buildAcceptanceManifest() {
  return {
    schemaVersion: 2,
    kind: "188.7-final-acceptance",
    ceiling: ACCEPTANCE_CEILING,
    priorReservation: 0,
    historicalSpendForAuditOnly: 112_092_487,
    provider: "opencode-go",
    model: "mimo-v2.5",
    judge: "opencode-go/mimo-v2.5",
    judgeProtocol: "enum-json-v1",
    sourceRevision: "working-tree",
    dataset: "longmemeval-s@98d7416c",
    confirmatory: {
      seed: CONFIRMATORY_SEED,
      counts: confirmatoryCounts(),
      idsHash: hash(confirmatory.ids ?? confirmatory.abilities),
      fileSha256: createHash("sha256").update(JSON.stringify(confirmatory)).digest("hex"),
      ids: confirmatory.abilities,
    },
    lifecycle: { seeds: LIFECYCLE_SEEDS, projects: 3, sessions: 8, clusterUnit: "persona" },
    unavailable: [{ arm: "fabric-hybrid", reason: "No live embeddings model configured; hash embeddings are not a substitute." }],
    limitations: [
      "LoCoMo is comparison-only and capped; a capped run is partial.",
      "The two Locomo conversations are the pinned comparison pair, not the whole dataset.",
      "A pre-fix fabric arm is not run because the fix history is uncommitted; pre-fix claims stay unresolved.",
      "Currency is not reported without authenticated rate semantics.",
    ],
    jobs: acceptanceJobs(),
  };
}

export function assertAcceptanceManifest(manifest) {
  if (manifest?.kind !== "188.7-final-acceptance") throw new AcceptanceManifestError("not the 188.7 acceptance manifest");
  if (manifest.ceiling !== ACCEPTANCE_CEILING) throw new AcceptanceManifestError(`ceiling must be ${ACCEPTANCE_CEILING}`);
  const ids = new Set();
  let totalCaps = 0;
  for (const job of manifest.jobs ?? []) {
    if (!job.id || ids.has(job.id)) throw new AcceptanceManifestError("job ids must be unique");
    ids.add(job.id);
    if (!Number.isSafeInteger(job.maxInputTokens) || job.maxInputTokens < 1)
      throw new AcceptanceManifestError(`${job.id} needs a positive maxInputTokens`);
    totalCaps += job.maxInputTokens;
    if (job.config === "fabric-hybrid") throw new AcceptanceManifestError("fabric-hybrid has no live embeddings model");
  }
  if (totalCaps > manifest.ceiling) throw new AcceptanceManifestError("arm caps exceed the campaign ceiling");
  const counts = manifest.confirmatory?.counts ?? {};
  for (const ability of Object.keys(confirmatory.abilities)) {
    if (counts[ability] !== 20) throw new AcceptanceManifestError(`confirmatory ${ability} needs 20 ids`);
  }
  if (Object.keys(counts).length !== 7) throw new AcceptanceManifestError("confirmatory set needs seven abilities");
  for (const config of REQUIRED_LME_CONFIGS) {
    if (!manifest.jobs.some((job) => job.suite === "longmemeval-s" && job.config === config && job.subset === "confirmatory"))
      throw new AcceptanceManifestError(`missing confirmatory LongMemEval arm: ${config}`);
  }
  for (const config of ["full", "fabric"])
    if (!manifest.jobs.some((job) => job.suite === "memoryagentbench-cr" && job.config === config))
      throw new AcceptanceManifestError(`missing MemoryAgentBench-CR arm: ${config}`);
  if (!manifest.jobs.some((job) => job.suite === "locomo" && job.config === "full"))
    throw new AcceptanceManifestError("missing LoCoMo comparison arm");
  for (const seed of LIFECYCLE_SEEDS) {
    for (const arm of LIFECYCLE_ARMS) {
      if (
        !manifest.jobs.some(
          (job) =>
            job.suite === "lifecycle" &&
            job.seed === seed &&
            job.config === arm.config &&
            JSON.stringify(job.ablate ?? []) === JSON.stringify(arm.ablate),
        )
      )
        throw new AcceptanceManifestError(`missing lifecycle arm ${arm.name} for persona ${seed}`);
    }
  }
  return manifest;
}

/*
 * Plan 188.8 acceptance: a small paired held-out campaign on the frozen held-out v2 draw.
 * The treatment is the product code; the pre-fix arm reuses the identical harness.
 */
export const ACCEPTANCE_1888_CEILING = 30_000_000;
export const ACCEPTANCE_1888_EVIDENCE = "docs/_evidence/memory-bench/188.8";
export const ACCEPTANCE_1888_JOURNAL = `${ACCEPTANCE_1888_EVIDENCE}/spend-journal.json`;
export const ACCEPTANCE_1888_MANIFEST = `${ACCEPTANCE_1888_EVIDENCE}/acceptance-manifest.json`;
export const ACCEPTANCE_1888_SUMMARY = `${ACCEPTANCE_1888_EVIDENCE}/acceptance-run.json`;
export const ACCEPTANCE_1888_LOGS = ".cache/memory-bench/188.8";
export const ACCEPTANCE_1888_PROTOCOL_VERSION = 2;
export const PREFIX_REVISION = "140091766ab830573054befc8210314b54667950";
export const PREFIX_WORKTREE = ".cache/memory-bench/188.8/prefix";
/** Harness is copied into the pre-fix worktree; only these paths may differ from it. */
export const PREFIX_PRODUCT_PATHS = ["packages/memory/system/src/ltm"];
export const HARNESS_PATHS = ["scripts/memory-bench"];
/** Predeclared primary family: Holm across these four abilities. */
export const PRIMARY_1888_ABILITIES = ["knowledge-update", "multi-session", "temporal-reasoning", "single-session-user"];
export const NONINFERIORITY_MARGIN_1888 = 0.03;
export const ARMS_1888 = [
  { id: "prefix", config: "fabric", subset: "heldout-v2", maxInputTokens: 1_000_000, prefix: true },
  { id: "postfix", config: "fabric", subset: "heldout-v2", maxInputTokens: 1_000_000 },
  { id: "agentic", config: "fabric-agentic", subset: "heldout-v2", maxInputTokens: 8_000_000 },
  { id: "development", config: "fabric", subset: "development", maxInputTokens: 1_000_000 },
  { id: "full", config: "full", subset: "heldout-v2", maxInputTokens: 14_000_000 },
];
export const ARM_1888_IDS = Object.fromEntries(ARMS_1888.map((arm) => [arm.id, `accept1888-${arm.id}`]));

export function acceptance1888Jobs() {
  return ARMS_1888.map((arm) => ({
    id: ARM_1888_IDS[arm.id],
    family: "quality",
    suite: "longmemeval-s",
    config: arm.config,
    subset: arm.subset,
    maxInputTokens: arm.maxInputTokens,
    ...(arm.prefix ? { cwd: PREFIX_WORKTREE, worktreeRevision: PREFIX_REVISION } : {}),
  }));
}

/** Held-out ids only: a development id in a primary arm would break the held-out claim. */
export function heldout1888() {
  const abilities = heldoutV2.abilities;
  return {
    seed: heldoutV2.seed,
    draw: heldoutV2.draw,
    counts: Object.fromEntries(Object.entries(abilities).map(([ability, ids]) => [ability, ids.length])),
    idsHash: hash(Object.values(abilities).flat()),
    fileSha256: createHash("sha256").update(JSON.stringify(heldoutV2)).digest("hex"),
    ids: abilities,
  };
}

export function development1888() {
  return {
    subset: "confirmatory",
    reason: heldoutV2.development.reason,
    counts: confirmatoryCounts(),
    idsHash: hash(confirmatoryIds()),
    fileSha256: createHash("sha256").update(JSON.stringify(confirmatory)).digest("hex"),
    ids: confirmatory.abilities,
  };
}

export function buildAcceptance1888Manifest({ harnessHash = null, productHash = null, postfixProductHash = null } = {}) {
  return {
    schemaVersion: 3,
    kind: "188.8-heldout-acceptance",
    ceiling: ACCEPTANCE_1888_CEILING,
    priorReservation: 0,
    provider: "opencode-go",
    model: "mimo-v2.5",
    judge: "opencode-go/mimo-v2.5",
    judgeProtocol: "enum-json-v1",
    protocolVersion: ACCEPTANCE_1888_PROTOCOL_VERSION,
    sourceRevision: "working-tree",
    dataset: "longmemeval-s@98d7416c",
    heldoutV2: heldout1888(),
    development: development1888(),
    primaryAbilities: PRIMARY_1888_ABILITIES,
    nonInferiorityMargin: NONINFERIORITY_MARGIN_1888,
    prefix: {
      revision: PREFIX_REVISION,
      worktree: PREFIX_WORKTREE,
      productPaths: PREFIX_PRODUCT_PATHS,
      harnessPaths: HARNESS_PATHS,
      // Both source hashes are recorded: the pre-fix worktree and the post-fix tree.
      harnessHash,
      productHash,
      postfixProductHash,
    },
    unavailable: [{ arm: "fabric-hybrid", reason: "No live embeddings model configured; hash embeddings are not a substitute." }],
    limitations: [
      "No held-out preference or abstention ids remain; both are development-only non-regression strata.",
      "The pre-fix arm keeps the post-fix harness, so the product is the only treatment.",
      "Delivery-stage diagnostics are offline and read gold evidence after both paid arms finish.",
      "Currency is not reported without authenticated rate semantics.",
    ],
    jobs: acceptance1888Jobs(),
  };
}

export function assertAcceptance1888Manifest(manifest) {
  if (manifest?.kind !== "188.8-heldout-acceptance") throw new AcceptanceManifestError("not the 188.8 acceptance manifest");
  if (manifest.ceiling !== ACCEPTANCE_1888_CEILING) throw new AcceptanceManifestError(`ceiling must be ${ACCEPTANCE_1888_CEILING}`);
  if (manifest.protocolVersion !== ACCEPTANCE_1888_PROTOCOL_VERSION)
    throw new AcceptanceManifestError(`protocol version must be ${ACCEPTANCE_1888_PROTOCOL_VERSION}`);
  const jobs = manifest.jobs ?? [];
  if (new Set(jobs.map((job) => job.id)).size !== jobs.length) throw new AcceptanceManifestError("job ids must be unique");
  let totalCaps = 0;
  for (const arm of ARMS_1888) {
    const job = jobs.find((item) => item.id === ARM_1888_IDS[arm.id]);
    if (!job) throw new AcceptanceManifestError(`missing arm: ${arm.id}`);
    if (job.config !== arm.config || job.subset !== arm.subset)
      throw new AcceptanceManifestError(`${arm.id} must be ${arm.config} on ${arm.subset}`);
    if (!Number.isSafeInteger(job.maxInputTokens) || job.maxInputTokens < 1 || job.maxInputTokens > arm.maxInputTokens)
      throw new AcceptanceManifestError(`${arm.id} cap must be 1..${arm.maxInputTokens}`);
    totalCaps += job.maxInputTokens;
    if (Boolean(job.cwd) !== Boolean(arm.prefix)) throw new AcceptanceManifestError(`${arm.id} worktree isolation is wrong`);
  }
  if (jobs.length !== ARMS_1888.length) throw new AcceptanceManifestError("unexpected extra arm");
  if (totalCaps > manifest.ceiling) throw new AcceptanceManifestError("arm caps exceed the campaign ceiling");
  const heldout = new Set(Object.values(manifest.heldoutV2?.ids ?? {}).flat());
  const development = new Set(Object.values(manifest.development?.ids ?? {}).flat());
  if (heldout.size !== 100) throw new AcceptanceManifestError("held-out v2 needs 100 ids");
  for (const ability of PRIMARY_1888_ABILITIES)
    if (manifest.heldoutV2?.counts?.[ability] !== 20) throw new AcceptanceManifestError(`held-out ${ability} needs 20 ids`);
  for (const id of heldout) if (development.has(id)) throw new AcceptanceManifestError(`development id in the held-out draw: ${id}`);
  if (manifest.development?.counts?.["single-session-preference"] !== 20 || manifest.development?.counts?.abstention !== 20)
    throw new AcceptanceManifestError("development arm needs the preference and abstention strata");
  const prefix = manifest.prefix ?? {};
  if (!prefix.harnessHash || !prefix.productHash || !prefix.postfixProductHash)
    throw new AcceptanceManifestError("prefix arm needs both source hashes");
  if (prefix.productHash === prefix.postfixProductHash)
    throw new AcceptanceManifestError("prefix arm product is identical to the post-fix product");
  return manifest;
}

/** sha256 over every file under the given repo-relative directories, sorted by path. */
export async function sourceFingerprint(paths, root = ".") {
  const digest = createHash("sha256");
  const files = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  for (const path of paths) await walk(join(root, path));
  for (const file of files.sort()) {
    digest.update(relative(root, file));
    digest.update("\0");
    digest.update(
      createHash("sha256")
        .update(await readFile(file))
        .digest("hex"),
    );
    digest.update("\n");
  }
  return digest.digest("hex");
}

/**
 * Pre-flight for the pre-fix arm: the harness must be byte-identical to the post-fix tree,
 * and the product must differ, otherwise the arm is not the treatment.
 */
export async function prefixArmAudit(manifest, { root = ".", worktree = manifest.prefix?.worktree } = {}) {
  if (!worktree) throw new AcceptanceManifestError("prefix arm has no worktree");
  const harnessHash = await sourceFingerprint(manifest.prefix.harnessPaths ?? HARNESS_PATHS, worktree);
  if (harnessHash !== manifest.prefix.harnessHash)
    throw new AcceptanceManifestError("prefix arm harness differs from the post-fix harness");
  const productHash = await sourceFingerprint(manifest.prefix.productPaths ?? PREFIX_PRODUCT_PATHS, worktree);
  const postfixProductHash = await sourceFingerprint(manifest.prefix.productPaths ?? PREFIX_PRODUCT_PATHS, root);
  if (postfixProductHash !== manifest.prefix.postfixProductHash)
    throw new AcceptanceManifestError("post-fix product changed after the manifest was written");
  if (productHash === postfixProductHash) throw new AcceptanceManifestError("prefix arm product is identical to the post-fix product");
  if (productHash !== manifest.prefix.productHash)
    throw new AcceptanceManifestError("prefix worktree product differs from the recorded pre-fix product");
  return { harnessHash, productHash, postfixProductHash };
}

/** sha256 over exactly these files, sorted by path: the run-path analogue of sourceFingerprint. */
export async function fileFingerprint(paths, root = ".") {
  const digest = createHash("sha256");
  for (const path of [...paths].sort()) {
    digest.update(path);
    digest.update("\0");
    digest.update(
      createHash("sha256")
        .update(await readFile(join(root, path)))
        .digest("hex"),
    );
    digest.update("\n");
  }
  return digest.digest("hex");
}

/*
 * Plan 188.9 Task 4: the product write side is paid once per key and reused by every read-side arm.
 * The key names everything that changes what a snapshot contains; a mismatch is a miss, never a
 * silent re-write.
 */
export const WRITE_SIDE_CACHE = ".cache/memory-bench/write";
export const WRITE_SIDE_DATASET = "longmemeval-s@98d7416c";
export const WRITE_SIDE_PATHS = ["packages/memory/system/src/ltm"];
export const EXTRACTOR_MODEL = "opencode-go/mimo-v2.5";
export const EXTRACTOR_GENERATION = "temperature=0;maxTokens=4096";
export const INGEST_PATHS = ["scripts/memory-bench/replay.mjs", "scripts/memory-bench/datasets.mjs"];

export function writeSideKey({
  config,
  dataset,
  productHash,
  extractorModel,
  generation,
  writeGeneration = EXTRACTOR_GENERATION,
  promptTemplateHash,
  ingestHash,
}) {
  for (const [name, value] of Object.entries({
    config,
    dataset,
    productHash,
    extractorModel,
    generation,
    writeGeneration,
    promptTemplateHash,
    ingestHash,
  }))
    if (typeof value !== "string" || !value) throw new Error(`MemoryBenchWriteSideKey: ${name} is required`);
  // `config` is in the key because `fabric-x` archives exchanges and `fabric-xc` also extracts facts;
  // `writeGeneration` (plan 188.10 Task 5) because two extractor budgets never share one snapshot.
  return hash({
    kind: "write-side-v3",
    config,
    dataset,
    productHash,
    extractorModel,
    generation,
    writeGeneration,
    promptTemplateHash,
    ingestHash,
  });
}

/** Resolve the cache directory from the current trees; null when the product tree is unreadable. */
export async function writeSideCacheDir({
  config = "fabric-xc",
  dataset = WRITE_SIDE_DATASET,
  root = ".",
  writeGeneration = EXTRACTOR_GENERATION,
} = {}) {
  return writeSideKey({
    config,
    dataset,
    productHash: await sourceFingerprint(WRITE_SIDE_PATHS, root),
    extractorModel: EXTRACTOR_MODEL,
    generation: EXTRACTOR_GENERATION,
    writeGeneration,
    promptTemplateHash: await fileFingerprint(["packages/memory/system/src/ltm/consolidation/prompts.ts"], root),
    ingestHash: await fileFingerprint(INGEST_PATHS, root),
  });
}

/**
 * Plan 188.9 Task 4 screen profile: development ids only, never a held-out draw, never an
 * acceptance manifest, and only suites the 35-id LongMemEval draw can cover.
 */
export const SCREEN_PROFILE = { subset: "screen-v1", phase: "all", labelInjections: "off", concurrency: 8 };
/** Held-out draws are labelled data; a screen may name neither. */
export const HELDOUT_SUBSETS = ["heldout-v2", "heldout-v3"];

export function assertScreenProfile(mode, manifest) {
  if (mode !== "task6") throw new AcceptanceManifestError("the screen profile is refused for an acceptance manifest");
  for (const job of manifest.jobs ?? []) {
    if (HELDOUT_SUBSETS.includes(job.subset)) throw new AcceptanceManifestError(`the screen profile refuses ${job.subset} ids: ${job.id}`);
    if (job.suite !== "longmemeval-s")
      throw new AcceptanceManifestError(`the screen profile is the 35-id LongMemEval development draw: ${job.id} is ${job.suite}`);
    if (job.subset !== undefined && job.subset !== SCREEN_PROFILE.subset)
      throw new AcceptanceManifestError(`the screen profile cannot run subset ${job.subset}: ${job.id}`);
  }
  return SCREEN_PROFILE;
}

/** Declared reuse and write-side dependencies must name real, compatible jobs. */
export function assertJobDependencies(jobs) {
  const byId = new Map(jobs.map((job) => [job.id, job]));
  for (const job of jobs) {
    if (job.reuse !== undefined) {
      if (typeof job.reuse?.from !== "string" || !job.reuse.from)
        throw new AcceptanceManifestError(`${job.id} reuse needs a source report`);
      if (job.reuse.fingerprint !== undefined && !/^[a-f0-9]{64}$/.test(job.reuse.fingerprint))
        throw new AcceptanceManifestError(`${job.id} reuse fingerprint must be a sha256`);
      if (job.reuse.fallback !== undefined && !["run", "refuse"].includes(job.reuse.fallback))
        throw new AcceptanceManifestError(`${job.id} reuse fallback must be run or refuse`);
    }
    if (job.writeSide === undefined) continue;
    const producer = byId.get(job.writeSide);
    if (!producer) throw new AcceptanceManifestError(`${job.id} names an unknown write side: ${job.writeSide}`);
    if (producer.writeSide !== undefined) throw new AcceptanceManifestError(`${job.writeSide} is itself a read-side arm`);
    if (!String(producer.config).includes("fabric"))
      throw new AcceptanceManifestError(`${job.writeSide} must be a fabric arm to write notes`);
    for (const field of ["suite", "subset", "ability", "seed"])
      if (producer[field] !== job[field]) throw new AcceptanceManifestError(`${job.id} and ${job.writeSide} must agree on ${field}`);
  }
  return jobs;
}

/*
 * Plan 188.9 Task 10: the paid development screen. The cap below is the screen's own ceiling, taken
 * verbatim from the plan's owner-approved table (probe 0.3M + `xc` write side 7M + reads 2.5M, plus
 * headroom); it is not a reusable budget. The screen is development data: it can drop an arm but
 * cannot tune a parameter.
 */
// Reservation pool for the screen. The plan estimated the `xc` write side at ~7M input for 35 ids;
// the measured cost is ~11M (each archived exchange carries the assistant reply and the extractor
// prompt grows with the notes already stored), so the pool is 18M while the spend claim stays the
// sum of read caps (9M) plus that one write side.
export const ACCEPTANCE_1889_SCREEN_CEILING = 18_000_000;
export const ACCEPTANCE_1889_SCREEN_EVIDENCE = "docs/_evidence/memory-bench/188.9/screen";
export const ACCEPTANCE_1889_SCREEN_MANIFEST = `${ACCEPTANCE_1889_SCREEN_EVIDENCE}/screen-manifest.json`;
export const ACCEPTANCE_1889_SCREEN_JOURNAL = `${ACCEPTANCE_1889_SCREEN_EVIDENCE}/spend-journal.json`;
export const ACCEPTANCE_1889_SCREEN_SUMMARY = `${ACCEPTANCE_1889_SCREEN_EVIDENCE}/screen-run.json`;
export const ACCEPTANCE_1889_SCREEN_VERDICT = `${ACCEPTANCE_1889_SCREEN_EVIDENCE}/verdict.json`;
export const ACCEPTANCE_1889_PROBE_MANIFEST = `${ACCEPTANCE_1889_SCREEN_EVIDENCE}/probe-manifest.json`;
export const ACCEPTANCE_1889_PROBE_JOURNAL = `${ACCEPTANCE_1889_SCREEN_EVIDENCE}/probe-journal.json`;
export const ACCEPTANCE_1889_PROBE_REPORT = `${ACCEPTANCE_1889_SCREEN_EVIDENCE}/probe.json`;
// Reservation pool, not a spend target: the journal reserves `250k per request in flight`, so a
// high-concurrency probe needs headroom the plan's 0.3M spend allowance never described.
export const ACCEPTANCE_1889_PROBE_CEILING = 16_000_000;
export const SCREEN_1889_SUBSET = "screen-v1";
/** 188.8's passive delivery rule (whole notes, 600 tokens, top 3, similarity 0.35). */
export const SCREEN_1889_BASELINE_VARIANT = "fabric.delivery=188.8";
export const PROBE_1889_STEPS = [4, 8, 16, 24];
export const PROBE_1889_QUESTIONS = 8;
// Per-step reservation: the kernel charges 250k for every request in flight, and a question holds
// one answer call plus its judge calls, so in flight climbs towards 2x the question concurrency.
export const PROBE_1889_CAPS = { 4: 3_000_000, 8: 5_000_000, 16: 9_000_000, 24: 13_000_000 };
/** The screen cannot reserve a step above 4 under its 12M ceiling once the paid write side has run. */
export const SCREEN_1889_MAX_CONCURRENCY = 4;
/** Pre-registered screen rule; the verdict is computed from it, never hand-set. */
export const SCREEN_1889_RULE = { minGainQuestions: 3, maxAbilityLoss: 1, maxRunLimit: 0.05 };
export const SCREEN_1889_ARMS = [
  // The plan's baseline arm: the current tree with 188.8's delivery rule pinned by variant, so the
  // verdict compares representations and not 188.8's 600-token delivery against 188.9's 4,000-token one.
  { id: "baseline", config: "fabric", maxInputTokens: 2_000_000, ablate: [SCREEN_1889_BASELINE_VARIANT] },
  // Descriptive only: the shipped 188.9 delivery on the legacy store. Kept because it says what the
  // delivery change alone is worth; it never feeds the go/no-go rule.
  { id: "baseline-new-delivery", config: "fabric", maxInputTokens: 2_000_000 },
  { id: "write-x", config: "fabric-x", maxInputTokens: 2_000_000, write: true },
  // One extractor call per archived session is slow (about a minute each), so the write side runs
  // wider than a read arm: the probe measured 16 clean, and 16 in flight fit the 13M reservation.
  { id: "write-xc", config: "fabric-xc", maxInputTokens: 13_000_000, write: true, concurrency: 16 },
  { id: "x", config: "fabric-x", maxInputTokens: 2_000_000, writeSide: "write-x" },
  { id: "xc", config: "fabric-xc", maxInputTokens: 2_000_000, writeSide: "write-xc" },
  { id: "xc-agentic", config: "fabric-xc-agentic", maxInputTokens: 3_000_000, writeSide: "write-xc" },
];
export const SCREEN_1889_ARM_IDS = Object.fromEntries(SCREEN_1889_ARMS.map((arm) => [arm.id, `accept1889-screen-${arm.id}`]));
/**
 * Arms held out of the screen. `fabric-xc`'s write side was abandoned before it measured anything:
 * the only run was killed at concurrency 16 after 52 minutes with 1 of 35 ids finished, its 462
 * calls were all 200 with no retries or overloads (so the old "retry storm" reading was wrong), and
 * 22 of them hit the 4,096-token output limit. Per-id cost is therefore unknown, not large. The
 * verdict marks these arms missing instead of scoring them as failures, and Task 10's follow-up
 * measures the real cost at concurrency 1-2 before Task 11 decides.
 */
export const SCREEN_1889_EXCLUDED = [
  {
    arm: "xc",
    reason:
      "not measured: the write-side attempt was killed at concurrency 16 with 1 of 35 ids finished and its per-id cost unknown; a capped measurement runs before Task 11",
  },
  {
    arm: "write-xc",
    reason: "the `xc` write side it exists for is not measured yet",
  },
  {
    arm: "xc-agentic",
    reason: "reuses the unmeasured `xc` store",
  },
];

export function acceptance1889ScreenJobs({ excluded = [] } = {}) {
  const skipped = new Set(excluded.map((item) => item.arm));
  return SCREEN_1889_ARMS.filter((arm) => !skipped.has(arm.id)).map((arm) => ({
    id: SCREEN_1889_ARM_IDS[arm.id],
    family: "quality",
    suite: "longmemeval-s",
    config: arm.config,
    subset: SCREEN_1889_SUBSET,
    maxInputTokens: arm.maxInputTokens,
    ...(arm.ablate ? { ablate: [...arm.ablate] } : {}),
    ...(arm.concurrency ? { concurrency: arm.concurrency } : {}),
    // A screen skips judge-only injection labels: they cost tokens and change no guarded decision.
    labelInjections: "off",
    ...(arm.writeSide && !skipped.has(arm.writeSide) ? { writeSide: SCREEN_1889_ARM_IDS[arm.writeSide] } : {}),
  }));
}

export function acceptance1889ProbeJobs() {
  return PROBE_1889_STEPS.map((step) => ({
    id: `accept1889-probe-c${step}`,
    family: "timing",
    suite: "longmemeval-s",
    config: "fabric",
    subset: SCREEN_1889_SUBSET,
    maxInputTokens: PROBE_1889_CAPS[step],
    maxQuestions: PROBE_1889_QUESTIONS,
    // Labels are judge-only work that fans out per question; a latency probe does not need them.
    labelInjections: "off",
    concurrency: step,
  }));
}

/** The screen draw, as ids and hashes only: the manifest records which development ids ran. */
export function screen1889() {
  return {
    subset: SCREEN_1889_SUBSET,
    draw: screenV1.draw,
    salt: screenV1.salt,
    counts: Object.fromEntries(Object.entries(screenV1.abilities).map(([ability, ids]) => [ability, ids.length])),
    idsHash: hash(Object.values(screenV1.abilities).flat()),
    fileSha256: createHash("sha256").update(JSON.stringify(screenV1)).digest("hex"),
  };
}

export function buildAcceptance1889ProbeManifest() {
  return {
    schemaVersion: 1,
    kind: "188.9-development-concurrency-probe",
    ceiling: ACCEPTANCE_1889_PROBE_CEILING,
    priorReservation: 0,
    provider: "opencode-go",
    model: "mimo-v2.5",
    judge: "opencode-go/mimo-v2.5",
    protocolVersion: ACCEPTANCE_1888_PROTOCOL_VERSION,
    dataset: WRITE_SIDE_DATASET,
    screen: screen1889(),
    steps: PROBE_1889_STEPS,
    questions: PROBE_1889_QUESTIONS,
    jobs: acceptance1889ProbeJobs(),
  };
}

export function assertAcceptance1889ProbeManifest(manifest) {
  if (manifest?.kind !== "188.9-development-concurrency-probe") throw new AcceptanceManifestError("not the 188.9 probe manifest");
  if (manifest.ceiling !== ACCEPTANCE_1889_PROBE_CEILING)
    throw new AcceptanceManifestError(`probe ceiling must be ${ACCEPTANCE_1889_PROBE_CEILING}`);
  const jobs = manifest.jobs ?? [];
  if (jobs.length !== PROBE_1889_STEPS.length) throw new AcceptanceManifestError("the probe runs one job per step");
  for (const step of PROBE_1889_STEPS) {
    const job = jobs.find((item) => item.id === `accept1889-probe-c${step}`);
    if (!job) throw new AcceptanceManifestError(`missing probe step ${step}`);
    if (job.concurrency !== step) throw new AcceptanceManifestError(`probe ${step} must run at concurrency ${step}`);
    if (job.subset !== SCREEN_1889_SUBSET) throw new AcceptanceManifestError(`probe ${step} must use development ids only`);
    if (job.maxQuestions !== PROBE_1889_QUESTIONS)
      throw new AcceptanceManifestError(`probe ${step} must answer ${PROBE_1889_QUESTIONS} questions`);
    if (job.maxInputTokens > PROBE_1889_CAPS[step])
      throw new AcceptanceManifestError(`probe ${step} reserves more than its ${PROBE_1889_CAPS[step]}`);
    if (job.maxInputTokens > manifest.ceiling)
      throw new AcceptanceManifestError(`probe ${step} cannot be reserved under the probe ceiling`);
  }
  return manifest;
}

/**
 * The highest probed step with no overload and a p95 under 1.5x the step-4 p95. A provider that
 * overloads even at step 4 leaves concurrency 1: the campaign never assumes more headroom than the
 * probe measured.
 */
export function chooseConcurrency(steps, { factor = 1.5, maxConcurrency = SCREEN_1889_MAX_CONCURRENCY } = {}) {
  // A row that did not finish measures a broken arm, not provider latency.
  const rows = (steps ?? []).filter(
    (row) =>
      Number.isFinite(row?.p95Ms) &&
      Number.isFinite(row?.concurrency) &&
      // `partial` is a finished 8-question probe: the arm stopped early by design, not by failure.
      (row.status === undefined || row.status === "completed" || row.status === "partial"),
  );
  if (!rows.length) return { concurrency: 1, reason: "no probe rows" };
  const base = rows.find((row) => row.concurrency === Math.min(...rows.map((item) => item.concurrency)));
  if (!base) return { concurrency: 1, reason: "no baseline step" };
  const clean = rows.filter((row) => row.overloads === 0 && row.p95Ms < base.p95Ms * factor).sort((a, b) => b.concurrency - a.concurrency);
  const allowed = clean.filter((row) => row.concurrency <= maxConcurrency);
  if (!allowed.length)
    return {
      concurrency: 1,
      reason: clean.length
        ? `only steps above the ${maxConcurrency}-request reservation bound were clean`
        : `every step overloaded or exceeded ${factor}x the step-${base.concurrency} p95`,
    };
  // The screen's ceiling cannot reserve every clean step; say so instead of silently choosing less.
  const capped = clean[0].concurrency > allowed[0].concurrency ? `; capped at ${maxConcurrency} by the reservation bound` : "";
  return {
    concurrency: allowed[0].concurrency,
    reason: `highest step with 0 overloads and p95 ${allowed[0].p95Ms}ms < ${factor}x ${base.p95Ms}ms${capped}`,
  };
}

export function buildAcceptance1889ScreenManifest({
  harnessHash = null,
  productHash = null,
  writeSideKeys = null,
  concurrency,
  excluded = SCREEN_1889_EXCLUDED,
} = {}) {
  return {
    schemaVersion: 1,
    kind: "188.9-development-screen",
    ceiling: ACCEPTANCE_1889_SCREEN_CEILING,
    priorReservation: 0,
    provider: "opencode-go",
    model: "mimo-v2.5",
    judge: "opencode-go/mimo-v2.5",
    protocolVersion: ACCEPTANCE_1888_PROTOCOL_VERSION,
    dataset: WRITE_SIDE_DATASET,
    sourceRevision: "working-tree",
    screen: screen1889(),
    rule: SCREEN_1889_RULE,
    concurrency: concurrency ?? { concurrency: SCREEN_PROFILE.concurrency, reason: "no probe evidence; using the profile default" },
    harnessHash,
    productHash,
    writeSideKeys,
    excluded,
    limitations: [
      "Development data only: a failed arm is dropped, never tuned.",
      "The `xc` write side is the only paid write path; `fabric-x` writes locally and spends nothing.",
      ...excluded.map((item) => `${item.arm} excluded: ${item.reason}`),
    ],
    jobs: acceptance1889ScreenJobs({ excluded }),
  };
}

export function assertAcceptance1889ScreenManifest(manifest) {
  if (manifest?.kind !== "188.9-development-screen") throw new AcceptanceManifestError("not the 188.9 screen manifest");
  if (manifest.ceiling !== ACCEPTANCE_1889_SCREEN_CEILING)
    throw new AcceptanceManifestError(`screen ceiling must be ${ACCEPTANCE_1889_SCREEN_CEILING}`);
  if (!manifest.harnessHash || !manifest.productHash) throw new AcceptanceManifestError("screen needs the harness and product hashes");
  const { concurrency } = manifest.concurrency ?? {};
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new AcceptanceManifestError("screen needs the probed concurrency");
  const jobs = manifest.jobs ?? [];
  const excluded = new Map((manifest.excluded ?? []).map((item) => [item.arm, item.reason]));
  for (const [arm, reason] of excluded) {
    if (!SCREEN_1889_ARMS.some((declared) => declared.id === arm)) throw new AcceptanceManifestError(`excluded unknown arm: ${arm}`);
    if (typeof reason !== "string" || !reason) throw new AcceptanceManifestError(`excluded ${arm} needs a reason`);
    if (jobs.some((job) => job.id === SCREEN_1889_ARM_IDS[arm])) throw new AcceptanceManifestError(`${arm} is both run and excluded`);
  }
  const expected = SCREEN_1889_ARMS.filter((arm) => !excluded.has(arm.id));
  if (jobs.length !== expected.length || new Set(jobs.map((job) => job.id)).size !== jobs.length)
    throw new AcceptanceManifestError("the screen runs exactly its declared arms");
  let readCaps = 0;
  for (const arm of expected) {
    const job = jobs.find((item) => item.id === SCREEN_1889_ARM_IDS[arm.id]);
    if (!job) throw new AcceptanceManifestError(`missing screen arm: ${arm.id}`);
    if (job.config !== arm.config) throw new AcceptanceManifestError(`${arm.id} must be ${arm.config}`);
    if (job.subset !== SCREEN_1889_SUBSET) throw new AcceptanceManifestError(`${arm.id} must run the frozen screen draw`);
    if (job.maxInputTokens > arm.maxInputTokens) throw new AcceptanceManifestError(`${arm.id} cap exceeds ${arm.maxInputTokens}`);
    if (job.maxInputTokens > manifest.ceiling) throw new AcceptanceManifestError(`${arm.id} cannot be reserved under the screen ceiling`);
    if (!arm.write) readCaps += job.maxInputTokens;
  }
  // The reads are the spend claim; write sides are reserved and charged separately and in order.
  if (readCaps > manifest.ceiling) throw new AcceptanceManifestError("screen read caps exceed the screen ceiling");
  for (const ability of Object.keys(screenV1.abilities))
    if (manifest.screen?.counts?.[ability] !== screenV1.idsPerAbility)
      throw new AcceptanceManifestError(`screen ${ability} needs ${screenV1.idsPerAbility} ids`);
  return manifest;
}

/**
 * Plan 188.10 Task 7: gate 1 and Stage A. The cap is the owner's approval, recorded verbatim with its
 * date; while `GATE_1_APPROVAL` still says pending, the manifest cannot be built, so no paid call can
 * run. The screen itself is development-only and pre-registers its target: nothing here can tune a
 * parameter after the fact.
 */
export const ACCEPTANCE_18810_EVIDENCE = "docs/_evidence/memory-bench/188.10";
export const SCREEN_A_EVIDENCE = `${ACCEPTANCE_18810_EVIDENCE}/screen-a`;
export const SCREEN_A_MANIFEST = `${SCREEN_A_EVIDENCE}/screen-a-manifest.json`;
export const SCREEN_A_JOURNAL = `${SCREEN_A_EVIDENCE}/spend-journal.json`;
export const SCREEN_A_SUMMARY = `${SCREEN_A_EVIDENCE}/screen-a-run.json`;
export const SCREEN_A_VERDICT = `${SCREEN_A_EVIDENCE}/verdict.json`;
export const SCREEN_A_DIAGNOSTIC = `${SCREEN_A_EVIDENCE}/ms-diagnostics-x.json`;
export const SCREEN_A_LOGS = ".cache/memory-bench/188.10/screen-a";
/** Gate 1 covers Stage A, the iteration allowance and Task 9 on the Stage A path (cap table). */
export const GATE_1_CAP = 34_000_000;
export const GATE_1_APPROVAL =
  "Gate 1 approved 2026-10-23: 34,000,000 tokens (Stage A, the iteration allowance, and Task 9 on the Stage A path)";
/** Two 60-id read arms at 188.9's measured read cost, reserved as a pool (not a spend target). */
export const SCREEN_A_CEILING = 8_000_000;
export const SCREEN_A_SUBSET = "screen-ms-v1";
export const SCREEN_A_CONCURRENCY = 4;
/** Pre-registered development target; the campaign computes the verdict from it and never hand-sets it. */
export const SCREEN_A_TARGET = {
  multiSessionCorrect: 18,
  multiSessionTotal: 30,
  maxAbilityLoss: 1,
  maxRunLimit: 0.05,
};
export const SCREEN_A_ARMS = [
  // The local, LLM-free write side. It reports per question with no score, so it is never a reader.
  { id: "write-x", config: "fabric-x", maxInputTokens: 1_000_000, write: true },
  // The reference passive arm 188.9 measured, over that snapshot.
  { id: "x", config: "fabric-x", maxInputTokens: 3_000_000, writeSide: "write-x" },
  // Passive injection plus the read tools over the same snapshot; the only selectable arm.
  { id: "x-tools", config: "fabric-x-tools", maxInputTokens: 3_000_000, writeSide: "write-x" },
];
export const SCREEN_A_ARM_IDS = Object.fromEntries(SCREEN_A_ARMS.map((arm) => [arm.id, `accept18810-screen-a-${arm.id}`]));

export function screenAJobs() {
  return SCREEN_A_ARMS.map((arm) => ({
    id: SCREEN_A_ARM_IDS[arm.id],
    family: "quality",
    suite: "longmemeval-s",
    config: arm.config,
    subset: SCREEN_A_SUBSET,
    maxInputTokens: arm.maxInputTokens,
    concurrency: SCREEN_A_CONCURRENCY,
    // A screen skips judge-only injection labels: they cost tokens and change no guarded decision.
    labelInjections: "off",
    ...(arm.write ? { write: true } : {}),
    ...(arm.writeSide ? { writeSide: SCREEN_A_ARM_IDS[arm.writeSide] } : {}),
  }));
}

export function buildScreenAManifest({ harnessHash = null, productHash = null, writeSideKeys = null } = {}) {
  return {
    schemaVersion: 1,
    kind: "188.10-gate1-stage-a",
    gate: { cap: GATE_1_CAP, approval: GATE_1_APPROVAL, scope: "Stage A, the iteration allowance and Task 9 on the Stage A path" },
    ceiling: SCREEN_A_CEILING,
    priorReservation: 0,
    provider: "opencode-go",
    model: "mimo-v2.5",
    judge: "opencode-go/mimo-v2.5",
    protocolVersion: ACCEPTANCE_1888_PROTOCOL_VERSION,
    dataset: WRITE_SIDE_DATASET,
    sourceRevision: "working-tree",
    subset: SCREEN_A_SUBSET,
    target: SCREEN_A_TARGET,
    // 188.9's probe chose 4 with 0 overloads; a wider screen needs its own probe under the cap.
    concurrency: { concurrency: SCREEN_A_CONCURRENCY, reason: "188.9 probe: 4 questions in flight, 0 overloads" },
    harnessHash,
    productHash,
    writeSideKeys,
    limitations: [
      "Development data only: a failed arm is dropped, never tuned.",
      "`fabric-x` writes locally and spends nothing; only the two read arms cost tokens.",
      "`fabric-x-tools` reuses the `fabric-x` snapshot, so the two arms differ only in tool visibility.",
    ],
    jobs: screenAJobs(),
  };
}

export function assertScreenAManifest(manifest) {
  if (manifest?.kind !== "188.10-gate1-stage-a") throw new AcceptanceManifestError("not the 188.10 Stage A manifest");
  const gate = manifest.gate ?? {};
  if (gate.cap !== GATE_1_CAP) throw new AcceptanceManifestError(`gate 1 cap must be the approved ${GATE_1_CAP}`);
  if (gate.approval === "pending owner approval")
    throw new AcceptanceManifestError("gate 1 cap is not owner-approved yet: no paid call may run");
  if (typeof gate.approval !== "string" || gate.approval.length < 12)
    throw new AcceptanceManifestError("the gate 1 approval is recorded verbatim with its date");
  if (manifest.ceiling !== SCREEN_A_CEILING) throw new AcceptanceManifestError(`Stage A ceiling must be ${SCREEN_A_CEILING}`);
  if (manifest.ceiling > gate.cap) throw new AcceptanceManifestError("the Stage A ceiling cannot exceed the gate 1 cap");
  if (!manifest.harnessHash || !manifest.productHash) throw new AcceptanceManifestError("Stage A needs the harness and product hashes");
  if (manifest.subset !== SCREEN_A_SUBSET) throw new AcceptanceManifestError(`Stage A runs the frozen ${SCREEN_A_SUBSET} development draw`);
  const target = manifest.target ?? {};
  for (const [field, value] of Object.entries(SCREEN_A_TARGET))
    if (target[field] !== value) throw new AcceptanceManifestError(`the pre-registered target fixes ${field} at ${value}`);
  const jobs = manifest.jobs ?? [];
  if (jobs.length !== SCREEN_A_ARMS.length) throw new AcceptanceManifestError("Stage A runs exactly its three declared arms");
  let reads = 0;
  for (const arm of SCREEN_A_ARMS) {
    const job = jobs.find((item) => item.id === SCREEN_A_ARM_IDS[arm.id]);
    if (!job) throw new AcceptanceManifestError(`missing Stage A arm: ${arm.id}`);
    if (job.config !== arm.config) throw new AcceptanceManifestError(`${arm.id} must be ${arm.config}`);
    if (job.suite !== "longmemeval-s") throw new AcceptanceManifestError(`${arm.id} must run longmemeval-s`);
    if (HELDOUT_SUBSETS.includes(job.subset)) throw new AcceptanceManifestError(`Stage A refuses ${job.subset}: it is a held-out draw`);
    if (job.subset !== SCREEN_A_SUBSET) throw new AcceptanceManifestError(`${arm.id} must run ${SCREEN_A_SUBSET}`);
    if (job.labelInjections !== "off") throw new AcceptanceManifestError(`${arm.id} runs with injection labels off`);
    if ((job.maxInputTokens ?? 0) > arm.maxInputTokens) throw new AcceptanceManifestError(`${arm.id} cap exceeds ${arm.maxInputTokens}`);
    if (!arm.write && !arm.writeSide) throw new AcceptanceManifestError(`${arm.id} would read an undeclared store`);
    if (!arm.write) reads += job.maxInputTokens ?? 0;
  }
  const writer = jobs.find((job) => job.id === SCREEN_A_ARM_IDS["write-x"]);
  if (!writer?.write) throw new AcceptanceManifestError("Stage A needs its `fabric-x` writer");
  for (const job of jobs.filter((item) => item.writeSide))
    if (job.writeSide !== writer.id) throw new AcceptanceManifestError(`${job.id} must reuse the \`fabric-x\` snapshot`);
  // The reads are the spend claim; the `fabric-x` write side makes no model call.
  if (reads > manifest.ceiling) throw new AcceptanceManifestError("Stage A read caps exceed the Stage A ceiling");
  return manifest;
}

/**
 * The pre-registered `T_dev` verdict: multi-session at or above the absolute target, no other ability
 * down more than one question against `fabric-x`, run limits at or under 5%. Only the tools arm can be
 * selected; missing `T_dev` leaves `selected` null so Task 8 runs.
 */
export function screenAVerdict({ reference, arms = {}, target = SCREEN_A_TARGET } = {}) {
  if (!reference) throw new AcceptanceManifestError("the Stage A verdict needs the fabric-x reference");
  const base = screenArmCounts(reference);
  const verdicts = {};
  for (const [name, report] of Object.entries(arms)) {
    const counts = screenArmCounts(report);
    const multiSession = counts.perAbility["multi-session"] ?? { correct: 0, total: 0 };
    const abilityLosses = {};
    for (const [ability, value] of Object.entries(base.perAbility)) {
      if (ability === "multi-session") continue;
      abilityLosses[ability] = value.correct - (counts.perAbility[ability]?.correct ?? 0);
    }
    const maxLoss = Math.max(0, ...Object.values(abilityLosses));
    const missed = [];
    if (multiSession.correct < target.multiSessionCorrect)
      missed.push(
        `multi-session ${multiSession.correct}/${multiSession.total} < ${target.multiSessionCorrect}/${target.multiSessionTotal}`,
      );
    if (multiSession.total !== target.multiSessionTotal)
      missed.push(`multi-session answered ${multiSession.total}, target is set on ${target.multiSessionTotal}`);
    if (maxLoss > target.maxAbilityLoss) missed.push(`worst ability loss ${maxLoss} > ${target.maxAbilityLoss}`);
    if (counts.runLimitRate > target.maxRunLimit) missed.push(`run-limit rate ${counts.runLimitRate} > ${target.maxRunLimit}`);
    verdicts[name] = {
      met: missed.length === 0,
      multiSession,
      abilityLosses,
      maxAbilityLoss: maxLoss,
      runLimitRate: counts.runLimitRate,
      correct: counts.correct,
      total: counts.total,
      reason: missed.length
        ? missed.join("; ")
        : `multi-session ${multiSession.correct}/${multiSession.total}, worst ability loss ${maxLoss}, run limit ${counts.runLimitRate}`,
    };
  }
  const selected = Object.entries(verdicts).find(([, verdict]) => verdict.met)?.[0] ?? null;
  return {
    kind: "188.10-stage-a-verdict",
    target,
    reference: { correct: base.correct, total: base.total, perAbility: base.perAbility },
    arms: verdicts,
    selected,
    // The plan's rule, stated as data so the next task reads it instead of remembering it.
    next: selected === null ? "stage-b" : { skipStageB: true, heldoutArm: selected },
  };
}

/** Per-arm totals from a report: questions correct, run-limit rate, and the same per ability. */
export function screenArmCounts(report) {
  const rows = report?.results ?? [];
  const perAbility = {};
  let correct = 0;
  for (const row of rows) {
    const value = metricValue(row) === 1 ? 1 : 0;
    correct += value;
    const ability = row.ability ?? "unknown";
    perAbility[ability] ??= { correct: 0, total: 0 };
    // A run-limit question is wrong but still a question, so the denominator stays the whole arm.
    perAbility[ability].total += 1;
    perAbility[ability].correct += value;
  }
  return {
    correct,
    total: rows.length,
    runLimitRate: rows.length ? rows.filter((row) => row.outcome === "run_limit").length / rows.length : 0,
    perAbility,
  };
}

/**
 * The pre-registered go/no-go rule. `fabric-x`/`fabric-xc` proceed when they gain at least three
 * questions over the baseline and no ability loses more than one; the agentic arm proceeds on its
 * run-limit rate alone. Nothing here can change a parameter.
 */
export function screenVerdict({ baseline, arms, rule = SCREEN_1889_RULE }) {
  if (!baseline) throw new AcceptanceManifestError("the screen verdict needs the baseline arm");
  const base = screenArmCounts(baseline);
  const verdicts = {};
  for (const [name, report] of Object.entries(arms ?? {})) {
    const counts = screenArmCounts(report);
    const gainQuestions = counts.correct - base.correct;
    const abilityLosses = Object.fromEntries(
      Object.entries(base.perAbility).map(([ability, baselineAbility]) => {
        const armAbility = counts.perAbility[ability] ?? { correct: 0 };
        return [ability, baselineAbility.correct - armAbility.correct];
      }),
    );
    const maxLoss = Math.max(0, ...Object.values(abilityLosses));
    if (name.endsWith("agentic")) {
      const proceed = counts.runLimitRate <= rule.maxRunLimit;
      verdicts[name] = {
        proceed,
        gainQuestions,
        abilityLosses,
        runLimitRate: counts.runLimitRate,
        reason: proceed
          ? `run-limit rate ${counts.runLimitRate} <= ${rule.maxRunLimit}`
          : `run-limit rate ${counts.runLimitRate} > ${rule.maxRunLimit}`,
      };
      continue;
    }
    const proceed = gainQuestions >= rule.minGainQuestions && maxLoss <= rule.maxAbilityLoss;
    verdicts[name] = {
      proceed,
      gainQuestions,
      abilityLosses,
      runLimitRate: counts.runLimitRate,
      reason: proceed
        ? `gained ${gainQuestions} questions; worst ability loss ${maxLoss}`
        : `gained ${gainQuestions} questions; worst ability loss ${maxLoss} (needs +${rule.minGainQuestions} and <= ${rule.maxAbilityLoss})`,
    };
  }
  return {
    rule,
    baseline: { correct: base.correct, total: base.total, runLimitRate: base.runLimitRate, perAbility: base.perAbility },
    arms: verdicts,
    proceed: Object.entries(verdicts)
      .filter(([, verdict]) => verdict.proceed)
      .map(([name]) => name),
  };
}

/** (1) Does post-fix improve on pre-fix? Answered only from the predeclared primary family. */
export function improvementVerdict({ groups, powered = true }) {
  const primary = Object.entries(groups).filter(([ability]) => PRIMARY_1888_ABILITIES.includes(ability));
  if (!powered || primary.length !== PRIMARY_1888_ABILITIES.length) return "inconclusive";
  const gains = primary.filter(([, group]) => group.diff > 0 && group.pHolm < 0.05);
  const losses = primary.filter(([, group]) => group.diff < 0 && group.pHolm < 0.05);
  if (losses.length) return "worse";
  return gains.length ? "improved" : "inconclusive";
}

/**
 * (2) Is a fabric arm a full-context substitute? Independent of (1).
 * `powered` is the statistical gate (paired clusters and simulated power), not `confirmatory`,
 * which also demands complete wire-usage accounting. Incomplete usage is a cost caveat, not a
 * quality caveat, and is reported separately.
 */
export function substitutionVerdict({ overall, powered = true, margin = NONINFERIORITY_MARGIN_1888 } = {}) {
  return powered && overall?.ci95?.[0] >= -margin ? "full-context-substitute" : "not-a-substitute";
}

/** Paired, completed, enough independent clusters and simulated power: a quality claim may be made. */
export function statisticallyPowered(group) {
  return Boolean(group && group.n > 0 && group.clusters >= CONFIRMATORY_MIN_CLUSTERS && group.power >= 0.8);
}

/** Holm over exactly the four predeclared abilities; other abilities stay descriptive. */
export function primaryFamily1888(groups) {
  const family = {};
  for (const ability of PRIMARY_1888_ABILITIES) if (groups[ability]) family[ability] = { ...groups[ability] };
  if (Object.keys(family).length !== PRIMARY_1888_ABILITIES.length) return family;
  const adjusted = holm(Object.values(family).map((group) => group.p));
  Object.values(family).forEach((group, index) => {
    group.pHolm = adjusted[index];
  });
  return family;
}

/** Aggregate-only arm record: no question, answer or note text can enter evidence. */
export function armRecord1888(report) {
  const values = report.results.map(metricValue);
  return {
    status: report.status,
    usageComplete: report.usageComplete !== false,
    answers: report.results.length,
    correct: report.results.filter((row) => metricValue(row) === 1).length,
    accuracy: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
    runLimitRate: report.results.length ? report.results.filter((row) => row.outcome === "run_limit").length / report.results.length : 0,
    inputTokens: report.inputTokens ?? 0,
    cacheReadTokens: report.cacheReadTokens ?? 0,
    outputTokens: report.outputTokens ?? 0,
  };
}

/** A single missing primary arm keeps the plan task unchecked; the note says what is missing. */
export function acceptance1888TaskState({ missing = [] } = {}) {
  return { taskComplete: missing.length === 0, missing: missing.map((item) => item.id) };
}

/**
 * F13 vocabulary for the 188.8 evidence column. The finding is the gap to full context, so only
 * the substitution verdict decides it: an improvement alone is never a fix, and an unmoved gap
 * after a null before/after is "unresolved", not "inconclusive". Inconclusive is reserved for a
 * measurement that cannot decide (missing or unpowered arms).
 */
export function findingVerdict1888({ substitution, powered = true }) {
  if (!powered) return "inconclusive";
  return substitution === "full-context-substitute" ? "fixed" : "unresolved";
}

export function qualityVerdict({ candidateImproves, fullContextNonInferior, powered }) {
  if (!powered) return "inconclusive";
  if (!candidateImproves) return "not-useful";
  return fullContextNonInferior ? "full-context-substitute" : "opt-in-improvement";
}

export function defaultGate({ quality, safety, powered, costReduction }) {
  if (quality === "full-context-substitute" && safety === "passed" && powered && costReduction?.met === true)
    return { promotion: true, injection: true, reason: "quality, safety, power and comparable cost gates passed" };
  return {
    promotion: false,
    injection: false,
    reason: `retained off: quality=${quality}, safety=${safety}, powered=${powered}, cost=${costReduction?.met === true ? "passed" : "failed"}`,
  };
}

export function priceAvailable({ usageComplete, rateKnown }) {
  return usageComplete === true && rateKnown === true;
}

const FINDING_VERDICTS = new Set(["fixed", "not-reproduced", "unresolved", "inconclusive"]);
export function validateFindingMatrix(rows, required = 13) {
  if (!Array.isArray(rows) || rows.length !== required) throw new AcceptanceManifestError(`finding matrix needs ${required} rows`);
  for (const [index, row] of rows.entries()) {
    if (row.id !== `F${index + 1}`) throw new AcceptanceManifestError(`finding row ${index + 1} is not F${index + 1}`);
    if (!FINDING_VERDICTS.has(row.verdict)) throw new AcceptanceManifestError(`${row.id} has no allowed verdict`);
    if (!row.tests || !row.paidEvidence) throw new AcceptanceManifestError(`${row.id} needs tests and paid evidence`);
    if (row.verdict === "fixed" && row.paidEvidence === "none")
      throw new AcceptanceManifestError(`${row.id} cannot be fixed without paid evidence`);
  }
  return rows;
}

/*
 * Plan 188.9 acceptance: held-out v2, the 188.8-pinned baseline against the screened-in exchange
 * arm. `fabric-xc` is out of scope (owner decision, 2026-10-22): its write side is unmeasured and
 * half its sessions failed consolidation. The full-context reference is reused, because the full arm
 * sends the whole history and never reaches the delivery code this plan changed.
 */
export const ACCEPTANCE_1889_CEILING = 12_000_000;
export const ACCEPTANCE_1889_EVIDENCE = "docs/_evidence/memory-bench/188.9/acceptance";
export const ACCEPTANCE_1889_MANIFEST = `${ACCEPTANCE_1889_EVIDENCE}/acceptance-manifest.json`;
export const ACCEPTANCE_1889_JOURNAL = `${ACCEPTANCE_1889_EVIDENCE}/acceptance-journal.json`;
export const ACCEPTANCE_1889_SUMMARY = `${ACCEPTANCE_1889_EVIDENCE}/acceptance-run.json`;
export const ACCEPTANCE_1889_LOGS = ".cache/memory-bench/188.9/acceptance";
export const ACCEPTANCE_1889_FULL_REPORT = "docs/_evidence/memory-bench/188.8/final-accept1888-full.json";
export const PRIMARY_1889_ABILITIES = PRIMARY_1888_ABILITIES;
export const NONINFERIORITY_MARGIN_1889 = 0.03;
export const ACCEPTANCE_1889_CONCURRENCY = SCREEN_1889_MAX_CONCURRENCY;
export const ARMS_1889 = [
  // A cap is a reservation pool: the kernel reserves 250k per request in flight, so an arm needs
  // room for its concurrency (answer + judges + label calls), not just its measured spend.
  { id: "baseline", config: "fabric", maxInputTokens: 4_000_000, ablate: [SCREEN_1889_BASELINE_VARIANT] },
  // The reservation must cover in-flight requests, and an acceptance arm keeps its judge-only
  // injection labels: 4 questions x (answer + labels + judges) needs more headroom than 2.5M.
  { id: "x", config: "fabric-x", maxInputTokens: 5_000_000, writeSide: "write-x" },
  { id: "write-x", config: "fabric-x", maxInputTokens: 1_500_000, write: true },
];
export const ARM_1889_IDS = Object.fromEntries(ARMS_1889.map((arm) => [arm.id, `accept1889-${arm.id}`]));

export function acceptance1889Jobs() {
  return ARMS_1889.map((arm) => ({
    id: ARM_1889_IDS[arm.id],
    family: "quality",
    suite: "longmemeval-s",
    config: arm.config,
    subset: "heldout-v2",
    maxInputTokens: arm.maxInputTokens,
    concurrency: ACCEPTANCE_1889_CONCURRENCY,
    ...(arm.ablate ? { ablate: [...arm.ablate] } : {}),
    ...(arm.write ? { write: true } : {}),
    ...(arm.writeSide ? { writeSide: ARM_1889_IDS[arm.writeSide] } : {}),
  }));
}

/**
 * Whether 188.8's `full` arm can stand in for a paid rerun. The full arm sends the whole history with
 * compaction off, so its prompt is the dataset and the generation protocol, not the delivery code
 * this plan changed. Every field that shapes its answers must match; the harness file hashes are not
 * compared, because that drift cannot reach a prompt that never calls memory.
 */
export async function fullReferenceReuse1889(prior, heldout) {
  const refuse = (reason) => ({ ok: false, reason });
  if (prior?.status !== "completed") return refuse(`source is ${prior?.status ?? "unreadable"}`);
  if (prior.usageComplete === false) return refuse("source usage is incomplete");
  if (prior.suite !== "longmemeval-s" || prior.subset !== "heldout-v2" || prior.config !== "full")
    return refuse("source is not the held-out full-context arm");
  const ids = prior.results.map((row) => String(row.id)).sort();
  const expected = Object.values(heldout.ids).flat().map(String).sort();
  if (ids.length !== 100 || ids.join() !== expected.join()) return refuse("source ids differ from held-out v2");
  if (prior.protocolVersion !== ACCEPTANCE_1888_PROTOCOL_VERSION) return refuse("protocol version differs");
  const generation = prior.generation ?? {};
  if (generation.temperature !== 0 || generation.maxTokens !== 4096) return refuse("generation differs");
  if (prior.model !== "mimo-v2.5" || prior.judge !== "opencode-go/mimo-v2.5" || prior.judgeProtocol !== "enum-json-v1")
    return refuse("model or judge differs");
  return {
    ok: true,
    from: ACCEPTANCE_1889_FULL_REPORT,
    inputCap: prior.inputCap,
    idsHash: hash(ids),
    protocolHash: prior.protocolHash ?? null,
    reason: "the full arm sends the whole history and never reaches the delivery code this plan changed",
  };
}

export function buildAcceptance1889Manifest({ harnessHash = null, productHash = null, writeSideKey = null, fullReference } = {}) {
  return {
    schemaVersion: 4,
    kind: "188.9-heldout-acceptance",
    ceiling: ACCEPTANCE_1889_CEILING,
    priorReservation: 0,
    provider: "opencode-go",
    model: "mimo-v2.5",
    judge: "opencode-go/mimo-v2.5",
    judgeProtocol: "enum-json-v1",
    protocolVersion: ACCEPTANCE_1888_PROTOCOL_VERSION,
    sourceRevision: "working-tree",
    dataset: "longmemeval-s@98d7416c",
    heldoutV2: heldout1888(),
    primaryAbilities: PRIMARY_1889_ABILITIES,
    nonInferiorityMargin: NONINFERIORITY_MARGIN_1889,
    baselineVariant: SCREEN_1889_BASELINE_VARIANT,
    concurrency: {
      concurrency: ACCEPTANCE_1889_CONCURRENCY,
      reason: "Task 10 probe: highest step with no overloads and a p95 under 1.5x step 4",
    },
    writeSideKey,
    // Provenance only: what the tree looked like when the manifest was frozen.
    sourceHashes: { harness: harnessHash, product: productHash },
    fullReference,
    unavailable: [
      { arm: "xc", reason: "owner decision: its write side is unmeasured and 25 of 51 measured sessions failed consolidation" },
      { arm: "xc-agentic", reason: "reads the unavailable `xc` store" },
      { arm: "agentic", reason: "not screened in: no held-out job for a tool arm without a screened-in store" },
    ],
    limitations: [
      "Held-out v2 labels were read once, after 188.8's paid runs, for stage attribution only; no parameter came from them.",
      "The baseline is the current tree with `fabric.delivery=188.8` pinned by variant, so representation is the only treatment.",
      "The `full` reference is reused; its answers come from the dataset and the generation protocol, not from delivery.",
      "Delivery-stage diagnostics are offline and read gold evidence after the paid arms finish.",
    ],
    jobs: acceptance1889Jobs(),
  };
}

export function assertAcceptance1889Manifest(manifest) {
  if (manifest?.kind !== "188.9-heldout-acceptance") throw new AcceptanceManifestError("not the 188.9 acceptance manifest");
  if (manifest.ceiling !== ACCEPTANCE_1889_CEILING) throw new AcceptanceManifestError(`ceiling must be ${ACCEPTANCE_1889_CEILING}`);
  if (manifest.protocolVersion !== ACCEPTANCE_1888_PROTOCOL_VERSION)
    throw new AcceptanceManifestError(`protocol version must be ${ACCEPTANCE_1888_PROTOCOL_VERSION}`);
  const jobs = manifest.jobs ?? [];
  if (jobs.length !== ARMS_1889.length || new Set(jobs.map((job) => job.id)).size !== jobs.length)
    throw new AcceptanceManifestError("the acceptance runs exactly its declared arms");
  let totalCaps = 0;
  for (const arm of ARMS_1889) {
    const job = jobs.find((item) => item.id === ARM_1889_IDS[arm.id]);
    if (!job) throw new AcceptanceManifestError(`missing arm: ${arm.id}`);
    if (job.config !== arm.config || job.subset !== "heldout-v2")
      throw new AcceptanceManifestError(`${arm.id} must be ${arm.config} on heldout-v2`);
    if (!Number.isSafeInteger(job.maxInputTokens) || job.maxInputTokens < 1 || job.maxInputTokens > arm.maxInputTokens)
      throw new AcceptanceManifestError(`${arm.id} cap must be 1..${arm.maxInputTokens}`);
    totalCaps += job.maxInputTokens;
  }
  const baseline = jobs.find((job) => job.id === ARM_1889_IDS.baseline);
  if (!baseline.ablate?.includes(SCREEN_1889_BASELINE_VARIANT))
    throw new AcceptanceManifestError("the baseline must pin 188.8's delivery rule");
  if (jobs.find((job) => job.id === ARM_1889_IDS.x).ablate !== undefined)
    throw new AcceptanceManifestError("the treatment arm must not carry the baseline variant");
  if (jobs.find((job) => job.id === ARM_1889_IDS.x).writeSide !== ARM_1889_IDS["write-x"])
    throw new AcceptanceManifestError("the exchange arm must read its own write side");
  if (totalCaps > manifest.ceiling) throw new AcceptanceManifestError("arm caps exceed the campaign ceiling");
  const heldout = new Set(Object.values(manifest.heldoutV2?.ids ?? {}).flat());
  if (heldout.size !== 100) throw new AcceptanceManifestError("held-out v2 needs 100 ids");
  for (const ability of PRIMARY_1889_ABILITIES)
    if (manifest.heldoutV2?.counts?.[ability] !== 20) throw new AcceptanceManifestError(`held-out ${ability} needs 20 ids`);
  if (!manifest.fullReference?.ok) throw new AcceptanceManifestError("the full reference must be a checked reuse");
  if (!manifest.writeSideKey) throw new AcceptanceManifestError("the write side needs its cache key");
  return manifest;
}

/*
 * Plan 188.10 Task 9: the live held-out v3 acceptance of Stage A's selected configuration. The arm
 * comes from the Stage A verdict and the product hash must equal Stage A's, so nothing here can
 * quietly run a different configuration on ids nobody has read. The primary criteria are data in the
 * manifest, and the verdict is computed from them.
 */
export const ACCEPTANCE_18810_ACCEPTANCE_EVIDENCE = `${ACCEPTANCE_18810_EVIDENCE}/acceptance`;
export const ACCEPTANCE_18810_MANIFEST = `${ACCEPTANCE_18810_ACCEPTANCE_EVIDENCE}/acceptance-manifest.json`;
export const ACCEPTANCE_18810_JOURNAL = `${ACCEPTANCE_18810_ACCEPTANCE_EVIDENCE}/acceptance-journal.json`;
export const ACCEPTANCE_18810_SUMMARY = `${ACCEPTANCE_18810_ACCEPTANCE_EVIDENCE}/acceptance-run.json`;
export const ACCEPTANCE_18810_COMPARISONS = `${ACCEPTANCE_18810_ACCEPTANCE_EVIDENCE}/acceptance-comparisons.json`;
export const ACCEPTANCE_18810_LOGS = ".cache/memory-bench/188.10/acceptance";
/**
 * Reservation pool. A cap must cover the kernel's in-flight reservation (250k per request, and a
 * question holds an answer plus its judges and labels), not just measured spend: at concurrency 4
 * the first attempt exhausted a 1M `x` cap after 4 questions and a 5M `x-tools` cap after 79.
 */
export const ACCEPTANCE_18810_CEILING = 26_000_000;
/** Gate 1 spend before this task: the archived Stage A attempt plus the corrected campaign. */
export const ACCEPTANCE_18810_PRIOR_RESERVATION = 2_776_286;
export const ACCEPTANCE_18810_SUBSET = "heldout-v3";
export const ACCEPTANCE_18810_CONCURRENCY = SCREEN_A_CONCURRENCY;
/** Pre-registered: an absolute multi-session target, a paired improvement and explicit non-regression. */
export const ACCEPTANCE_18810_CRITERIA = {
  multiSessionCorrect: 24,
  multiSessionTotal: 40,
  maxAbilityLoss: {
    "knowledge-update": 2,
    "temporal-reasoning": 2,
    "single-session-user": 1,
    "single-session-assistant": 1,
  },
  minOverallDiff: 0,
};
export const ACCEPTANCE_18810_ARMS = [
  // The local, LLM-free write side: a job with no score, never a reader and never a spend claim.
  { id: "write-x", config: "fabric-x", maxInputTokens: 1_000_000, write: true },
  // Labels are on here, so one question holds an answer plus its label and judge calls: at
  // concurrency 4 the passive arm needs ~3.25M in flight alone, so it runs two at a time.
  { id: "x", config: "fabric-x", maxInputTokens: 3_000_000, writeSide: "write-x", concurrency: 2 },
  { id: "x-tools", config: "fabric-x-tools", maxInputTokens: 9_000_000, writeSide: "write-x" },
  { id: "full", config: "full", maxInputTokens: 14_000_000 },
];
export const ACCEPTANCE_18810_ARM_IDS = Object.fromEntries(ACCEPTANCE_18810_ARMS.map((arm) => [arm.id, `accept18810-${arm.id}`]));

export function acceptance18810Jobs() {
  return ACCEPTANCE_18810_ARMS.map((arm) => ({
    id: ACCEPTANCE_18810_ARM_IDS[arm.id],
    family: "quality",
    suite: "longmemeval-s",
    config: arm.config,
    subset: ACCEPTANCE_18810_SUBSET,
    maxInputTokens: arm.maxInputTokens,
    concurrency: arm.concurrency ?? ACCEPTANCE_18810_CONCURRENCY,
    // A held-out acceptance keeps its judge-only injection labels: precision is part of the evidence.
    labelInjections: "on",
    ...(arm.write ? { write: true } : {}),
    ...(arm.writeSide ? { writeSide: ACCEPTANCE_18810_ARM_IDS[arm.writeSide] } : {}),
  }));
}

/** The held-out v3 draw as recorded in Task 2, plus the overlap that would void the held-out claim. */
export function heldoutV3Draw() {
  const screen = new Set(Object.values(screenMsV1.abilities).flat());
  const ids = Object.values(heldoutV3.abilities).flat();
  return {
    subset: ACCEPTANCE_18810_SUBSET,
    draw: heldoutV3.draw,
    salt: heldoutV3.seed,
    datasetSha256: heldoutV3.datasetSha256,
    counts: Object.fromEntries(Object.entries(heldoutV3.abilities).map(([ability, value]) => [ability, value.length])),
    idsHash: heldoutV3.idsHash,
    fileSha256: heldoutV3.fileHash,
    screenOverlap: ids.filter((id) => screen.has(id)).length,
  };
}

/**
 * Stage A's selection, read from its committed verdict. A verdict with no winner (or a missing
 * `skipStageB`) means Task 8 was the path taken, and this manifest must not be built.
 */
export function stageASelection(verdict, { path = SCREEN_A_VERDICT, fileHash = null } = {}) {
  if (!verdict) throw new AcceptanceManifestError(`the Stage A verdict is missing: ${path}`);
  if (verdict.kind !== "188.10-stage-a-verdict") throw new AcceptanceManifestError(`not the Stage A verdict: ${path}`);
  if (verdict.selected !== "x-tools")
    throw new AcceptanceManifestError(`Stage A selected ${verdict.selected ?? "nothing"}: the held-out arm must be \`x-tools\``);
  if (verdict.next?.skipStageB !== true)
    throw new AcceptanceManifestError("Stage A did not skip Stage B, so this is not the selected path");
  if (verdict.next?.heldoutArm !== verdict.selected)
    throw new AcceptanceManifestError("the Stage A verdict's held-out arm disagrees with its selection");
  if (!fileHash) throw new AcceptanceManifestError("the Stage A verdict needs its file hash");
  return { arm: verdict.selected, skipStageB: true, path, fileHash };
}

/** The product is frozen at Stage A's selection; a different tree is a different configuration. */
export function frozenProduct({ productHash = null, stageAManifest } = {}) {
  if (!stageAManifest?.productHash) throw new AcceptanceManifestError("the Stage A manifest has no product hash");
  if (!productHash) throw new AcceptanceManifestError("the acceptance needs the current product hash");
  if (productHash !== stageAManifest.productHash)
    throw new AcceptanceManifestError("the product changed since Stage A: this is not the selected configuration");
  return { hash: productHash, stageAHash: stageAManifest.productHash };
}

export function buildAcceptance18810Manifest({ harnessHash = null, product = null, selection = null, writeSideKey = null } = {}) {
  return {
    schemaVersion: 5,
    kind: "188.10-heldout-acceptance",
    gate: { cap: GATE_1_CAP, approval: GATE_1_APPROVAL, scope: "Stage A, the iteration allowance and Task 9 on the Stage A path" },
    ceiling: ACCEPTANCE_18810_CEILING,
    priorReservation: ACCEPTANCE_18810_PRIOR_RESERVATION,
    provider: "opencode-go",
    model: "mimo-v2.5",
    judge: "opencode-go/mimo-v2.5",
    judgeProtocol: "enum-json-v1",
    protocolVersion: ACCEPTANCE_1888_PROTOCOL_VERSION,
    dataset: WRITE_SIDE_DATASET,
    sourceRevision: "working-tree",
    selection,
    product,
    // Provenance only: what the harness looked like when the manifest was frozen.
    harnessHash,
    heldoutV3: heldoutV3Draw(),
    criteria: ACCEPTANCE_18810_CRITERIA,
    nonInferiorityMargin: NONINFERIORITY_MARGIN_1888,
    concurrency: {
      concurrency: ACCEPTANCE_18810_CONCURRENCY,
      reason: "188.9 probe: 4 questions in flight, 0 overloads",
    },
    writeSideKey,
    limitations: [
      "Held-out v3 labels are inspected only after scoring, for stage attribution.",
      "Preference and abstention have no fresh ids; their non-regression is Stage A's `T_dev` guard.",
      "The `x` and `x-tools` arms read one `write-x` snapshot, so they differ only in tool visibility.",
      "No `xc` arm runs: Stage A selected the exchange arm.",
    ],
    jobs: acceptance18810Jobs(),
  };
}

export function assertAcceptance18810Manifest(manifest) {
  if (manifest?.kind !== "188.10-heldout-acceptance") throw new AcceptanceManifestError("not the 188.10 acceptance manifest");
  const gate = manifest.gate ?? {};
  if (gate.cap !== GATE_1_CAP) throw new AcceptanceManifestError(`gate 1 cap must be the approved ${GATE_1_CAP}`);
  if (gate.approval === "pending owner approval")
    throw new AcceptanceManifestError("gate 1 cap is not owner-approved yet: no paid call may run");
  if (typeof gate.approval !== "string" || gate.approval.length < 12)
    throw new AcceptanceManifestError("the gate 1 approval is recorded verbatim with its date");
  if (manifest.ceiling !== ACCEPTANCE_18810_CEILING) throw new AcceptanceManifestError(`ceiling must be ${ACCEPTANCE_18810_CEILING}`);
  if (manifest.priorReservation !== ACCEPTANCE_18810_PRIOR_RESERVATION)
    throw new AcceptanceManifestError(`gate 1 prior use is ${ACCEPTANCE_18810_PRIOR_RESERVATION}`);
  if (manifest.priorReservation + manifest.ceiling > gate.cap)
    throw new AcceptanceManifestError("the ceiling does not fit gate 1's remainder");
  if (manifest.protocolVersion !== ACCEPTANCE_1888_PROTOCOL_VERSION)
    throw new AcceptanceManifestError(`protocol version must be ${ACCEPTANCE_1888_PROTOCOL_VERSION}`);
  const selection = manifest.selection ?? {};
  if (selection.arm !== "x-tools" || selection.skipStageB !== true || !selection.path || !selection.fileHash)
    throw new AcceptanceManifestError("Stage A's selected `x-tools` arm is not the manifest's selection");
  if (!manifest.harnessHash) throw new AcceptanceManifestError("the acceptance needs its harness hash");
  const product = manifest.product ?? {};
  if (!product.hash || product.hash !== product.stageAHash)
    throw new AcceptanceManifestError("the product is not frozen at Stage A's selection");
  const criteria = manifest.criteria ?? {};
  for (const [field, value] of Object.entries(ACCEPTANCE_18810_CRITERIA))
    if (JSON.stringify(criteria[field]) !== JSON.stringify(value))
      throw new AcceptanceManifestError(`the pre-registered criteria fix ${field}`);
  const heldout = manifest.heldoutV3 ?? {};
  if (heldout.subset !== ACCEPTANCE_18810_SUBSET) throw new AcceptanceManifestError(`the acceptance runs ${ACCEPTANCE_18810_SUBSET}`);
  if (heldout.idsHash !== heldoutV3.idsHash || heldout.fileSha256 !== heldoutV3.fileHash)
    throw new AcceptanceManifestError("the held-out v3 ids differ from the frozen draw");
  if (heldout.screenOverlap !== 0) throw new AcceptanceManifestError("the held-out draw overlaps the development screen");
  const counts = heldoutV3Draw().counts;
  for (const [ability, size] of Object.entries(counts))
    if (heldout.counts?.[ability] !== size) throw new AcceptanceManifestError(`held-out v3 ${ability} needs ${size} ids`);
  const jobs = manifest.jobs ?? [];
  if (jobs.length !== ACCEPTANCE_18810_ARMS.length || new Set(jobs.map((job) => job.id)).size !== jobs.length)
    throw new AcceptanceManifestError("the acceptance runs exactly its declared arms");
  if (jobs.some((job) => ["xc", "fabric-xc", "fabric-xc-tools"].includes(job.config)))
    throw new AcceptanceManifestError("no `xc` job runs on the Stage A path");
  let reads = 0;
  const writer = jobs.find((job) => job.id === ACCEPTANCE_18810_ARM_IDS["write-x"]);
  if (!writer?.write) throw new AcceptanceManifestError("the acceptance needs its `fabric-x` writer");
  for (const arm of ACCEPTANCE_18810_ARMS) {
    const job = jobs.find((item) => item.id === ACCEPTANCE_18810_ARM_IDS[arm.id]);
    if (!job) throw new AcceptanceManifestError(`missing acceptance arm: ${arm.id}`);
    if (job.config !== arm.config) throw new AcceptanceManifestError(`${arm.id} must be ${arm.config}`);
    if (job.suite !== "longmemeval-s") throw new AcceptanceManifestError(`${arm.id} must run longmemeval-s`);
    if (job.subset !== ACCEPTANCE_18810_SUBSET) throw new AcceptanceManifestError(`${arm.id} must run ${ACCEPTANCE_18810_SUBSET}`);
    if (job.labelInjections !== "on") throw new AcceptanceManifestError(`${arm.id} keeps its injection labels`);
    if (!Number.isSafeInteger(job.concurrency) || job.concurrency < 1 || job.concurrency > ACCEPTANCE_18810_CONCURRENCY)
      throw new AcceptanceManifestError(`${arm.id} concurrency must be 1..${ACCEPTANCE_18810_CONCURRENCY}`);
    if ((job.maxInputTokens ?? 0) > arm.maxInputTokens) throw new AcceptanceManifestError(`${arm.id} cap exceeds ${arm.maxInputTokens}`);
    if (arm.write) {
      if (job.write !== true) throw new AcceptanceManifestError(`${arm.id} is the writer`);
      if (job.writeSide) throw new AcceptanceManifestError(`${arm.id} writes, so it cannot also read a snapshot`);
      continue;
    }
    // `full` reads no memory store; a memory arm must read the one `write-x` snapshot.
    if (arm.writeSide && job.writeSide !== writer.id) throw new AcceptanceManifestError(`${arm.id} must reuse the \`fabric-x\` snapshot`);
    if (!arm.writeSide && job.writeSide) throw new AcceptanceManifestError(`${arm.id} has no write side to read`);
    reads += job.maxInputTokens ?? 0;
  }
  // The reads are the spend claim; the `fabric-x` write side makes no model call.
  if (reads > manifest.ceiling) throw new AcceptanceManifestError("acceptance read caps exceed the ceiling");
  if (!manifest.writeSideKey) throw new AcceptanceManifestError("the write side needs its cache key");
  return manifest;
}

/**
 * The pre-registered Task 9 verdict. All three primary criteria must hold: the absolute target, the
 * paired multi-session improvement with a CI lower bound above zero, and per-ability non-regression
 * plus an overall difference at or above zero.
 */
export function acceptance18810Verdict({ reference, arm, comparison, criteria = ACCEPTANCE_18810_CRITERIA } = {}) {
  if (!reference || !arm) throw new AcceptanceManifestError("the verdict needs both the reference and the selected arm");
  const base = screenArmCounts(reference);
  const treated = screenArmCounts(arm);
  const multiSession = treated.perAbility["multi-session"] ?? { correct: 0, total: 0 };
  const checks = [];
  checks.push({
    id: "multi-session-absolute",
    ok: multiSession.correct >= criteria.multiSessionCorrect && multiSession.total === criteria.multiSessionTotal,
    detail: `multi-session ${multiSession.correct}/${multiSession.total}, target ${criteria.multiSessionCorrect}/${criteria.multiSessionTotal}`,
  });
  const paired = comparison?.["multi-session"] ?? null;
  checks.push({
    id: "multi-session-paired-improvement",
    ok: Boolean(paired && paired.diff > 0 && (paired.ci95?.[0] ?? -Infinity) > 0),
    detail: paired
      ? `diff ${paired.diff.toFixed(4)}, 95% CI [${paired.ci95.map((value) => value.toFixed(4)).join(", ")}]`
      : "no paired multi-session comparison",
  });
  const abilityLosses = {};
  for (const [ability, limit] of Object.entries(criteria.maxAbilityLoss)) {
    const loss = (base.perAbility[ability]?.correct ?? 0) - (treated.perAbility[ability]?.correct ?? 0);
    abilityLosses[ability] = { loss, limit, ok: loss <= limit };
  }
  const regressed = Object.entries(abilityLosses)
    .filter(([, value]) => !value.ok)
    .map(([ability, value]) => `${ability} lost ${value.loss} > ${value.limit}`);
  const overallDiff = comparison?.overall?.diff ?? null;
  checks.push({
    id: "non-regression",
    ok: regressed.length === 0 && overallDiff !== null && overallDiff >= criteria.minOverallDiff,
    detail: regressed.length
      ? regressed.join("; ")
      : `overall paired diff ${overallDiff === null ? "missing" : overallDiff.toFixed(4)} (needs >= ${criteria.minOverallDiff})`,
  });
  const failed = checks.filter((check) => !check.ok);
  return {
    kind: "188.10-heldout-verdict",
    criteria,
    checks,
    abilityLosses,
    counts: {
      selected: { correct: treated.correct, total: treated.total, perAbility: treated.perAbility, runLimitRate: treated.runLimitRate },
      reference: { correct: base.correct, total: base.total, perAbility: base.perAbility },
    },
    met: failed.length === 0,
    multiSessionSuccess: failed.length === 0,
    reason: failed.length ? failed.map((check) => `${check.id}: ${check.detail}`).join("; ") : "all primary criteria hold",
  };
}
