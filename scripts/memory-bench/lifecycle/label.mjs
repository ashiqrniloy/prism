#!/usr/bin/env bun
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgent } from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { lexicalDice, lexicalTerms } from "@arnilo/prism-memory-core";
import { gatherConsolidationCandidates } from "../../../packages/memory/fabric/src/consolidation/gather.ts";
import { scanSecrets } from "../../scan-secrets.mjs";
import { judgeLifecycle } from "../judge.mjs";
import prompts from "../judge-prompts.json" with { type: "json" };
import { args, CACHE, hash, loadLedgers, validateLedger } from "./io.mjs";
import { replayUsage } from "./replay.mjs";

const fields = ["shouldPromote", "kind", "scope", "key", "appliesTo", "ephemeral", "derivable", "duplicateOf"];
const canonical = (value) => JSON.stringify(value ?? null);
const equal = (a, b) => canonical(a) === canonical(b);
export function validateLabel(label) {
  if (
    !label ||
    typeof label !== "object" ||
    Array.isArray(label) ||
    Object.keys(label).some((k) => !fields.includes(k)) ||
    ["shouldPromote", "ephemeral", "derivable"].some((k) => typeof label[k] !== "boolean") ||
    !["fact", "preference", "procedure", "episode"].includes(label.kind) ||
    !["user", "project", "path", "agent"].includes(label.scope) ||
    typeof label.key !== "string" ||
    label.key.trim() !== label.key ||
    !/^[a-z][a-z0-9._-]{0,127}$/.test(label.key) ||
    (label.duplicateOf !== undefined &&
      (typeof label.duplicateOf !== "string" || label.duplicateOf.length !== 64 || !/^[a-f0-9]{64}$/.test(label.duplicateOf))) ||
    (label.scope === "path" && !label.appliesTo?.length) ||
    (label.appliesTo !== undefined &&
      (!Array.isArray(label.appliesTo) ||
        !label.appliesTo.length ||
        label.appliesTo.length > 32 ||
        label.appliesTo.some(
          (p) => typeof p !== "string" || p.length > 256 || !p || p.startsWith("/") || p.split("/").includes("..") || /[\n\r\0]/.test(p),
        )))
  )
    throw new Error("Lifecycle label schema");
  return Object.fromEntries(
    fields.filter((k) => label[k] !== undefined).map((k) => [k, k === "appliesTo" ? [...new Set(label[k])].sort() : label[k]]),
  );
}
function validatePair(label) {
  if (!label || Object.keys(label).length !== 1 || typeof label.sameNote !== "boolean") throw new Error("Lifecycle pair label schema");
  return { sameNote: label.sameNote };
}
async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}
async function publish(path, value) {
  const stage = `${path}.${hash(value).slice(0, 12)}.tmp`;
  try {
    await writeFile(stage, value, { mode: 0o600 });
    await scanSecrets([stage]);
    await rename(stage, path);
  } finally {
    await rm(stage, { force: true });
  }
}
const jsonl = (rows) => rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "");

function candidatesFrom(ledgers) {
  const candidates = [];
  for (const ledger of ledgers) {
    validateLedger(ledger);
    const m = ledger.manifest;
    if (m.source === "recorded" && m.redactionVersion !== "session+scan+identity-v1") throw new Error("Lifecycle redaction version");
    if (m.source === "synthetic") {
      for (const label of m.labels) {
        const entries = ledger.entries.filter((e) => label.entryIds.includes(e.id));
        const text = entries
          .map(
            (e) =>
              e.message?.content
                ?.flatMap((b) => (b.type === "text" ? [b.text] : (b.content ?? []).filter((b) => b.type === "text").map((b) => b.text)))
                .join("\n") ??
              (e.data?.observations ?? e.data?.reflections ?? e.data?.taskState?.decisions ?? [])
                .map((v) => (typeof v === "string" ? v : v.content))
                .join("\n"),
          )
          .join("\n")
          .replace(/^(?:Remember |Actually, )/, "");
        if (!text || hash(text) !== label.contentHash) throw new Error("Lifecycle synthetic label content");
        candidates.push({
          id: hash([m.persona, m.project, label.id]),
          persona: m.persona,
          project: m.project,
          session: m.session,
          entryIds: label.entryIds,
          source: label.source,
          contentHash: label.contentHash,
          text,
          construction: validateLabel(Object.fromEntries(fields.filter((k) => label[k] !== undefined).map((k) => [k, label[k]]))),
        });
      }
    } else {
      for (const c of gatherConsolidationCandidates(ledger.entries, { maxCandidates: 10000 })) {
        const contentHash = hash(c.text);
        candidates.push({
          id: hash([m.persona, m.project, m.session, c.evidenceIds, contentHash]),
          persona: m.persona,
          project: m.project,
          session: m.session,
          entryIds: c.evidenceIds,
          source: c.source,
          contentHash,
          text: c.text,
        });
      }
    }
  }
  if (!candidates.length || candidates.length > 5000 || new Set(candidates.map((c) => c.id)).size !== candidates.length)
    throw new Error("Lifecycle candidate count or duplicate id");
  return candidates.sort((a, b) => a.id.localeCompare(b.id));
}

