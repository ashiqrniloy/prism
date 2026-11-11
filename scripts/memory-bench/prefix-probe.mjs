/** Plan 202 Task 4.11: offline characterization; no cache behavior is changed. */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { HARNESS_PATHS, PREFIX_PRODUCT_PATHS, sourceFingerprint } from "./acceptance.mjs";
import { timingStats } from "./timing.mjs";

const root = resolve(import.meta.dir, "../..");
const sha256 = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
const SOURCES = ["fabric-directory", "fabric-rules"];
const CANARY = "canary rollouts go first";
const SECOND = "violet orchard retains spare keys";
const seedId = "aaaaaaaaaaaa";
const scope = { tenantId: "prefix-probe", resourceId: "projects/probe--01234567", threadId: "default" };
const tick = () => new Promise((done) => setTimeout(done, 0));

/** Hash the actual captured context, before projecting anything into public evidence. */
export function summarizeRequests(captures) {
  const firstChanges = {};
  const previous = {};
  const requests = captures.map(({ request, turn, writes }, index) => {
    const blocks = Object.fromEntries(
      SOURCES.map((source) => [source, request.context?.filter((block) => block.metadata?.source === source) ?? []]),
    );
    const hashes = Object.fromEntries(SOURCES.map((source) => [source, blocks[source].length ? sha256(blocks[source]) : null]));
    const prefixSha256 = sha256(request.context ?? []);
    const current = { prefix: prefixSha256, ...hashes };
    const changed = [];
    for (const [source, hash] of Object.entries(current)) {
      if (index > 0 && previous[source] !== hash) {
        changed.push(source);
        firstChanges[source] ??= { request: index + 1, turn, writes: [...writes] };
      }
      previous[source] = hash;
    }
    const tailIndices = (request.messages ?? []).flatMap((message, i) =>
      message.metadata?.contextBlocks?.some((block) => block.source === "fabric-semantic") ? [i] : [],
    );
    const lastUser = (request.messages ?? []).findLastIndex((message) => message.role === "user" && !message.metadata?.contextBlocks);
    const priorTranscriptEnd = (request.messages ?? []).findLastIndex((message, i) => i < lastUser && message.role !== "system");
    return {
      request: index + 1,
      turn,
      prefixSha256,
      blocks: hashes,
      prefixBytes: Buffer.byteLength(JSON.stringify(request.context ?? [])),
      tailPresent: tailIndices.length > 0,
      tailAfterTranscript: tailIndices.length ? tailIndices.every((i) => i > lastUser) : null,
      tailBeforeLatestUser: tailIndices.length ? tailIndices.every((i) => i < lastUser) : null,
      tailAfterPriorTranscript: tailIndices.length ? tailIndices.every((i) => i > priorTranscriptEnd) : null,
      tailIndices,
      latestUserIndex: lastUser,
      priorTranscriptEnd,
      changed,
      writes: [...writes],
    };
  });
  return { requests, firstChanges, distinctPrefixes: new Set(requests.map((row) => row.prefixSha256)).size };
}

/** Observe the private map without adding a product API; same process-local loader pattern as variants.mjs. */
async function installObservation(maps) {
  let nonce = 0;
  globalThis.__prismPrefixProbe = { maps, nonce: () => String(++nonce).padStart(32, "0") };
  const paths = ["packages/memory/system/src/ltm/context.ts", "packages/memory/system/src/ltm/create.ts", "src/ids.ts"];
  const sources = await Promise.all(paths.map(async (path) => ({ path, source: await readFile(join(root, path), "utf8") })));
  const transforms = new Map(
    sources.map(({ path, source }) => {
      const before = path.endsWith("context.ts") ? "const cache = new Map<string, SessionTail>();" : "randomUUID()";
      const after = path.endsWith("context.ts")
        ? `${before}\n  globalThis.__prismPrefixProbe.maps.push(cache);`
        : "globalThis.__prismPrefixProbe.nonce()";
      assert.equal(source.split(before).length, 2, `prefix probe observation source drift: ${path}`);
      return [join(root, path), source.replace(before, after)];
    }),
  );
  Bun.plugin({
    name: "memory-prefix-probe-observation",
    setup(build) {
      build.onLoad({ filter: /(?:memory\/system\/src\/ltm\/(?:context|create)|src\/ids)\.ts$/ }, async ({ path }) => {
        const contents = transforms.get(path) ?? (await readFile(path, "utf8"));
        return { contents, loader: "ts" };
      });
    },
  });
  return { sources: sources.map(({ path, source }) => ({ path, sha256: sha256(source) })) };
}

