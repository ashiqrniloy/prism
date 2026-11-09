#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { providerDone, providerToolCall, toolCallContent, validateJsonSchema } from "@arnilo/prism";
import { createHashEmbedder, createMemoryVectorStore, MemoryValidationError } from "@arnilo/prism-memory-core";
import { createMemory, createLongTermMemory, memoryFabricConfigSchema, parseMemoryNoteMetadata, resolveMemoryFabricConfig } from "@arnilo/prism-memory-system";
import { createScopeClock } from "../../../packages/memory/system/src/ltm/lifecycle/clock.ts";
import { isMemoryNoteValidAt } from "../../../packages/memory/system/src/ltm/types.ts";
import { foldObservationalMemoryLedger } from "@arnilo/prism-memory-system";
import { parseVariantSpecs } from "../variants.mjs";
import { args, CACHE, hash, loadLedgers, validateLedger } from "./io.mjs";

const PROMPT_VERSION = "consolidation-cache-v1";

// The mock interprets fixture text only; it never receives gold labels or probes.
export function mockExtraction(input) {
  return {
    notes: input.candidates.flatMap((candidate) => {
      const text = candidate.text.replace(/^(?:Remember |Actually, )/, "");
      const match = /^(Preference|Fact|Decision|Path|Lesson|Temporary) ([a-z0-9.-]+): (.+)$/.exec(text);
      if (!match) return [];
      const [, tag, key] = match;
      const scope = tag === "Preference" ? "user" : tag === "Path" ? "path" : "project";
      const kind = tag === "Preference" ? "preference" : ["Path", "Lesson"].includes(tag) ? "procedure" : "fact";
      const same = input.existing.find((note) => note.scope === scope && note.text === text);
      if (same) return [];
      const previous = input.existing.find((note) => note.scope === scope && note.text.startsWith(`${tag} ${key}:`));
      return [
        {
          text,
          kind,
          scope,
          key,
          keywords: [key],
          aliases: [],
          evidence: [candidate.id],
          explicit: candidate.signals.explicit === 1,
          correction: candidate.signals.correction === 1,
          generality: 1,
          ephemerality: tag === "Temporary" ? 1 : 0,
          derivable: false,
          ...(scope === "path" ? { applies_to: ["src/**"] } : {}),
          ...(previous ? { contradicts: previous.id } : {}),
        },
      ];
    }),
  };
}

