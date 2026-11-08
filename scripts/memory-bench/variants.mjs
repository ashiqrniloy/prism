/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: Literal TypeScript source patterns must not interpolate. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const om = "packages/memory/observational/src/";
const fabric = "packages/memory/fabric/src/";
const signals = ["explicit", "correction", "outcome", "recurrence", "generality", "ephemerality", "derivability"];
// Process-local historical experiments. Package files and public config stay unchanged.
export const VARIANT_PATHS = {
  "fabric.stem=off": ["packages/memory/core/src/lexical.ts"],
  "fabric.multiQuery=off": [`${fabric}tools.ts`],
  ...Object.fromEntries([600, 1200, 2400].map((budget) => [`fabric.snippetBudget=${budget}`, [`${fabric}tools.ts`]])),
  // 188.8's passive delivery rule (whole notes, 600 tokens, top 3, similarity 0.35) so the held-out
  // baseline reproduces 188.8 post-fix instead of the 4000/12/0.2 delivery 188.9 Task 5 shipped.
  "fabric.delivery=188.8": [`${fabric}config.ts`, `${fabric}context.ts`],
  "fabric.keyWeight=off": ["packages/memory/core/src/sqlite/index.ts"],
  "om.dates=off": [`${om}serialize.ts`, `${om}render.ts`, `${om}workers/reflector.ts`],
  "om.taskState=off": [`${om}workers/observer.ts`, `${om}render.ts`],
  "om.replaceOnReflect=off": [`${om}flush.ts`],
  "fabric.crossSourceDedup=off": [`${fabric}context.ts`],
  "lifecycle.verification=retrieval": [`${fabric}context.ts`],
  "lifecycle.promotion=every-reflection": [`${fabric}create.ts`],
  "lifecycle.capacity=off": [`${fabric}lifecycle/maintain.ts`],
  "lifecycle.merge=off": [`${fabric}lifecycle/maintain.ts`],
  "lifecycle.clock=calendar": [`${fabric}lifecycle/clock.ts`, `${fabric}lifecycle/maintain.ts`, `${fabric}index.ts`],
  "lifecycle.decayMode=exponential": [`${fabric}lifecycle/strength.ts`],
  ...Object.fromEntries(signals.map((name) => [`promote.signal.${name}=off`, [`${fabric}consolidation/score.ts`]])),
  // Plan 210 Task 5: test-only switches for the candidates that have no config field (never a product field).
  "fabric.unmatchedTerms=off": [`${fabric}tools.ts`],
  "fabric.navigation=off": [`${fabric}tools.ts`],
  "fabric.grouping=off": [`${fabric}recall.ts`],
  "fabric.aggregation=off": [`${fabric}tools.ts`],
  // Plan 216 Task 3: the passive concept pointer moved into the wiki's own context block.
  "ontology.pointer=off": ["packages/knowledge/wiki/src/context.ts"],
  "om.reflector=off": [`${om}flush.ts`],
  "lifecycle.exchangeExempt=on": [`${fabric}lifecycle/maintain.ts`],
};

/** Plan 210 Task 5: the switches that change what the write side stores (a snapshot keyed by config must include them). */
// Plan 210 Task 7 removed the two write-side switches (keyword enrichment, the timeline) with the features they ablated.
export const WRITE_SIDE_VARIANTS = Object.freeze([]);

export function parseVariantSpecs(value = []) {
  if (!Array.isArray(value)) throw new Error("MemoryBenchVariant: expected array");
  const seen = new Set();
  return value.map((spec) => {
    if (typeof spec !== "string") throw new Error("MemoryBenchVariant: expected path=value");
    const [path, setting, extra] = spec.split("=");
    if (extra !== undefined || seen.has(path)) throw new Error("MemoryBenchVariant: conflicting setting");
    seen.add(path);
    const target = Object.keys(VARIANT_PATHS).find((key) => key.split("=")[0] === path);
    if (
      !target ||
      ![
        ...Object.keys(VARIANT_PATHS)
          .filter((key) => key.split("=")[0] === path)
          .map((key) => key.split("=")[1]),
        "on",
        "default",
        ...(path === "lifecycle.decayMode" ? ["power-law"] : []),
        ...(path === "lifecycle.clock" ? ["scope-session"] : []),
        ...(path === "lifecycle.verification" ? ["use"] : []),
        ...(path === "lifecycle.promotion" ? ["gated"] : []),
      ].includes(setting)
    )
      throw new Error("MemoryBenchVariant: unsupported setting");
    return spec;
  });
}