async function runPrefixProbe() {
  const maps = [];
  const observation = await installObservation(maps);
  const RealDate = Date;
  const realFetch = globalThis.fetch;
  // Only clock/nonce inputs are fixed. Context serialization, stores, hooks and tools run unchanged.
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : ["2026-01-01T00:00:00.000Z"]));
    }
    static now() {
      return RealDate.parse("2026-01-01T00:00:00.000Z");
    }
  };
  globalThis.fetch = () => {
    throw new Error("prefix probe forbids network access");
  };
  const temp = await mkdtemp(join(tmpdir(), "prism-prefix-probe-"));
  try {
    const { createAgent, definePackage } = await import("@arnilo/prism");
    const { mockProvider, providerDone, providerTextDelta, providerToolCall, toolCallContent } = await import("@arnilo/prism/testing");
    const {
      default: memorySystem,
      createMemory,
      createLongTermMemory,
      parseMemoryNoteMetadata,
    } = await import("@arnilo/prism-memory-system");
    const { createSqliteMemoryStores } = await import("@arnilo/prism-memory-system/core/sqlite");
    const { storageStrength } = await import("../../packages/memory/system/src/ltm/lifecycle/strength.ts");
    const extractorRequests = [];
    const scenarios = [];
    const strengths = [];
    const quiet = () => [providerTextDelta("ok"), providerDone()];
    const toolStep = (name, args, id) => [providerToolCall(toolCallContent(id, name, args)), providerDone()];
    let tailRequests = 0;
    let tailsAfterTranscript = true;
    let tailsBeforeLatestUser = true;
    let tailsAfterPriorTranscript = true;

    async function harness(name, { preset, promote = false, core, script = [quiet()] } = {}) {
      const dir = join(temp, name);
      await mkdir(dir);
      const path = join(dir, "memory.sqlite");
      const stores = await createSqliteMemoryStores({ path });
      const memory = createMemory({ ...scope, ...stores });
      const writer = createLongTermMemory({ memory, vectorStore: stores.vectorStore, consolidate: false });
      await writer.remember({ id: seedId, kind: "fact", content: CANARY, scope: "project", keywords: ["canary"] });
      if (name === "cited-core")
        await writer.remember({ id: "bbbbbbbbbbbb", kind: "fact", content: SECOND, scope: "project", keywords: ["orchard"] });
      const captures = [];
      const writes = [];
      const active = new Set();
      const failures = [];
      const completed = [];
      let turn = 0;
      const agent = await createAgent({
        model: "mock/main",
        packages: [
          mockProvider(script, {
            onRequest(request) {
              if (request.messages.at(-1)?.role === "tool") {
                const call = request.messages
                  .findLast((message) => message.role === "assistant")
                  ?.content.find((block) => block.type === "tool_call");
                writes.push(call?.name ?? "tool.write");
              }
              captures.push({
                request: structuredClone({ context: request.context, messages: request.messages }),
                turn,
                writes: writes.splice(0),
              });
            },
          }),
          mockProvider(
            [
              toolStep(
                "record_notes",
                {
                  notes: [
                    {
                      text: SECOND,
                      kind: "fact",
                      scope: "project",
                      keywords: ["orchard"],
                      aliases: [],
                      evidence: ["c1"],
                      explicit: true,
                      correction: false,
                      generality: 1,
                      ephemerality: 0,
                      derivable: false,
                    },
                  ],
                },
                "extract-1",
              ),
              toolStep(
                "record_notes",
                {
                  notes: [
                    {
                      text: "retry budget stays small",
                      kind: "fact",
                      scope: "project",
                      keywords: ["retry"],
                      aliases: [],
                      evidence: ["c1"],
                      explicit: true,
                      correction: false,
                      generality: 1,
                      ephemerality: 0,
                      derivable: false,
                    },
                  ],
                },
                "extract-2",
              ),
            ],
            {
              id: "extractor",
              onRequest: (request) =>
                extractorRequests.push(
                  structuredClone({
                    system: request.system,
                    tools: request.tools?.map(({ name, description, parameters }) => ({ name, description, parameters })),
                    messages: request.messages,
                  }),
                ),
            },
          ),
          memorySystem({
            ltm: {
              ...(preset ? { preset } : {}),
              ...(core === false ? { rules: false, inject: { query: "user", minSimilarity: 0 } } : {}),
              tools: { root: dir },
              store: { sqlite: { path } },
              scopes: { tenantId: scope.tenantId, project: { id: "probe--01234567", root: dir }, agent: false, user: false },
              ...(promote ? { promote: { model: "extractor/main", minTurnsBetween: 1, derivableFrom: [], minScore: 0 } } : {}),
            },
          }),
          // The package's normal trigger needs fresh OM material. Supply fixture observations via a
          // host package; the real fabric schedules and executes the background consolidation.
          definePackage({
            name: "@probe/observations",
            version: "0.0.0",
            requires: { api: 1 },
            capabilities: ["session-state"],
            setup(prism) {
              const log = prism.state.log("ledger");
              if (promote)
                prism.hooks.on(
                  "turn.completed",
                  async (_event, context) => {
                    if (turn !== 5 && turn !== 8) return;
                    await log.append(context.session, {
                      type: "memory.session.reflections.recorded",
                      reflections: [
                        {
                          id: turn === 5 ? "cccccccccccc" : "dddddddddddd",
                          content: turn === 5 ? SECOND : "retry budget stays small",
                          tokenCount: 8,
                          supportingObservationIds: [],
                        },
                        ...(turn === 8
                          ? [{ id: "eeeeeeeeeeee", content: "orchard keys stay in storage", tokenCount: 7, supportingObservationIds: [] }]
                          : []),
                      ],
                    });
                  },
                  { priority: 100 },
                );
            },
          })(),
        ],
      });
      const stream = agent.subscribe();
      const collection = (async () => {
        for await (const event of stream) {
          if (event.type === "background.started") active.add(event.taskId);
          if (event.type === "background.completed" || event.type === "background.failed") {
            active.delete(event.taskId);
            if (event.type === "background.failed") failures.push(event.reason);
            else {
              completed.push(event.name);
              writes.push(event.name);
            }
          }
        }
      })();
      async function settle() {
        for (let i = 0; i < 500; i++) {
          await tick();
          if (!active.size) {
            await tick();
            if (!active.size) {
              assert.deepEqual(failures, []);
              return;
            }
          }
        }
        throw new Error("prefix probe background timeout");
      }
      return {
        agent,
        stores,
        memory,
        writer,
        captures,
        writes,
        completed,
        async run(session, n) {
          turn = n;
          const result = await session.run(`fixture turn ${n} canary rollouts`);
          assert.equal(result.status, "completed", result.error?.message);
          await settle();
        },
        async close() {
          await agent.dispose();
          await collection;
          stores.close();
        },
      };
    }

    const names = ["exchange-archive", "cited-core", "insert", "background-promote", "forget", "second-instance"];
    for (const name of names) {
      const script = [];
      for (let turn = 1; turn <= 10; turn++) {
        if (name === "cited-core" && turn > 1)
          script.push(toolStep("memory.recall", { query: "violet orchard", minSimilarity: 0 }, `recall-${turn}`));
        if (name === "insert" && turn === 5) script.push(toolStep("memory.insert", { kind: "fact", text: SECOND }, "insert-5"));
        if (name === "forget" && turn === 6) script.push(toolStep("memory.forget", { id: seedId }, "forget-6"));
        script.push(name === "cited-core" ? [providerTextDelta("Used [bbbbbbbbbbbb]"), providerDone()] : quiet());
      }
      const h = await harness(name, {
        preset: name === "exchange-archive" ? "conversational" : undefined,
        promote: name === "background-promote",
        script,
      });
      try {
        const strengthId = name === "cited-core" ? "bbbbbbbbbbbb" : seedId;
        const before = storageStrength(parseMemoryNoteMetadata((await h.memory.getEntry(strengthId)).metadata));
        const session = await h.agent.session({ id: name, create: true });
        for (let turn = 1; turn <= 10; turn++) {
          if (name === "second-instance" && turn === 5) {
            await h.writer.remember({ id: "bbbbbbbbbbbb", kind: "fact", content: SECOND, scope: "project" });
            h.writes.push("second-instance.insert");
          }
          if (name === "second-instance" && turn === 6) {
            await h.writer.forget({ id: seedId });
            h.writes.push("second-instance.forget");
          }
          await h.run(session, turn);
          if (name === "cited-core")
            strengths.push(storageStrength(parseMemoryNoteMetadata((await h.memory.getEntry(strengthId)).metadata)));
        }
        const summary = summarizeRequests(h.captures);
        for (const row of summary.requests)
          if (row.tailPresent) {
            tailRequests++;
            tailsAfterTranscript &&= row.tailAfterTranscript;
            tailsBeforeLatestUser &&= row.tailBeforeLatestUser;
            tailsAfterPriorTranscript &&= row.tailAfterPriorTranscript;
          }
        const rows = await h.stores.vectorStore.getByThread(scope);
        const rawLast = h.captures.at(-1).request.context ?? [];
        const showsForgotten = rawLast.some((block) => block.metadata?.source === "fabric-rules" && block.content.includes(CANARY));
        scenarios.push({
          id: name,
          ...summary,
          storedNotes: rows.length,
          archivedExchanges: rows.filter((row) => parseMemoryNoteMetadata(row.metadata)?.kind === "exchange").length,
          consolidationPasses: h.completed.filter((task) => task === "fabric.consolidate").length,
          ...(name === "cited-core" ? { strengthBefore: before, strengthAfterEachTurn: strengths, recallStartsAtTurn: 2 } : {}),
          ...(["forget", "second-instance"].includes(name)
            ? { forgottenNoteVisibleOnLastRequest: showsForgotten, forgottenNoteReadable: (await h.memory.getEntry(seedId)) !== undefined }
            : {}),
        });
        await session.close();
      } finally {
        await h.close();
      }
    }

    // Force nonempty passive delivery: core off leaves the seeded fact available to the tail.
    const tailHarness = await harness("tail-cache", { core: false });
    let tailCache;
    try {
      const map = maps.at(-1);
      assert.ok(map, "context module was imported before observation installed; run the probe in a fresh process");
      const entriesBefore = map.size;
      for (let i = 0; i < 4; i++) {
        const session = await tailHarness.agent.session({ id: `tail-${i}`, create: true });
        for (let turn = 1; turn <= (i === 0 ? 10 : 1); turn++) await tailHarness.run(session, turn);
        await session.close();
      }
      tailCache = { sessionsClosed: 4, entriesBefore, entriesAfterClose: map.size, evicted: map.size === entriesBefore };
      for (const row of summarizeRequests(tailHarness.captures).requests)
        if (row.tailPresent) {
          tailRequests++;
          tailsAfterTranscript &&= row.tailAfterTranscript;
          tailsBeforeLatestUser &&= row.tailBeforeLatestUser;
          tailsAfterPriorTranscript &&= row.tailAfterPriorTranscript;
        }
    } finally {
      await tailHarness.close();
    }

    const tokenInputs = [];
    const extractor = extractorRequests.map((request) => {
      const tools = request.tools ?? [];
      const without = structuredClone(tools);
      for (const tool of without) {
        const properties = tool.parameters.properties.notes.items.properties;
        delete properties.evidence.items.enum;
        if (properties.contradicts) delete properties.contradicts.enum;
        if (properties.segment) delete properties.segment.enum;
      }
      const system = request.system ?? request.messages.filter((message) => message.role === "system");
      const encoded = JSON.stringify({ system, tools });
      const stripped = JSON.stringify({ system, tools: without });
      tokenInputs.push(encoded, stripped);
      return {
        systemSha256: sha256(system),
        toolsSha256: sha256(tools),
        withoutIdEnumsSha256: sha256(without),
        encodedBytes: Buffer.byteLength(encoded),
        withoutIdEnumsBytes: Buffer.byteLength(stripped),
        estimatedTokens: Math.ceil(encoded.length / 4),
        withoutIdEnumsEstimatedTokens: Math.ceil(stripped.length / 4),
        encodedTokens: null,
      };
    });
    assert.equal(extractor.length, 2, "both real background extractions must run");
    let tokenizer = null;
    const tokenizerPath = process.env.PRISM_PREFIX_PROBE_TOKENIZER;
    if (tokenizerPath) {
      const python = process.env.PRISM_PREFIX_PROBE_PYTHON;
      assert.ok(python, "PRISM_PREFIX_PROBE_PYTHON is required with a local tokenizer");
      const result = JSON.parse(
        execFileSync(
          python,
          [
            "-c",
            "import json,sys,importlib.metadata; from tokenizers import Tokenizer; t=Tokenizer.from_file(sys.argv[1]); print(json.dumps({'counts':[len(t.encode(s,add_special_tokens=False).ids) for s in json.load(sys.stdin)],'version':importlib.metadata.version('tokenizers')}))",
            tokenizerPath,
          ],
          { input: JSON.stringify(tokenInputs), encoding: "utf8", timeout: 10_000 },
        ),
      );
      assert.equal(result.counts.length, tokenInputs.length);
      tokenizer = { sha256: sha256(await readFile(tokenizerPath, "utf8")), libraryVersion: result.version };
      for (const [index, sample] of extractor.entries()) {
        sample.encodedTokens = result.counts[index * 2];
        sample.withoutIdEnumsEncodedTokens = result.counts[index * 2 + 1];
      }
    }
    const report = {
      schema: "memory-prefix-probe-v1",
      fixture: 1,
      networkCalls: 0,
      productHash: await sourceFingerprint(PREFIX_PRODUCT_PATHS, root),
      supportingSourceHash: await sourceFingerprint(["packages/memory/core/src", "src"], root),
      probeSha256: sha256(await readFile(import.meta.path, "utf8")),
      provenance: observation.sources,
      scenarios,
      assumptions: {
        storageStrength: {
          coreOnlyCitationRecorded: strengths[0] > scenarios[1].strengthBefore,
          increasesOnRecordedUse: strengths[1] > strengths[0],
          deduplicatesWithinSession: new Set(strengths.slice(1)).size === 1,
        },
        tail: {
          requests: tailRequests,
          afterTranscript: tailRequests > 0 && tailsAfterTranscript,
          beforeLatestUser: tailRequests > 0 && tailsBeforeLatestUser,
          afterPriorTranscript: tailRequests > 0 && tailsAfterPriorTranscript,
        },
        extractor: {
          calls: extractor.length,
          systemIdentical: new Set(extractor.map((row) => row.systemSha256)).size === 1,
          toolsIdentical: new Set(extractor.map((row) => row.toolsSha256)).size === 1,
          samples: extractor,
          tokenCountsMeasured: tokenizer !== null,
          tokenizer,
        },
      },
      tailCache,
    };
    return { ...report, sha256: sha256(report) };
  } finally {
    globalThis.Date = RealDate;
    globalThis.fetch = realFetch;
    delete globalThis.__prismPrefixProbe;
    await rm(temp, { recursive: true, force: true });
  }
}