// Round-robin over seeded Dice strata: sparse bins contribute everything they have.
export function samplePairs(candidates, { count = 200, seed = 7 } = {}) {
  if (!Number.isSafeInteger(count) || count < 0 || count > 10000 || !Number.isSafeInteger(seed))
    throw new Error("Lifecycle pairs arguments");
  if (!count) return [];
  const bins = Array.from({ length: 10 }, () => []),
    terms = candidates.map((c) => lexicalTerms(c.text));
  // Keep only count smallest hash priorities per bin; memory is bounded independently of the pair universe.
  for (let i = 0; i < candidates.length; i++)
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i],
        b = candidates[j];
      if (a.persona !== b.persona || a.project !== b.project) continue;
      const dice = lexicalDice(terms[i], terms[j]),
        bin = Math.min(9, Math.floor(dice * 10));
      const id = hash([a.id, b.id]),
        rank = hash([seed, id]),
        bucket = bins[bin];
      if (bucket.length === count && rank >= bucket[bucket.length - 1].rank) continue;
      bucket.push({ id, a: a.id, b: b.id, dice, bin, rank });
      bucket.sort((a, b) => a.rank.localeCompare(b.rank));
      if (bucket.length > count) bucket.pop();
    }
  const result = [];
  while (result.length < count) {
    let added = false;
    for (const bin of bins)
      if (bin.length && result.length < count) {
        const { rank, ...pair } = bin.shift();
        result.push(pair);
        added = true;
      }
    if (!added) throw new Error("Lifecycle insufficient duplicate pairs: supply more ledgers or lower --pairs for smoke only");
  }
  return result;
}

function kappa(a, b) {
  const n = a.length;
  if (!n) return { n: 0, kappa: null, errorRate: null, provisional: true };
  const observed = a.filter((v, i) => v === b[i]).length / n;
  const categories = new Set([...a, ...b]);
  let chance = 0;
  for (const v of categories) chance += (a.filter((x) => x === v).length * b.filter((x) => x === v).length) / n ** 2;
  const value = chance === 1 ? null : (observed - chance) / (1 - chance);
  return { n, kappa: value, errorRate: 1 - observed, provisional: value === null || value < 0.6 };
}
export function auditReport(rows, keys = fields) {
  const audited = rows.filter((r) => r.human && r.reason === "audit");
  const agreed = audited.map((r) => r.judges[0]);
  return {
    audited: audited.length,
    fields: Object.fromEntries(
      keys.map((key) => [
        key,
        kappa(
          agreed.map((l) => canonical(l[key])),
          audited.map((r) => canonical(r.human[key])),
        ),
      ]),
    ),
    errorRate: audited.length ? audited.filter((r) => !equal(r.human, r.judges[0])).length / audited.length : null,
  };
}