function replaceOne(source, before, after, path) {
  if (source.split(before).length !== 2) throw new Error(`MemoryBenchVariant source drift: ${path}`);
  return source.replace(before, after);
}

export function transformVariantSource(path, source, input = []) {
  path = path.startsWith(root) ? relative(root, path) : path;
  const specs = parseVariantSpecs(input);
  const replace = (before, after) => {
    source = replaceOne(source, before, after, path);
  };
  const active = (spec) => specs.includes(spec) && VARIANT_PATHS[spec].includes(path);
  if (active("fabric.stem=off")) replace("terms.add(stemLexical(raw));", "terms.add(raw);");
  if (active("fabric.multiQuery=off")) {
    replace(
      "Pass `query`, or `queries` with up to 4 phrasings (synonyms, aliases) fused into one ranked list.",
      "Pass one `query` string.",
    );
    replace(
      `            queries: {
              type: "array",
              items: { type: "string" },
              minItems: 1,
              maxItems: 4,
              description: "Up to 4 phrasings, fused by rank; use it to try synonyms in one call.",
            },
`,
      "",
    );
    replace(
      "const list = Array.isArray(args.queries) ? args.queries : args.queries === undefined ? [] : undefined;",
      'if (args.queries !== undefined) throw new MemoryValidationError("multi-query is disabled in this benchmark arm");\n  const list: string[] = [];',
    );
  }
  for (const budget of [600, 1200, 2400]) {
    if (active(`fabric.snippetBudget=${budget}`)) {
      replace(
        'const budget = typeof args.budget === "number" ? args.budget : gather ? GATHER_BUDGET_TOKENS : 1200;',
        `const budget = typeof args.budget === "number" ? args.budget : gather ? GATHER_BUDGET_TOKENS : ${budget};`,
      );
      replace(
        "Ceiling on the summed tokens of the rendered snippet lines; default 1200.",
        `Ceiling on the summed tokens of the rendered snippet lines; default ${budget}.`,
      );
    }
  }
  if (active("fabric.delivery=188.8")) {
    if (path === `${fabric}config.ts`) {
      replace(
        'minSimilarity: { type: "number", minimum: -1, maximum: 1, default: 0.2 },',
        'minSimilarity: { type: "number", minimum: -1, maximum: 1, default: 0.35 },',
      );
      replace(
        'topK: { type: "integer", minimum: 1, maximum: HARD_TOP_K_CAP, default: 12 },',
        'topK: { type: "integer", minimum: 1, maximum: HARD_TOP_K_CAP, default: 3 },',
      );
      replace(
        'budgetTokens: { type: "integer", minimum: 1, default: 4000 },',
        'budgetTokens: { type: "integer", minimum: 1, default: 600 },',
      );
    } else {
      replace("minSimilarity: inject.minSimilarity ?? 0.2,", "minSimilarity: inject.minSimilarity ?? 0.35,");
      replace("inject.budgetTokens ?? 4000,", "inject.budgetTokens ?? 600,");
      replace("inject.topK ?? 12,", "inject.topK ?? 3,");
      replace(
        `          const { hits, lines: semanticLines } = fitInjection(
            eligible,
            lexicalTerms(query),
            inject.budgetTokens ?? 600,
            inject.topK ?? 3,
            eligible.length,
            inject.minScore,
            fullTextScore,
            inject.cardExcerpt,
          );`,
        `          const hits: MemoryNoteHit[] = [];
          const semanticLines: string[] = ["Cite the ids you use as [id]."];
          let tokens = Math.ceil(semanticLines[0]!.length / 4);
          for (const hit of eligible) {
            const line = \`- [\${hit.id}] \${hit.level ?? "project"} \${hit.kind} (\${hit.ingestedAt.slice(0, 10)})\${hit.tRef ? \` tRef=\${hit.tRef}\` : ""} \${hit.content}\`;
            const cost = Math.ceil(line.length / 4);
            if (tokens + cost > (inject.budgetTokens ?? 600) && hits.length > 0) continue;
            hits.push(hit);
            semanticLines.push(line);
            tokens += cost;
            if (hits.length >= (inject.topK ?? 3)) break;
          }`,
      );
    }
  }
  if (active("fabric.keyWeight=off")) replace("-bm25(semantic_memory_fts, 1.0, 3.0)", "-bm25(semantic_memory_fts, 1.0, 1.0)");
  if (active("om.dates=off")) {
    if (path === `${om}serialize.ts`) {
      replace("`[${entry.timestamp}] [${entry.id}] ${entry.kind}: ${text}`", "`[${entry.id}] ${entry.kind}: ${text}`");
      replace("if (elapsed >= 600_000) {", "if (false && elapsed >= 600_000) {");
    } else if (path === `${om}render.ts`) {
      replace('${item.observedFrom && item.observedTo ? `(${item.observedFrom} – ${item.observedTo}) ` : ""}', "");
      replace(
        "if (date.slice(0, 10) !== previousDate) lines.push(`### ${date.slice(0, 10)}`);",
        "if (false) lines.push(`### ${date.slice(0, 10)}`);",
      );
      replace("${date.slice(11, 16)} (${item.relevance})", "(${item.relevance})");
      replace('${item.referencedAt ? ` (refers to ${item.referencedAt})` : ""}', "");
    } else replace("${item.observedAt ?? item.timestamp} ${item.content}", "${item.content}");
  }
  if (active("om.taskState=off")) {
    if (path === `${om}render.ts`) replace("const task = options.taskState;", "const task = undefined;");
    else {
      replace("options.onRecord?.({ type: TASK_STATE_RECORDED, taskState });", "void taskState;");
      replace('...(options.taskState ? ["Current task state:", JSON.stringify(options.taskState)] : []),', "...[],");
      replace("tools: [tool, taskTool],", "tools: [tool],");
    }
  }
  if (active("om.replaceOnReflect=off")) {
    replace("consumedObservationIds: uncovered.map((item) => item.id),", "");
    replace("supersededReflectionIds: activeReflections(afterObservations).map((item) => item.id),", "");
  }
  if (active("fabric.crossSourceDedup=off")) replace("const duplicate = visibleMemory(draft, entries);", "const duplicate = () => false;");
  if (active("lifecycle.verification=retrieval")) replace("return state ? [...state.cited] : [];", "return state ? [...state.shown] : [];");
  if (active("lifecycle.promotion=every-reflection")) {
    // The current source already imports the trust scan (from memory-core since plan 216 Task 3); only historical
    // sources need the line.
    if (!source.includes('import { scanScopedMemoryContent } from "./scoped/trust.js";') && !source.includes("scanScopedMemoryContent")) {
      replace(
        'import { randomUUID } from "node:crypto";',
        'import { randomUUID } from "node:crypto";\nimport { scanScopedMemoryContent } from "./scoped/trust.js";',
      );
    }
    replace(
      "    consolidate,\n    recall,",
      `    consolidate: async (session, consolidateOptions = {}) => {
      if (promotion === undefined) return {ran: false, reason: "disabled"};
      if (!consolidationLease.enter(session.id)) return {ran: false, reason: "busy"};
      try {
        const entries = await session.entries();
        const ledger = foldObservationalMemoryLedger(entries);
        const writer = createMemoryFabric({...options, observational: {session}});
        const report = {pass: randomUUID(), at: new Date().toISOString(), candidates: ledger.reflections.length, extracted: ledger.reflections.length, accepted: 0,
          rejected: {score: 0, ephemeral: 0, derivable: 0, trust: 0, secret: 0}, written: 0, updated: 0, exceptions: 0, retired: 0, modelCalls: 0};
        for (const reflection of ledger.reflections) {
          consolidateOptions.signal?.throwIfAborted();
          if (!scanScopedMemoryContent(reflection.content).ok) {report.rejected.trust++; continue;}
          if (redactor !== undefined && redactor.redact(reflection.content) !== reflection.content) {report.rejected.secret++; continue;}
          const id = createMemoryId(reflection.content, [session.id, reflection.id]);
          if (await memory.getEntry(id, consolidateOptions.signal === undefined ? {} : {signal: consolidateOptions.signal})) continue;
          await writer.remember({kind: "fact", id, reflectionId: reflection.id}, {generatedBy: "promotion", sessionId: session.id, ...(consolidateOptions.signal === undefined ? {} : {signal: consolidateOptions.signal})});
          report.accepted++;
          report.written++;
        }
        return {ran: report.written > 0, ...(report.written ? {} : {reason: "empty"}), ...(entries.at(-1)?.id === undefined ? {} : {cursor: entries.at(-1).id}), report};
      } finally {consolidationLease.exit(session.id);}
    },
    recall,`,
    );
  }
  if (active("lifecycle.capacity=off"))
    replace(
      "if (overCapacity(usage, limits)) {\n      const result = await enforceCapacity",
      "if (false && overCapacity(usage, limits)) {\n      const result = await enforceCapacity",
    );
  if (active("lifecycle.merge=off")) {
    replace("duplicateGroups(live(), { duplicateDice: lifecycle?.merge.duplicateDice, weights: lifecycle?.storageWeights })", "[]");
    replace("const episodes = lifecycle?.merge.episodes;", "const episodes = undefined;");
  }
  if (active("lifecycle.clock=calendar")) {
    if (path === `${fabric}lifecycle/clock.ts`) {
      replace(
        'export const SCOPE_CLOCK_COUNTER = "sessions";',
        `export const SCOPE_CLOCK_COUNTER = "sessions";
export function benchmarkCalendarClock(): number {
  const raw = process.env.PRISM_MEMORY_BENCH_TIME_MS;
  const time = raw === undefined ? Date.now() : Number(raw);
  if (!Number.isFinite(time) || time < 0 || time > 8.64e15) throw new MemoryValidationError("benchmark calendar time");
  return Math.floor(time / 86400000);
}`,
      );
      replace(
        "read: (resourceId, options = {}) => counter.get(key(resourceId), options),",
        "read: async (resourceId, options = {}) => { await counter.get(key(resourceId), options); return benchmarkCalendarClock(); },",
      );
      replace(
        "clocks[resourceId] = await counter.increment(key(resourceId), options);",
        "await counter.increment(key(resourceId), options);\n        clocks[resourceId] = benchmarkCalendarClock();",
      );
    } else if (path === `${fabric}lifecycle/maintain.ts`) {
      replace(
        'import { SCOPE_CLOCK_COUNTER } from "./clock.js";',
        'import { benchmarkCalendarClock, SCOPE_CLOCK_COUNTER } from "./clock.js";',
      );
      replace(
        "if (Number.isSafeInteger(value) && value >= 0) return value;",
        "if (Number.isSafeInteger(value) && value >= 0) return benchmarkCalendarClock();",
      );
      replace("return deps.clock?.() ?? 0;", "return benchmarkCalendarClock();");
    } else {
      replace(
        'import { createScopeClock, readScopeClockState, SCOPE_CLOCK_COUNTER } from "./lifecycle/clock.js";',
        'import { benchmarkCalendarClock, createScopeClock, readScopeClockState, SCOPE_CLOCK_COUNTER } from "./lifecycle/clock.js";',
      );
      replace(
        "if (Number.isSafeInteger(value) && value >= 0) clock = value;",
        "if (Number.isSafeInteger(value) && value >= 0) clock = benchmarkCalendarClock();",
      );
    }
  }
  if (active("lifecycle.decayMode=exponential")) {
    replace("if (oldest <= newest) return missing * oldest ** -d;", "if (oldest <= newest) return missing * Math.exp(-d * (oldest - 1));");
    replace(
      "if (d === 1) return (missing / (oldest - newest)) * Math.log(oldest / newest);\n  return (missing / (oldest - newest)) * ((oldest ** (1 - d) - newest ** (1 - d)) / (1 - d));",
      "return (missing / (oldest - newest)) * (Math.exp(-d * (newest - 1)) - Math.exp(-d * (oldest - 1))) / d;",
    );
    replace("age ** -decay", "Math.exp(-decay * (age - 1))");
    replace(
      "Math.max(1, Math.floor(clock) - (metadata.created ?? 0) + 1) ** -decay",
      "Math.exp(-decay * (Math.max(1, Math.floor(clock) - (metadata.created ?? 0) + 1) - 1))",
    );
  }
  for (const name of signals) {
    if (active(`promote.signal.${name}=off`))
      replace("  const score = (Object.keys(signals)", `  signals.${name} = 0;\n  const score = (Object.keys(signals)`);
  }
  // Plan 210 Task 5 leave-one-out switches. Each removes one feature's effect and nothing else.
  if (active("fabric.unmatchedTerms=off")) {
    replace(
      'if (unmatchedTerms.length && hits.length > 0)\n            lines.push(`Unmatched terms in returned notes: ${unmatchedTerms.join(", ")}. Try another phrasing.`);',
      "",
    );
    replace("              unmatchedTerms,\n              page,", "              page,");
  }
  if (active("fabric.navigation=off")) {
    replace(
      "Pass exactly one of `path`, `id`, `ids` (1-8), `around` (same-session ±2 exchanges), or `session` (8 exchanges per zero-based page).",
      "Pass exactly one of `path`, `id` or `ids` (1-8).",
    );
    replace(
      `            around: { type: "string", minLength: 1, description: "Exchange id whose same-session neighbours to read (±2)." },
            session: { type: "string", minLength: 1, description: "Session id to page in reference-time order." },
            page: { type: "integer", minimum: 0, description: "Zero-based session page (8 notes); defaults to 0." },
`,
      "",
    );
    replace(
      "          if ([args.path, args.id, args.ids, args.around, args.session].filter((value) => value !== undefined).length !== 1)",
      '          if (args.around !== undefined || args.session !== undefined || args.page !== undefined)\n            throw new MemoryValidationError("navigation is disabled in this benchmark arm");\n          if ([args.path, args.id, args.ids, args.around, args.session].filter((value) => value !== undefined).length !== 1)',
    );
  }
  if (active("fabric.grouping=off")) replace("  if (hits.length < 2) return [...hits];", "  if (hits.length >= 0) return [...hits];");
  if (active("fabric.aggregation=off")) {
    replace(
      " For aggregation questions, list the instances and their ids before counting or totalling, and issue two or three differently-worded queries.",
      "",
    );
    replace(
      ", preceded by a grouped summary: matches, distinct sessions, per-session counts and dates, and how many more are not shown.",
      ".",
    );
    replace(
      'const summaryReserve = Math.ceil((renderRecallSummary(summaryInput).join("\\n").length || 0) / 4);',
      "const summaryReserve = 0;",
    );
    replace("if (hits.length > 0 && top >= RECALL_NO_MATCH_CONFIDENCE) {", "if (hits.length < 0) {");
    replace("          if (top < RECALL_NO_MATCH_CONFIDENCE) {", "          if (hits.length < 0) {");
  }
  if (active("ontology.pointer=off")) replace("            if (!conceptInPlay(record, terms, touched)) continue;", "            continue;");
  if (active("om.reflector=off"))
    replace("if (uncovered.length && uncoveredTokens >= config.reflector.observationTokens) {", "if (uncovered.length < 0) {");
  if (active("lifecycle.exchangeExempt=on"))
    replace(
      "        shouldArchive(row.metadata, clock, decision) &&",
      '        row.metadata.kind !== "exchange" &&\n        shouldArchive(row.metadata, clock, decision) &&',
    );
  return source;
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export async function variantProvenance(input = []) {
  const specs = parseVariantSpecs(input);
  const paths = [...new Set(specs.flatMap((spec) => VARIANT_PATHS[spec] ?? []))].sort();
  return Promise.all(
    paths.map(async (path) => {
      const original = await readFile(resolve(root, path), "utf8");
      const transformed = transformVariantSource(path, original, specs);
      return { path, originalSha256: sha256(original), transformedSha256: sha256(transformed) };
    }),
  );
}

if (process.env.PRISM_MEMORY_BENCH_VARIANTS) {
  const specs = parseVariantSpecs(JSON.parse(process.env.PRISM_MEMORY_BENCH_VARIANTS));
  const paths = new Set(specs.flatMap((spec) => VARIANT_PATHS[spec] ?? []).map((path) => resolve(root, path)));
  if (paths.size) {
    Bun.plugin({
      name: "memory-bench-historical-variants",
      setup(build) {
        const filter = new RegExp(`^(?:${[...paths].map((path) => path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`);
        build.onLoad({ filter }, async ({ path }) => {
          return { contents: transformVariantSource(path, await readFile(path, "utf8"), specs), loader: "ts" };
        });
      },
    });
  }
}