/** Hash each layer of one provider request, so a differing request says which layer moved. */
export function requestSegments(request) {
  const messages = request.messages ?? [];
  const isTail = (message) => message.metadata?.contextBlocks !== undefined;
  const lastUser = messages.findLastIndex((message) => message.role === "user" && !isTail(message));
  const tailIndices = messages.flatMap((message, index) => (isTail(message) ? [index] : []));
  return {
    system: sha256(messages.filter((message) => message.role === "system" && !isTail(message))),
    tools: sha256(request.tools ?? []),
    context: sha256(request.context ?? []),
    transcript: sha256(messages.filter((message) => message.role !== "system" && !isTail(message))),
    tail: sha256(messages.filter(isTail)),
    tailPosition:
      tailIndices.length === 0 ? "none" : tailIndices.every((index) => index > lastUser) ? "after-latest-user" : "before-latest-user",
  };
}

/** The answer paths whose provider requests must not change (the Task 4 screen arms that read fabric memory). */
export const EQUIVALENCE_ARM_IDS = ["preset-r1", "passive-only"];
const SUPPORTING_PATHS = ["src", "packages/memory/core/src", "packages/memory/system/src"];
/** A pre-plan-216 base's session and LTM packages (`--base-harness own` fingerprints whichever exist). */
const PRE_MOVE_SUPPORTING_PATHS = ["packages/memory/observational/src", "packages/memory/fabric/src"];