function replace(value, ids, key) {
  if (typeof value === "string") return ids.get(value) ?? value;
  if (Array.isArray(value)) {
    const items = value.map((v) => replace(v, ids));
    return key === "enum" ? items.sort() : items;
  }
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replace(v, ids, k)]));
  return value;
}
function cachedClient({ modelId, client, offline, cache, calls, onModelCall }) {
  return {
    model: client?.model ?? { provider: "mock", model: "lifecycle" },
    async *generate(request) {
      const input = JSON.parse(request.messages[1].content[0].text);
      // Fabric note ids are random; canonical placeholders make identical replays share a cache.
      const existing = [...input.existing].sort((a, b) => `${a.scope}/${a.text}`.localeCompare(`${b.scope}/${b.text}`));
      const ids = new Map(existing.map((note, i) => [note.id, `existing-${i}`]));
      const reverse = new Map([...ids].map(([a, b]) => [b, a]));
      const canonical = replace({ ...input, existing }, ids);
      const key = hash([modelId, PROMPT_VERSION, request.messages[0], canonical, replace(request.tools, ids)]);
      const path = join(cache, `${key}.json`);
      if (process.env.DBG) {
        const parts = Object.fromEntries(Object.entries(canonical).map(([k, v]) => [k, hash(v).slice(0, 8)]));
        console.error("REQ", key.slice(0, 8), JSON.stringify(parts));
      }
      let events;
      try {
        const cached = JSON.parse(await readFile(path, "utf8"));
        if (cached.key !== key || hash(cached.events) !== cached.hash || !Array.isArray(cached.events))
          throw new Error("LifecycleCacheIntegrity");
        events = replace(cached.events, reverse);
        calls.cacheHits++;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        if (!offline && !client) throw new Error("Lifecycle cache miss requires a model client or --offline");
        onModelCall?.();
        calls.extractor++;
        events = [];
        if (offline) events = [providerToolCall(toolCallContent("extraction", "record_notes", mockExtraction(input))), providerDone()];
        else for await (const event of client.generate(request)) events.push(event);
        const normalized = replace(events, ids);
        await mkdir(cache, { recursive: true, mode: 0o700 });
        await writeFile(path, JSON.stringify({ key, events: normalized, hash: hash(normalized) }), { mode: 0o600 });
      }
      for (const event of events) yield event;
    },
  };
}
export async function replayUsage(proxies, ceiling) {
  let inputTokens = 0;
  for (const { proxy, usageLog } of proxies) {
    await proxy.drain();
    if (!existsSync(usageLog)) continue;
    const rows = (await readFile(usageLog, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    if (
      rows.some(
        (row) =>
          !Number.isSafeInteger(row.inputTokens) ||
          row.inputTokens < 0 ||
          (row.status >= 200 &&
            row.status < 300 &&
            (!row.rawUsage || !("input_tokens" in row.rawUsage || "prompt_tokens" in row.rawUsage))),
      )
    )
      throw new Error("MemoryBenchUsageMissing");
    inputTokens += rows.reduce((n, row) => n + row.inputTokens, 0);
  }
  if (inputTokens >= ceiling) throw new Error("LifecycleTokenCeiling");
  return inputTokens;
}

// Resolve credentials and open the existing wire-accounted providers only on a cache miss.
async function replayWithLive(options, modelRef) {
  const { loadEnv, liveProviders, refOf } = await import("../run.mjs");
  const ref = refOf(modelRef);
  const ceiling = options.maxInputTokens ?? 15000000;
  if (!Number.isSafeInteger(ceiling) || ceiling < 1) throw new Error("LifecycleTokenCeiling");
  const temp = await mkdtemp(join(tmpdir(), "prism-lifecycle-live-"));
  let live;
  const account = () => replayUsage(live?.proxies ?? [], ceiling);
  const client = {
    model: ref,
    async *generate(request) {
      if (!live) {
        loadEnv();
        live = await liveProviders([ref], temp, { beforeAttempt: account });
      }
      const provider = live.providers.find((provider) => provider.id === ref.provider);
      yield* provider.generate({ ...request, model: live.models.get(modelRef) });
    },
  };
  try {
    const report = await replayLedgers({ ...options, client, modelId: modelRef });
    report.inputTokens = await account();
    return report;
  } finally {
    for (const { proxy } of live?.proxies ?? []) proxy.stop();
    await rm(temp, { recursive: true, force: true });
  }
}
const ratio = (n, d) => (d ? n / d : null);
const active = (record) =>
  ["candidate", "verified"].includes(record.metadata?.status ?? "verified") &&
  isMemoryNoteValidAt(parseMemoryNoteMetadata(record.metadata), Date.now());

export async function replayLedgers({
  ledgers,
  policy = {},
  offline = false,
  cache = `${CACHE}/extractor`,
  client,
  modelId,
  onModelCall,
  graveyardK = 3,
  maxInputTokens,
  variants = JSON.parse(process.env.PRISM_MEMORY_BENCH_VARIANTS ?? "[]"),
} = {}) {
  const replayVariants = new Set([
    "lifecycle.scope=flat",
    "lifecycle.scope=hierarchical",
    "lifecycle.verification=retrieval",
    "lifecycle.verification=use",
    "lifecycle.promotion=every-reflection",
    "lifecycle.promotion=gated",
  ]);
  if (!Array.isArray(variants) || variants.some((spec) => typeof spec !== "string")) throw new Error("LifecycleReplayVariants");
  const seenVariants = new Set();
  for (const spec of variants) {
    const path = spec.split("=")[0];
    if (seenVariants.has(path)) throw new Error("LifecycleReplayVariants: conflicting setting");
    seenVariants.add(path);
    if (!replayVariants.has(spec)) parseVariantSpecs([spec]);
  }
  const flat = variants.includes("lifecycle.scope=flat");
  const retrievalVerification = variants.includes("lifecycle.verification=retrieval");
  const everyReflection = variants.includes("lifecycle.promotion=every-reflection");
  if (typeof ledgers === "string") ledgers = await loadLedgers(ledgers);
  if (!Array.isArray(ledgers) || !ledgers.length || !Number.isSafeInteger(graveyardK) || graveyardK < 1)
    throw new Error("LifecycleReplayArguments");
  ledgers.forEach(validateLedger);
  if (new Set(ledgers.map((l) => l.manifest.session)).size !== ledgers.length) throw new Error("LifecycleDuplicateSession");
  if (!validateJsonSchema(memoryFabricConfigSchema, policy).ok)
    throw new MemoryValidationError("Lifecycle policy setting is not allowed or invalid");
  const config = resolveMemoryFabricConfig(policy);
  if (!offline && !client && config.promote.model)
    return replayWithLive({ ledgers, policy, cache, onModelCall, graveyardK, maxInputTokens, variants }, config.promote.model);
  const ordered = [...ledgers].sort(
    (a, b) => Date.parse(a.manifest.order) - Date.parse(b.manifest.order) || a.manifest.session.localeCompare(b.manifest.session),
  );
  const calls = { extractor: 0, cacheHits: 0 };
  const extractor = cachedClient({
    modelId: modelId ?? (offline ? "mock/lifecycle-v1" : client ? `${client.model.provider}/${client.model.model}` : "mock/lifecycle-v1"),
    client,
    offline,
    cache,
    calls,
    onModelCall,
  });
  const store = createMemoryVectorStore(),
    memories = new Map(),
    clocks = new Map();
  function memoryFor(persona, resourceId) {
    const id = `${persona}/${resourceId}`;
    if (!memories.has(id))
      memories.set(
        id,
        createMemory({
          tenantId: persona,
          resourceId,
          threadId: "replay",
          vectorStore: store,
          ...(config.retrieval === "hybrid" ? { embedder: createHashEmbedder({ dimensions: 64 }) } : {}),
        }),
      );
    return memories.get(id);
  }
  async function snapshot() {
    const records = [];
    for (const memory of memories.values()) {
      let cursor;
      do {
        const page = await store.listByThread({ ...memory.scope, cursor, limit: 500 });
        records.push(...page.records);
        cursor = page.nextCursor;
      } while (cursor);
    }
    return records;
  }
  const labels = ordered.flatMap(({ manifest: m }) =>
    (m.labels ?? []).map((label) => ({ ...label, persona: m.persona, project: m.project })),
  );
  const labelById = new Map(labels.map((label) => [label.id, label]));
  const target = (label) => `${label.persona}/${label.scope === "user" ? "user" : label.project}/${label.contentHash ?? label.id}`;
  const eligible = (record, label) =>
    record.tenantId === label.persona &&
    (flat
      ? record.resourceId === "flat"
      : label.scope === "user"
        ? record.resourceId === "user"
        : record.resourceId === `projects/${label.project}--${hash(label.project).slice(0, 8)}` ||
          (label.scope === "agent" && record.resourceId === "agents/replay"));
  const corresponds = (record, label) => {
    if (record.tenantId !== label.persona) return false;
    const meta = parseMemoryNoteMetadata(record.metadata);
    return (
      hash(record.text) === label.contentHash ||
      (meta?.key === label.key && (meta?.sourceEntryIds ?? []).some((id) => label.entryIds.includes(id)))
    );
  };
  const matches = (record, label) => eligible(record, label) && corresponds(record, label);
  const history = new Map(),
    archived = new Map(),
    regretted = new Set(),
    growth = [];
  const observe = (records, index) => {
    for (const record of records) {
      const version = `${record.id}/${hash(record.text)}`;
      history.set(version, record);
      if (record.metadata?.status === "archived" && !archived.has(version)) archived.set(version, { record, index });
    }
  };
  const passes = [];
  let uses = 0,
    verified = 0;
  const previousTime = process.env.PRISM_MEMORY_BENCH_TIME_MS;
  try {
    for (let index = 0; index < ordered.length; index++) {
      const { manifest: m, entries } = ordered[index];
      process.env.PRISM_MEMORY_BENCH_TIME_MS = String(Date.parse(m.order));
      const projectId = flat ? "flat" : `projects/${m.project}--${hash(m.project).slice(0, 8)}`;
      const scopes = flat
        ? [{ level: "project", memory: memoryFor(m.persona, "flat") }]
        : [
            { level: "project", memory: memoryFor(m.persona, projectId) },
            { level: "agent", memory: memoryFor(m.persona, "agents/replay") },
            { level: "user", memory: memoryFor(m.persona, "user") },
          ];
      const clock = createScopeClock(store.scopeCounter, m.persona);
      const tick = await clock.tick(
        [],
        scopes.map((s) => s.memory.scope.resourceId),
      );
      for (const [resource, ordinal] of Object.entries(tick.clocks)) clocks.set(`${m.persona}/${resource}`, ordinal);
      const fabric = createLongTermMemory({
        memory: scopes[0].memory,
        ...(!flat ? { scopes } : {}),
        vectorStore: store,
        ...(everyReflection ? { observational: { session: { entries: async () => entries } } } : {}),
        promote: config.promote,
        consolidate: config.consolidate,
        lifecycle: config.lifecycle,
        retrieval: config.retrieval,
        clock: () => tick.clocks[projectId],
        resolveModelClient: () => extractor,
        promoteRoot: join(cache, "empty-workspace"),
        openScope: ({ resourceId }) => memoryFor(m.persona, flat ? "flat" : resourceId),
      });
      // Probes precede this session's learning, so a repeated fact cannot earn a use by leaking ahead.
      observe(await snapshot(), index);
      for (const probe of m.probes ?? []) {
        const label = labelById.get(probe.labelId);
        if (!label) throw new Error("LifecycleProbeLabelMissing");
        const recalled = await fabric.recall(probe.query, { minSimilarity: 0, kinds: ["all"], touchedPaths: probe.touchedPaths, topK: 20 });
        const records = await snapshot();
        // Retiring redundant project copies is not regret when a recalled active wider copy supplies the fact.
        const activeAnswer = recalled.hits.some((hit) =>
          records.some((record) => record.id === hit.id && active(record) && matches(record, label)),
        );
        if (!activeAnswer)
          for (const [version, item] of archived) if (item.index < index && matches(item.record, label)) regretted.add(version);
        for (const scope of scopes) {
          const ids = recalled.hits
            .filter((hit) =>
              records.some(
                (record) =>
                  record.id === hit.id &&
                  record.tenantId === m.persona &&
                  record.resourceId === scope.memory.scope.resourceId &&
                  (retrievalVerification || matches(record, label)),
              ),
            )
            .map((hit) => hit.id);
          uses += ids.length;
          const confirmed = await fabric.recordUses(m.session, ids, {
            clock: tick.clocks[scope.memory.scope.resourceId],
            verifyAfterSessions: config.lifecycle.verifyAfterSessions,
            now: Date.parse(m.order),
          });
          verified += confirmed.length;
        }
      }
      let historicalReflections;
      let result;
      if (everyReflection) {
        const reflections = foldObservationalMemoryLedger(entries).reflections;
        for (const reflection of reflections) await fabric.remember({ kind: "fact", reflectionId: reflection.id });
        historicalReflections = reflections.length;
        result = { reason: "historical-every-reflection" };
      } else result = await fabric.consolidate({ id: m.session, entries: async () => entries });
      passes.push({
        session: hash(m.session),
        ...(historicalReflections === undefined ? {} : { historicalReflections }),
        // A failed extraction is reported, never thrown (plan 188.10 Task 5): the reason stays visible.
        ...(result.reasonCode === undefined ? {} : { reasonCode: result.reasonCode }),
        ...(result.report
          ? {
              candidates: result.report.candidates,
              extracted: result.report.extracted,
              accepted: result.report.accepted,
              rejected: result.report.rejected,
            }
          : { reason: result.reason }),
      });
      passes.at(-1).maintenance = await fabric.maintain();
      const records = await snapshot();
      observe(records, index);
      for (const scope of scopes) {
        const rows = records.filter(
          (record) => record.tenantId === m.persona && record.resourceId === scope.memory.scope.resourceId && active(record),
        );
        growth.push({
          scope: hash(`${m.persona}/${scope.memory.scope.resourceId}`),
          ordinal: tick.clocks[scope.memory.scope.resourceId],
          notes: rows.length,
          tokens: rows.reduce((sum, record) => sum + Math.ceil(record.text.length / 4), 0),
        });
      }
    }
  } finally {
    if (previousTime === undefined) delete process.env.PRISM_MEMORY_BENCH_TIME_MS;
    else process.env.PRISM_MEMORY_BENCH_TIME_MS = previousTime;
  }
  const records = await snapshot(),
    live = records.filter(active);
  const promoted = [...history.values()];
  const positive = new Set(labels.filter((label) => label.shouldPromote).map(target));
  const found = new Set(labels.filter((label) => label.shouldPromote && promoted.some((record) => matches(record, label))).map(target));
  const correct = promoted.filter((record) => labels.some((label) => label.shouldPromote && matches(record, label)));
  const scored = promoted.flatMap((record) => {
    const label = labels.find((l) => corresponds(record, l));
    return label ? [{ record, label, meta: parseMemoryNoteMetadata(record.metadata) }] : [];
  });
  const bySource = Object.fromEntries(
    ["explicit", "correction", "decision", "observation", "reflection", "tool"].map((source) => {
      const gold = labels.filter((label) => label.source === source);
      const predictions = promoted.filter((record) => gold.some((label) => corresponds(record, label)));
      const expected = new Set(gold.filter((label) => label.shouldPromote).map(target));
      const recalled = new Set(
        gold.filter((label) => label.shouldPromote && predictions.some((record) => matches(record, label))).map(target),
      );
      return [
        source,
        {
          promotionPrecision: ratio(
            predictions.filter((record) => gold.some((label) => label.shouldPromote && matches(record, label))).length,
            predictions.length,
          ),
          promotionRecall: ratio(recalled.size, expected.size),
        },
      ];
    }),
  );
  const unique = new Set(live.map((record) => `${record.tenantId}/${record.resourceId}/${hash(record.text)}`));
  const unused = live.filter((record) => {
    const meta = parseMemoryNoteMetadata(record.metadata);
    const ordinal = clocks.get(`${record.tenantId}/${record.resourceId}`) ?? 0;
    return !(meta?.uses ?? []).some((use) => ordinal - use.s < graveyardK);
  });
  return {
    suite: "lifecycle-replay",
    status: "completed",
    policyHash: hash(policy),
    variants,
    limitations: [
      ...(flat
        ? [
            "Flat scope shares one resource per persona across projects; tenant isolation is retained, while project boundaries intentionally disappear.",
          ]
        : []),
      ...(retrievalVerification
        ? ["Every retrieved note earns a recorded use; use verification instead records only gold-matching probe notes."]
        : []),
      ...(everyReflection
        ? [
            "Historical promotion copies each recorded reflection as a fact through the reflection-backed write path; other candidate sources and extraction are bypassed.",
          ]
        : []),
    ],
    ledgerHashes: ordered.map((l) => hash(l)),
    calls,
    counts: {
      sessions: ordered.length,
      uses,
      verified,
      promoted: promoted.length,
      archived: archived.size,
      active: live.length,
      labelledTargets: positive.size,
    },
    passes,
    metrics: {
      promotionPrecision: labels.length ? ratio(correct.length, promoted.length) : null,
      promotionRecall: ratio(found.size, positive.size),
      scopeAccuracy: ratio(scored.filter(({ meta, label }) => meta?.scope === label.scope).length, scored.length),
      typeAccuracy: ratio(scored.filter(({ meta, label }) => meta?.kind === label.kind).length, scored.length),
      duplicateRate: ratio(live.length - unique.size, live.length),
      archiveRegret: ratio(regretted.size, archived.size),
      graveyardIndex: ratio(unused.length, live.length),
      graveyardK,
      bySource,
      activeSetGrowth: growth,
    },
  };
}
if (import.meta.main) {
  try {
    const options = args({
      ledgers: "string",
      policy: "string",
      offline: "boolean",
      cache: "string",
      output: "string",
      "max-input-tokens": "string",
    });
    if (!options.ledgers || !options.policy) throw new Error("LifecycleReplayArguments");
    const report = await replayLedgers({
      ...options,
      maxInputTokens: options["max-input-tokens"] === undefined ? undefined : Number(options["max-input-tokens"]),
      policy: JSON.parse(await readFile(options.policy, "utf8")),
    });
    const text = JSON.stringify(report, null, 2) + "\n";
    if (options.output) await writeFile(options.output, text);
    else console.log(text);
  } catch {
    console.error("Lifecycle replay failed: check ledgers, policy and extractor cache; use --offline to populate mock extractions");
    process.exitCode = 1;
  }
}