async function liveJudges(refs, maxInputTokens) {
  const { loadEnv, liveProviders, refOf } = await import("../run.mjs");
  const temp = await mkdtemp(join(tmpdir(), "prism-label-live-")),
    agents = new Map();
  let live;
  const account = () => replayUsage(live?.proxies ?? [], maxInputTokens);
  return {
    async generate(prompt, model) {
      if (!live) {
        loadEnv();
        live = await liveProviders(refs.map(refOf), temp, { beforeAttempt: account });
      }
      await account();
      if (!agents.has(model))
        agents.set(
          model,
          await createAgent({
            model: live.models.get(model),
            compaction: false,
            retry: false,
            packages: [providerPackage("memory-bench-label-judges", live.providers)],
            limits: { maxTurns: 1, maxInputTokens: null, maxTotalTokens: null, maxWallTimeMs: 600000 },
          }),
        );
      const session = await agents.get(model).session();
      try {
        const result = await session.run(prompt, { signal: AbortSignal.timeout(600000) });
        if (!["completed", "stopped"].includes(result.status)) throw new Error("Lifecycle judge completion");
        await account();
        return result.text;
      } finally {
        await session.close();
      }
    },
    async close() {
      try {
        for (const agent of agents.values()) await agent.dispose();
      } finally {
        for (const { proxy } of live?.proxies ?? []) proxy.stop();
        await rm(temp, { recursive: true, force: true });
      }
    },
  };
}