/**
 * Replay every synthetic fixture question on each answer path with a mock provider and hash each
 * answer-phase provider request. Run it under `equivalence-preload.mjs`; hashes only, unless `dump` names
 * a private directory for the request text.
 */
export async function captureAnswerPaths({ dump } = {}) {
  assert.equal(globalThis.__prismEquivalencePinned, true, "run under --preload equivalence-preload.mjs");
  const { default: fixture } = await import("./fixtures/synthetic.json", { with: { type: "json" } });
  const { mockProvider, replay } = await import("./replay.mjs");
  const { BASELINE_ARMS } = await import("./baseline.mjs");
  const arms = [];
  for (const id of EQUIVALENCE_ARM_IDS) {
    const { config } = BASELINE_ARMS.find((arm) => arm.id === id);
    const questions = [];
    for (const raw of fixture.questions) {
      const state = {
        phase: "ingest",
        calls: { observer: 0, reflector: 0, dropper: 0, embedding: 0, decider: 0 },
        turns: 0,
        injections: [],
        injectionText: new Map(),
        injectedContextTokens: 0,
        mockInputTokens: 0,
        ceilingReached: () => false,
      };
      const base = mockProvider(state);
      const requests = [];
      const provider = {
        id: "mock",
        async *generate(request) {
          if (state.phase === "answer") requests.push(request);
          yield* base.generate(request);
        },
      };
      const question = { ...raw, sessions: raw.sessions ?? fixture.sessions, date: raw.date ?? fixture.sessions.at(-1).date };
      const modelConfig = { provider: "mock", model: "synthetic", limits: { contextWindow: 128_000, maxOutputTokens: 1024 } };
      await replay(question, { config, suite: "synthetic", modelConfig, inputCap: 128_000 }, [provider], state);
      const texts = requests.map((request) => JSON.stringify(request));
      if (dump)
        for (const [index, text] of texts.entries()) {
          const file = join(dump, id, encodeURIComponent(question.id), `${index + 1}.json`);
          await mkdir(dirname(file), { recursive: true });
          await writeFile(file, text);
        }
      questions.push({
        id: question.id,
        requests: texts.map((text, index) => ({
          sha256: sha256(text),
          bytes: Buffer.byteLength(text),
          segments: requestSegments(requests[index]),
        })),
      });
    }
    arms.push({ id, config, questions });
  }
  return { kind: "202-answer-path-capture", arms };
}

