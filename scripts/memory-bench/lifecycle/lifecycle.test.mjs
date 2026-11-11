import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemorySessionStore, createSecretRedactor, createSessionEntry } from "@arnilo/prism";
import { recordLedger } from "./record.mjs";
import { replayLedgers } from "./replay.mjs";
import { synthLedgers } from "./synth.mjs";

async function temporary(run) {
  const dir = await mkdtemp(join(tmpdir(), "prism-lifecycle-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
test("record_refuses_without_consent_and_redacts_secrets", () =>
  temporary(async (dir) => {
    const secret = "private-session-secret";
    const store = createMemorySessionStore([
      createSessionEntry({
        id: "e",
        sessionId: "private-session",
        kind: "message",
        timestamp: "2026-01-01T00:00:00Z",
        message: { role: "user", content: [{ type: "text", text: `Alice alice@example.com /home/alice ${secret}` }] },
      }),
    ]);
    const options = { store, session: "private-session", out: dir, identities: ["Alice"], redactor: createSecretRedactor([secret]) };
    await assert.rejects(recordLedger(options), /consent/);
    assert.deepEqual(await readdir(dir), []);
    const path = await recordLedger({ ...options, consent: true });
    const content = await readFile(path, "utf8");
    for (const raw of [secret, "Alice", "alice@example.com", "/home/alice", "private-session"]) assert.ok(!content.includes(raw));
    assert.equal(JSON.parse(content.split("\n")[0]).consent, true);
    assert.equal(await recordLedger({ ...options, consent: true }), path);
  }));
test("record_scanner_rejects_unknown_secrets_without_publishing", () =>
  temporary(async (dir) => {
    const store = createMemorySessionStore([
      createSessionEntry({
        sessionId: "s",
        kind: "message",
        message: { role: "user", content: [{ type: "text", text: `ghp_${"a".repeat(35)}` }] },
      }),
    ]);
    await assert.rejects(recordLedger({ store, session: "s", consent: true, out: dir }), /Secret scan/);
    assert.deepEqual(await readdir(dir), []);
  }));
test("synth_is_deterministic_for_seed_and_labels_every_planted_item", () => {
  const a = synthLedgers({ personas: 2, projects: 2, sessions: 4, seed: 7 });
  assert.deepEqual(a, synthLedgers({ personas: 2, projects: 2, sessions: 4, seed: 7 }));
  assert.notDeepEqual(a, synthLedgers({ personas: 2, projects: 2, sessions: 4, seed: 8 }));
  assert.equal(a.length, 16);
  const labels = a.flatMap((s) => s.manifest.labels);
  for (const scenario of ["preference", "fact", "decision", "path", "lesson", "supersession", "noise", "poison"])
    assert.ok(
      labels.some((l) => l.scenario === scenario),
      scenario,
    );
  assert.ok(labels.every((l) => l.id && l.entryIds.length && typeof l.shouldPromote === "boolean"));
  assert.ok(labels.filter((l) => ["noise", "poison"].includes(l.scenario)).every((l) => !l.shouldPromote));
  assert.throws(() => synthLedgers({ personas: 0 }), /positive/);
});
test("replay_warm_cache_makes_no_model_call_and_reports_component_metrics_offline", () =>
  temporary(async (cache) => {
    const ledgers = synthLedgers({ personas: 2, projects: 2, sessions: 4, seed: 7 });
    const options = { ledgers, cache, offline: true, policy: { promote: { minScore: 0 }, lifecycle: { archive: { graceSessions: 100 } } } };
    const cold = await replayLedgers(options);
    assert.equal(cold.calls.extractor, ledgers.length);
    const warm = await replayLedgers({
      ...options,
      onModelCall: () => {
        throw new Error("warm cache called model");
      },
    });
    assert.equal(warm.calls.extractor, 0);
    assert.equal(warm.calls.cacheHits, ledgers.length);
    assert.deepEqual(warm.metrics, cold.metrics);
    for (const metric of [
      "promotionPrecision",
      "promotionRecall",
      "scopeAccuracy",
      "typeAccuracy",
      "duplicateRate",
      "archiveRegret",
      "graveyardIndex",
      "bySource",
      "activeSetGrowth",
    ])
      assert.ok(metric in warm.metrics, metric);
    assert.ok(warm.metrics.promotionRecall > 0);
    assert.ok(warm.metrics.activeSetGrowth.length > ledgers.length);
    const serialized = JSON.stringify(warm);
    assert.ok(!serialized.includes("Remember") && !serialized.includes("Ignore all previous"));
  }));
test("archive_regret_counts_archived_items_later_needed", () =>
  temporary(async (cache) => {
    const ledgers = synthLedgers({ personas: 1, projects: 1, sessions: 5, seed: 1 });
    // Only session 1 teaches facts; session 5 needs them, after idle scope sessions.
    for (let i = 1; i < ledgers.length; i++) {
      ledgers[i].entries = [];
      ledgers[i].manifest.labels = [];
      ledgers[i].manifest.probes = i < 4 ? [] : [{ labelId: "p0-j0-s1-fact", query: "deploy region" }];
    }
    const result = await replayLedgers({
      ledgers,
      cache,
      offline: true,
      policy: { promote: { minScore: 0 }, lifecycle: { archive: { graceSessions: 0, retrievalBelow: 0, storageBelow: 100 } } },
    });
    assert.ok(result.counts.archived > 0);
    assert.equal(result.metrics.archiveRegret, 1 / result.counts.archived);
  }));

test("full_replay_is_warm_under_sixty_seconds", () =>
  temporary(async (cache) => {
    const ledgers = synthLedgers();
    const options = { ledgers, cache, offline: true, policy: { promote: { minScore: 0 } } };
    const cold = await replayLedgers(options);
    assert.equal(cold.calls.extractor, 96);
    assert.ok(cold.metrics.archiveRegret === null || cold.metrics.archiveRegret === 0, "no archived note is probed later");
    const start = performance.now();
    const warm = await replayLedgers({
      ...options,
      onModelCall: () => {
        throw new Error("unexpected model call");
      },
    });
    assert.ok(performance.now() - start < 60000);
    assert.equal(warm.calls.cacheHits, 96);
    assert.equal(warm.calls.extractor, 0);
    assert.deepEqual(warm.metrics, cold.metrics);
  }));
test("capacity_replay_is_deterministic_and_warm_under_eviction_ties", () =>
  temporary(async (cache) => {
    const ledgers = synthLedgers();
    const capacity = Object.fromEntries(["user", "agent", "project"].map((scope) => [scope, { notes: 2 }]));
    const options = { ledgers, cache, offline: true, policy: { promote: {}, lifecycle: { capacity } } };
    const cold = await replayLedgers(options);
    assert.ok(cold.counts.archived > 0);
    const warm = await replayLedgers(options);
    assert.equal(warm.calls.extractor, 0, "random note ids must not reorder eviction ties");
    assert.deepEqual(warm.metrics, cold.metrics);
    assert.deepEqual(warm.counts, cold.counts);
  }));

test("replay_caches_injected_model_client_and_separates_models", () =>
  temporary(async (cache) => {
    const { providerToolCall, toolCallContent, providerDone } = await import("@arnilo/prism");
    const { mockExtraction } = await import("./replay.mjs");
    let calls = 0;
    const client = {
      model: { provider: "scripted", model: "extractor" },
      async *generate(request) {
        calls++;
        yield providerToolCall(toolCallContent("x", "record_notes", mockExtraction(JSON.parse(request.messages[1].content[0].text))));
        yield providerDone();
      },
    };
    const options = {
      cache,
      client,
      ledgers: synthLedgers({ personas: 1, projects: 1, sessions: 2 }),
      policy: { promote: { minScore: 0 } },
    };
    await replayLedgers(options);
    assert.equal(calls, 2);
    await replayLedgers(options);
    assert.equal(calls, 2);
    await replayLedgers({ ...options, modelId: "scripted/other" });
    assert.equal(calls, 4);
    // A cache miss with no client is a failed pass, reported rather than thrown (plan 188.10 Task 5):
    // the run completes with every pass naming the reason and nothing promoted.
    const missed = await replayLedgers({ ...options, client: undefined, modelId: "missing/model" });
    assert.deepEqual(
      missed.passes.map((pass) => pass.reasonCode),
      ["model_call_failed", "model_call_failed"],
      "the missing client is reported, never silently an empty write",
    );
    assert.equal(missed.counts.promoted, 0);
  }));
test("recorded_om_ids_remain_valid_and_shared_scope_identity_survives", () =>
  temporary(async (dir) => {
    const { foldObservationalMemoryLedger } = await import("@arnilo/prism-memory-system");
    const { loadLedgers } = await import("./io.mjs");
    const synthetic = synthLedgers({ personas: 1, projects: 1, sessions: 2 });
    for (const ledger of synthetic)
      await recordLedger({
        store: createMemorySessionStore(ledger.entries),
        session: ledger.manifest.session,
        persona: "person",
        project: "repo",
        consent: true,
        out: dir,
      });
    const recorded = await loadLedgers(dir);
    assert.equal(recorded[0].manifest.persona, recorded[1].manifest.persona);
    assert.equal(recorded[0].manifest.project, recorded[1].manifest.project);
    for (const ledger of recorded) {
      const folded = foldObservationalMemoryLedger(ledger.entries);
      assert.ok(folded.observations.length > 0);
      assert.ok(folded.reflections.length > 0);
      assert.ok(folded.taskState);
    }
  }));

test("replay_counts_wrong_scope_and_type_against_gold", () =>
  temporary(async (cache) => {
    const { providerToolCall, toolCallContent, providerDone } = await import("@arnilo/prism");
    const { mockExtraction } = await import("./replay.mjs");
    const client = {
      model: { provider: "scripted", model: "wrong-scope" },
      async *generate(request) {
        const output = mockExtraction(JSON.parse(request.messages[1].content[0].text));
        for (const note of output.notes)
          if (note.kind === "preference") {
            note.scope = "project";
            note.kind = "fact";
          }
        yield providerToolCall(toolCallContent("x", "record_notes", output));
        yield providerDone();
      },
    };
    const report = await replayLedgers({
      cache,
      client,
      ledgers: synthLedgers({ personas: 1, projects: 1, sessions: 1 }),
      policy: { promote: { minScore: 0 } },
    });
    assert.ok(report.metrics.promotionPrecision < 1);
    assert.ok(report.metrics.scopeAccuracy < 1);
    assert.ok(report.metrics.typeAccuracy < 1);
    assert.equal(report.metrics.bySource.explicit.promotionPrecision, 0);
  }));
test("replay_refuses_unconsented_or_tampered_ledgers_and_unknown_policy", () =>
  temporary(async (cache) => {
    const { loadLedgers, writeLedger } = await import("./io.mjs");
    const { writeFile } = await import("node:fs/promises");
    const ledgers = synthLedgers({ personas: 1, projects: 1, sessions: 1 });
    await assert.rejects(replayLedgers({ ledgers, offline: true, cache, policy: { typo: true } }), /not allowed/);
    await assert.rejects(replayLedgers({ ledgers, offline: true, cache, policy: { promote: { minScore: "invalid" } } }));
    await assert.rejects(replayLedgers({ ledgers, offline: true, cache, policy: { promote: { weights: { typo: 1 } } } }));
    const path = await writeLedger(ledgers[0], join(cache, "ledgers"));
    await writeFile(path, `${await readFile(path, "utf8")}\n`);
    await assert.rejects(loadLedgers(join(cache, "ledgers")), /Integrity/);
    ledgers[0].manifest.source = "recorded";
    await assert.rejects(replayLedgers({ ledgers, offline: true, cache }), /Manifest/);
  }));

test("warm_live_policy_cache_needs_no_credentials_or_provider_discovery", () =>
  temporary(async (cache) => {
    const { providerToolCall, toolCallContent, providerDone } = await import("@arnilo/prism");
    const { mockExtraction } = await import("./replay.mjs");
    const client = {
      model: { provider: "opencode-go", model: "cached-fixture" },
      async *generate(request) {
        yield providerToolCall(toolCallContent("x", "record_notes", mockExtraction(JSON.parse(request.messages[1].content[0].text))));
        yield providerDone();
      },
    };
    const options = {
      cache,
      ledgers: synthLedgers({ personas: 1, projects: 1, sessions: 1 }),
      policy: { promote: { minScore: 0, model: "opencode-go/cached-fixture" } },
    };
    await replayLedgers({ ...options, client });
    const report = await replayLedgers({
      ...options,
      onModelCall: () => {
        throw new Error("provider discovery must stay lazy");
      },
    });
    assert.equal(report.calls.extractor, 0);
    assert.equal(report.calls.cacheHits, 1);
    assert.equal(report.inputTokens, 0);
    await assert.rejects(replayLedgers({ ...options, maxInputTokens: 0 }), /TokenCeiling/);
  }));
test("live_replay_accounting_fails_closed_for_missing_usage_and_token_ceiling", () =>
  temporary(async (dir) => {
    const { writeFile } = await import("node:fs/promises");
    const { replayUsage } = await import("./replay.mjs");
    const usageLog = join(dir, "usage.jsonl");
    let drained = 0;
    const proxies = [
      {
        usageLog,
        proxy: {
          drain: async () => {
            drained++;
          },
        },
      },
    ];
    await writeFile(usageLog, `${JSON.stringify({ status: 200, inputTokens: 12, rawUsage: { prompt_tokens: 12 } })}\n`);
    assert.equal(await replayUsage(proxies, 20), 12);
    await assert.rejects(replayUsage(proxies, 10), /TokenCeiling/);
    await writeFile(usageLog, `${JSON.stringify({ status: 200, inputTokens: 0 })}\n`);
    await assert.rejects(replayUsage(proxies, 20), /UsageMissing/);
    await writeFile(usageLog, `${JSON.stringify({ status: 200, inputTokens: null, rawUsage: { prompt_tokens: 12 } })}\n`);
    await assert.rejects(replayUsage(proxies, 20), /UsageMissing/);
    assert.equal(drained, 4);
  }));

test("replay_historical_scope_verification_and_reflection_variants_use_actual_paths", () =>
  temporary(async (cache) => {
    const ledgers = synthLedgers({ personas: 2, projects: 2, sessions: 4, seed: 7 });
    const base = { ledgers, offline: true, cache, policy: { promote: { minScore: 0 }, lifecycle: { archive: { graceSessions: 100 } } } };
    const baseline = await replayLedgers(base);
    const flat = await replayLedgers({ ...base, variants: ["lifecycle.scope=flat"] });
    assert.equal(flat.variants[0], "lifecycle.scope=flat");
    assert.equal(new Set(flat.metrics.activeSetGrowth.map((row) => row.scope)).size, 2);
    assert.ok(new Set(baseline.metrics.activeSetGrowth.map((row) => row.scope)).size > 2);
    const retrieval = await replayLedgers({ ...base, variants: ["lifecycle.verification=retrieval"] });
    assert.ok(retrieval.counts.uses > baseline.counts.uses);
    const reflections = await replayLedgers({ ...base, variants: ["lifecycle.promotion=every-reflection"] });
    assert.equal(reflections.calls.extractor, 0);
    assert.ok(reflections.counts.promoted > 0);
    assert.ok(reflections.passes.every((pass) => pass.historicalReflections !== undefined));
    assert.ok(reflections.limitations.some((text) => text.includes("fact")));
    await assert.rejects(replayLedgers({ ...base, variants: ["lifecycle.scope=unknown"] }));
  }));