export async function labelLedgers({
  ledgers,
  out = `${CACHE}/labels`,
  judges = [],
  generate,
  offline = false,
  seed = 7,
  pairCount = 200,
  resolutions = [],
  maxInputTokens = 15000000,
} = {}) {
  if (typeof ledgers === "string") ledgers = await loadLedgers(ledgers);
  if (
    !Array.isArray(ledgers) ||
    !ledgers.length ||
    !Number.isSafeInteger(seed) ||
    !Number.isSafeInteger(maxInputTokens) ||
    maxInputTokens < 1
  )
    throw new Error("Lifecycle label arguments");
  const candidates = candidatesFrom(ledgers),
    byId = new Map(candidates.map((c) => [c.id, c]));
  const recorded = candidates.some((c) => !c.construction);
  if (recorded && offline) throw new Error("Lifecycle offline labels require synthetic ledgers");
  if (recorded && (judges.length !== 2 || !judges.some((j) => /^hyper\/.+/.test(j)) || !judges.some((j) => /^opencode-go\/.+/.test(j))))
    throw new Error("Lifecycle panel requires different providers: hyper and opencode-go");
  const pairs = samplePairs(candidates, { count: pairCount, seed });
  await mkdir(join(out, "cache"), { recursive: true, mode: 0o700 });
  // Re-scan even content-addressed ledgers: hashing alone does not prove secret-free input.
  const stage = await mkdtemp(join(out, ".scan-"));
  try {
    const path = join(stage, "input.json");
    await writeFile(path, JSON.stringify(candidates), { mode: 0o600 });
    await scanSecrets([path]);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
  const checkedLabel = (task, label, id) => {
    const valid = task === "pair" ? validatePair(label) : validateLabel(label);
    if (valid.duplicateOf && (!byId.has(valid.duplicateOf) || valid.duplicateOf === id)) throw new Error("Lifecycle duplicateOf reference");
    return valid;
  };
  const version = hash(prompts.lifecycle),
    dataset = hash([version, candidates.map((c) => [c.id, c.contentHash]), judges, pairs.map((p) => p.id), seed]);
  const resolutionPath = join(out, `${dataset}.resolutions.json`);
  const resolved = await readJson(resolutionPath, {});
  if (!Array.isArray(resolutions) || new Set(resolutions.map((r) => r.id)).size !== resolutions.length)
    throw new Error("Lifecycle resolution ids");
  const known = new Map([...candidates.map((c) => [c.id, "candidate"]), ...pairs.map((p) => [p.id, "pair"])]);
  for (const r of resolutions) {
    if (!r || Object.keys(r).some((k) => !["id", "label"].includes(k)) || !known.has(r.id)) throw new Error("Lifecycle unknown resolution");
    resolved[r.id] = checkedLabel(known.get(r.id), r.label, r.id);
  }
  let live,
    calls = 0;
  const votes = async (task, input) => {
    const validate = (label) => checkedLabel(task, label, input.id);
    const labels = [];
    for (const model of judges) {
      const key = hash([version, model, task, input]),
        path = join(out, "cache", `${key}.json`);
      const cached = await readJson(path, null);
      if (cached) {
        if (cached.key !== key || hash(cached.label) !== cached.hash) throw new Error("Lifecycle label cache integrity");
        labels.push(validate(cached.label));
      } else {
        if (!generate) live ??= await liveJudges(judges, maxInputTokens);
        const label = validate(await judgeLifecycle(task, input, (prompt) => (generate ?? live.generate)(prompt, model)));
        calls++;
        await publish(path, JSON.stringify({ key, label, hash: hash(label) }));
        labels.push(label);
      }
    }
    return labels;
  };
  const rows = [],
    pairRows = [];
  try {
    for (const c of candidates) {
      const panel = c.construction
        ? [c.construction, c.construction]
        : await votes("candidate", { id: c.id, text: c.text, source: c.source });
      for (const label of panel)
        if (label.duplicateOf && (!byId.has(label.duplicateOf) || label.duplicateOf === c.id))
          throw new Error("Lifecycle duplicateOf reference");
      rows.push({
        id: c.id,
        contentHash: c.contentHash,
        entryIds: c.entryIds,
        session: c.session,
        persona: c.persona,
        project: c.project,
        source: c.source,
        judges: panel,
        construction: !!c.construction,
      });
    }
    for (const pair of pairs) {
      const a = byId.get(pair.a),
        b = byId.get(pair.b);
      const construction = !!(a.construction && b.construction);
      const panel = construction
        ? Array(2).fill({
            sameNote:
              a.construction.shouldPromote &&
              b.construction.shouldPromote &&
              a.contentHash === b.contentHash &&
              a.construction.scope === b.construction.scope &&
              a.construction.kind === b.construction.kind,
          })
        : await votes("pair", { a: { id: a.id, text: a.text }, b: { id: b.id, text: b.text } });
      pairRows.push({ ...pair, judges: panel, construction });
    }
  } finally {
    await live?.close();
  }
  const finish = (items, task) => {
    const agreed = items
      .filter((r) => !r.construction && equal(...r.judges))
      .sort((a, b) => hash([seed, a.id]).localeCompare(hash([seed, b.id])));
    const audits = new Set(agreed.slice(0, Math.ceil(agreed.length * 0.1)).map((r) => r.id));
    return items.map((row) => {
      const agreement = equal(...row.judges),
        reason = !agreement ? "disagreement" : audits.has(row.id) ? "audit" : undefined;
      if (resolved[row.id] && !reason) throw new Error("Lifecycle resolution is not queued");
      const human = resolved[row.id];
      return {
        ...row,
        task,
        ...(reason ? { reason } : {}),
        ...(human ? { human } : {}),
        label: human ?? (agreement ? row.judges[0] : null),
      };
    });
  };
  const final = finish(rows, "candidate"),
    finalPairs = finish(pairRows, "pair");
  const queue = [...final, ...finalPairs].filter((r) => r.reason && !r.human).map(({ label, ...row }) => row);
  const labels = final.filter((r) => r.label).map(({ judges, human, reason, task, ...row }) => row);
  const duplicates = finalPairs
    .filter((r) => r.label)
    .map(({ id, a, b, dice, bin, label, construction }) => ({ id, a, b, dice, bin, ...label, construction }));
  const report = {
    version: prompts.lifecycle.version,
    dataset,
    seed,
    judges,
    candidates: candidates.length,
    labels: labels.length,
    pairs: duplicates.length,
    pairTarget: pairCount,
    pending: queue.length,
    status: queue.length ? "pending-human" : "complete",
    ...auditReport(final),
    duplicateAudit: auditReport(finalPairs, ["sameNote"]),
    provenance: recorded ? "judge-panel" : "synthetic-construction",
    provisional: true,
    agreement: {
      candidates: final.filter((r) => !r.construction && equal(...r.judges)).length,
      pairs: finalPairs.filter((r) => !r.construction && equal(...r.judges)).length,
    },
    humanResolutions: Object.keys(resolved).length,
    auditTarget: [...final, ...finalPairs].filter((r) => r.reason === "audit").length,
  };
  // Unfinished or uninformative audits cannot validate recorded gold labels.
  report.provisional =
    recorded &&
    (queue.length > 0 ||
      Object.values(report.fields).some((f) => f.provisional) ||
      Object.values(report.duplicateAudit.fields).some((f) => f.provisional));
  await publish(resolutionPath, JSON.stringify(resolved));
  for (const [name, value] of [
    ["labels.jsonl", jsonl(labels)],
    ["queue.jsonl", jsonl(queue)],
    ["duplicates.jsonl", jsonl(duplicates)],
    ["report.json", `${JSON.stringify(report, null, 2)}\n`],
  ])
    await publish(join(out, name), value);
  return { labels, pairs: duplicates, queue, report, calls };
}

export function labelEvidence(report) {
  const metric = (value) => (value === null ? "pending/undefined" : String(value));
  return [
    "# Memory lifecycle label evidence",
    "",
    `Dataset hash: ${report.dataset}. Seed: ${report.seed}. Provenance: ${report.provenance}.`,
    "",
    `Candidates: ${report.candidates}; accepted labels: ${report.labels}; duplicate pairs: ${report.pairs}/${report.pairTarget}; pending human items: ${report.pending}.`,
    `Random agreed-label audits completed: ${report.audited}; audit error rate: ${metric(report.errorRate)}. Provisional: ${report.provisional}.`,
    "",
    "| Field | Audited n | Cohen's κ | Error rate | Provisional |",
    "| --- | ---: | ---: | ---: | --- |",
    ...Object.entries(report.fields).map(
      ([field, f]) => `| ${field} | ${f.n} | ${metric(f.kappa)} | ${metric(f.errorRate)} | ${f.provisional} |`,
    ),
    ...Object.entries(report.duplicateAudit.fields).map(
      ([field, f]) => `| pair.${field} | ${f.n} | ${metric(f.kappa)} | ${metric(f.errorRate)} | ${f.provisional} |`,
    ),
    "",
    "κ uses only the seeded random audit of agreed labels; both judges made the same prediction on those items. Disagreement resolutions are excluded to avoid selection bias. Constant agreement has undefined κ and remains provisional. Synthetic construction is not a human audit or live-provider validation.",
    "",
    "Duplicate pairs are stratified over available Dice bins within persona/project; this sample is not population-weighted. No cosine calibration, live benchmark comparison, or defaults verdict follows from this report.",
    "",
  ].join("\n");
}

if (import.meta.main) {
  try {
    const options = args({
      ledgers: "string",
      judges: "string",
      out: "string",
      seed: "string",
      pairs: "string",
      resolve: "string",
      inspect: "string",
      offline: "boolean",
      evidence: "string",
      "max-input-tokens": "string",
    });
    if (options.inspect) {
      const candidates = candidatesFrom(await loadLedgers(options.ledgers));
      const pair = samplePairs(candidates, { count: Number(options.pairs ?? 200), seed: Number(options.seed ?? 7) }).find(
        (p) => p.id === options.inspect,
      );
      const selected = candidates.filter((c) => c.id === options.inspect || c.id === pair?.a || c.id === pair?.b);
      if (!selected.length) throw new Error("Lifecycle inspection id");
      console.log(
        JSON.stringify(
          selected.map(({ id, text, source }) => ({ id, text, source })),
          null,
          2,
        ),
      );
    } else {
      const resolutions = options.resolve
        ? (await readFile(options.resolve, "utf8"))
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line))
        : [];
      const result = await labelLedgers({
        ledgers: options.ledgers,
        judges: options.judges?.split(",") ?? [],
        out: options.out,
        seed: Number(options.seed ?? 7),
        pairCount: Number(options.pairs ?? 200),
        offline: options.offline,
        resolutions,
        maxInputTokens: Number(options["max-input-tokens"] ?? 15000000),
      });
      if (options.evidence) await publish(options.evidence, labelEvidence(result.report));
      console.log(JSON.stringify(result.report, null, 2));
    }
  } catch {
    console.error("Lifecycle labelling failed: check consent/redaction, panel providers, labels, resolutions, cache and token ceiling");
    process.exitCode = 1;
  }
}