/**
 * Compare two captures request by request. Identical means every arm, question and request index has the same
 * hash. Otherwise the differing arms are listed for rerun and are never merged with pre-change cells.
 */
export function compareAnswerCaptures(base, post) {
  const differing = [];
  let compared = 0;
  const arms = [...new Set([...base.arms.map((arm) => arm.id), ...post.arms.map((arm) => arm.id)])];
  for (const id of arms) {
    const before = base.arms.find((arm) => arm.id === id);
    const after = post.arms.find((arm) => arm.id === id);
    const questions = [];
    const segments = new Set();
    const tailPositions = { base: new Set(), post: new Set() };
    const ids = [...new Set([...(before?.questions ?? []), ...(after?.questions ?? [])].map((question) => question.id))];
    for (const questionId of ids) {
      const a = before?.questions.find((question) => question.id === questionId)?.requests;
      const b = after?.questions.find((question) => question.id === questionId)?.requests;
      compared += Math.max(a?.length ?? 0, b?.length ?? 0);
      const firstDifferent = a && b ? [...Array(Math.max(a.length, b.length)).keys()].find((i) => a[i]?.sha256 !== b[i]?.sha256) : 0;
      for (const [name, requests] of [
        ["base", a],
        ["post", b],
      ])
        for (const request of requests ?? []) if (request.segments) tailPositions[name].add(request.segments.tailPosition);
      for (let i = 0; i < Math.min(a?.length ?? 0, b?.length ?? 0); i++)
        if (a[i].sha256 !== b[i].sha256 && a[i].segments && b[i].segments)
          for (const name of Object.keys(a[i].segments)) if (a[i].segments[name] !== b[i].segments[name]) segments.add(name);
      if (firstDifferent !== undefined)
        questions.push({
          id: questionId,
          baseRequests: a?.length ?? null,
          postRequests: b?.length ?? null,
          firstDifferentRequest: firstDifferent + 1,
        });
    }
    if (questions.length)
      differing.push({
        arm: id,
        config: (before ?? after).config,
        differingSegments: [...segments].sort(),
        tailPositions: { base: [...tailPositions.base].sort(), post: [...tailPositions.post].sort() },
        questions,
      });
  }
  return {
    status: differing.length ? "different" : "identical",
    requestsCompared: compared,
    differingArms: differing.map((row) => row.arm),
    differing,
    // The 23-cell screen ran the pre-change product: a differing arm is rerun under its own gate, never mixed in.
    rerunArms: differing.map((row) => row.arm),
    mergeWithPreChangeCells: false,
  };
}

function runCapture(tree, out, dump) {
  const harness = join(tree, "scripts/memory-bench");
  const result = spawnSync(
    process.execPath,
    [
      "--preload",
      join(harness, "equivalence-preload.mjs"),
      join(harness, "prefix-probe.mjs"),
      "--capture-answers",
      out,
      ...(dump ? ["--dump", dump] : []),
    ],
    { cwd: tree, encoding: "utf8", timeout: 540_000, maxBuffer: 8_000_000 },
  );
  assert.equal(result.status, 0, `capture failed in ${tree}: ${result.stderr?.slice(-2000)}`);
}

/**
 * Make `base` a comparable pre-change tree: its own product, the current harness. The worktree needs its
 * own node_modules (relative workspace links), so the checkout is never resolved through this tree's product.
 */
async function prepareBase(base, { ownHarness = false } = {}) {
  const tree = resolve(base);
  assert.notEqual(tree, root, "--base must be a separate git worktree of the pre-change commit");
  assert.ok(existsSync(join(tree, ".git")), "--base must be a git worktree");
  if (ownHarness) {
    // A base from before a package move (plan 216 Task 8): this harness cannot import its product, so the base runs
    // its own committed harness against its own install. A local edit to that harness would make it a third tree.
    assert.ok(existsSync(join(tree, "node_modules")), "--base-harness own: run `bun install --frozen-lockfile` in the base worktree");
    const dirty = execFileSync("git", ["status", "--porcelain", "--", "scripts/memory-bench"], { cwd: tree, encoding: "utf8" });
    assert.equal(dirty.trim(), "", "--base-harness own: the base harness must be the base commit's, unmodified");
    return tree;
  }
  if (!existsSync(join(tree, "node_modules")))
    await cp(join(root, "node_modules"), join(tree, "node_modules"), { recursive: true, verbatimSymlinks: true });
  await rm(join(tree, "scripts/memory-bench"), { recursive: true, force: true });
  await cp(join(root, "scripts/memory-bench"), join(tree, "scripts/memory-bench"), { recursive: true });
  return tree;
}

/**
 * Plan 202 Task 4.15 equivalence attestation: the same answer paths on the pre-change tree and on this tree,
 * twice each. Writes hashes and verdicts only.
 */
export async function runEquivalence({ base, keepText, ownHarness = false } = {}) {
  const tree = await prepareBase(base, { ownHarness });
  const temp = await mkdtemp(join(tmpdir(), "prism-equivalence-"));
  try {
    const trees = { base: tree, post: root };
    const captures = {};
    for (const [name, dir] of Object.entries(trees)) {
      captures[name] = [];
      for (const run of [1, 2]) {
        const out = join(temp, `${name}-${run}.json`);
        runCapture(dir, out, keepText && run === 1 ? join(keepText, name) : undefined);
        captures[name].push(JSON.parse(await readFile(out, "utf8")));
      }
    }
    const deterministic = Object.fromEntries(
      Object.entries(captures).map(([name, [one, two]]) => [name, compareAnswerCaptures(one, two).status === "identical"]),
    );
    assert.ok(deterministic.base && deterministic.post, "answer-path capture is not deterministic within a tree");
    const comparison = compareAnswerCaptures(captures.base[0], captures.post[0]);
    // Each tree's product is the one its own harness names (the paths move with a package move).
    const productPaths = async (dir) =>
      dir === root || !ownHarness
        ? PREFIX_PRODUCT_PATHS
        : (await import(join(dir, "scripts/memory-bench/acceptance.mjs"))).PREFIX_PRODUCT_PATHS;
    const supportingPaths = (dir) =>
      [...SUPPORTING_PATHS, ...(ownHarness ? PRE_MOVE_SUPPORTING_PATHS : [])].filter((path) => existsSync(join(dir, path)));
    const describe = async (dir) => ({
      commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim(),
      productPaths: await productPaths(dir),
      productHash: await sourceFingerprint(await productPaths(dir), dir),
      harnessHash: await sourceFingerprint(HARNESS_PATHS, dir),
      supportingPaths: supportingPaths(dir),
      supportingHash: await sourceFingerprint(supportingPaths(dir), dir),
    });
    // The screen's manifest names the product it ran; a base whose hash differs is a different baseline.
    const screen = await readFile(join(root, "docs/_evidence/memory-bench/202/baseline/manifest.json"), "utf8")
      .then((text) => JSON.parse(text))
      .catch(() => undefined);
    const described = await describe(tree);
    const base_ = {
      ...described,
      screenProductHash: screen?.productHash ?? null,
      isScreenProduct: screen?.productHash !== undefined && screen.productHash === described.productHash,
    };
    const post = await describe(root);
    if (!ownHarness) assert.equal(base_.harnessHash, post.harnessHash, "both trees must run the same harness");
    assert.notEqual(base_.productHash, post.productHash, "the base is not a different product");
    const report = {
      kind: "202-cache-stability-equivalence",
      version: 1,
      ...comparison,
      deterministic,
      arms: captures.post[0].arms.map((arm) => ({
        id: arm.id,
        config: arm.config,
        questions: arm.questions.length,
        requests: arm.questions.reduce((n, question) => n + question.requests.length, 0),
        identical: !comparison.differingArms.includes(arm.id),
      })),
      harness: ownHarness ? "per-tree" : "shared",
      base: base_,
      post,
      policy: ownHarness
        ? "Compares every answer-phase provider request on the pre-change tree (its own committed harness) and this tree, byte for byte."
        : "Compares every answer-phase provider request on the pre-change tree and this tree, byte for byte.",
    };
    return { ...report, sha256: sha256(report) };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const emit = async (report, out) => {
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (out) {
      await mkdir(dirname(resolve(out)), { recursive: true });
      await writeFile(out, json);
    } else process.stdout.write(json);
  };
  if (args.includes("--capture-answers")) {
    await emit(await captureAnswerPaths({ dump: flag("--dump") }), flag("--capture-answers"));
  } else if (args.includes("--equivalence")) {
    assert.ok(
      flag("--base"),
      "usage: prefix-probe.mjs --equivalence --base <pre-change worktree> [--base-harness own] [--out path] [--keep-text dir]",
    );
    const harness = flag("--base-harness");
    assert.ok(harness === undefined || harness === "own", "--base-harness takes `own`");
    const report = await runEquivalence({ base: flag("--base"), keepText: flag("--keep-text"), ownHarness: harness === "own" });
    await emit(report, flag("--out"));
    process.stderr.write(`${JSON.stringify({ status: report.status, differingArms: report.differingArms, sha256: report.sha256 })}\n`);
  } else {
    assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--out"), "usage: prefix-probe.mjs [--out path]");
    const started = performance.now();
    const report = await runPrefixProbe();
    assert.ok(performance.now() - started < 60_000, "prefix probe exceeded 60 seconds");
    await emit(report, args[0] === "--out" ? args[1] : undefined);
    if (args.length)
      process.stderr.write(`${JSON.stringify({ wallMs: timingStats([performance.now() - started]), sha256: report.sha256 })}\n`);
  }
}
