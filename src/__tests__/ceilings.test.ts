import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  createAgent,
  createMemorySessionStore,
  createMemoryToolEffectStore,
  createSessionEntry,
  DEFAULT_MAX_BRANCH_PAGES,
  definePackage,
  getSessionBranchEntries,
  HARD_RUN_LIMITS,
  type PackageAPI,
  providerDone,
  providerTextDelta,
  resolveCeilings,
  resolveRunLimits,
  SESSION_BRANCH_READ_LIMIT_CODE,
  SessionBranchReadLimitError,
  type SessionEntry,
  type SessionStore,
  type Skill,
} from "../index.js";
import { skillMessages } from "../skill-disclosure.js";
import { toolEffectArgumentsHash } from "../tool-effects.js";
import { parseAgentRunState, runStateBounds } from "../agent-run-state.js";
import { mockProvider } from "../testing/index.js";

const MiB = 1024 * 1024;
const model = { provider: "mock", model: "demo" } as const;
const provider = () => mockProvider([[providerTextDelta("ok"), providerDone()]]);

/** A store whose `readBranchPath` answers one entry per page: the paging reader first-party stores never are. */
function pagingStore(): SessionStore {
  const store = createMemorySessionStore();
  return {
    ...store,
    async readBranchPath(query) {
      const full = await store.readBranchPath!({ ...query, cursor: undefined });
      const index = query.cursor ? Number(query.cursor) : 0;
      return {
        items: full.items.slice(index, index + 1),
        ...(index + 1 < full.items.length ? { nextCursor: String(index + 1) } : {}),
      };
    },
  };
}

describe("ceilings (plan 239 Task 4)", () => {
  it("default_ceilings_equal_the_old_constants", () => {
    assert.deepEqual(
      { ...resolveCeilings() },
      {
        maxRequestBytes: 64 * MiB,
        maxResponseBytes: 64 * MiB,
        runStateBytes: 1 * MiB,
        pendingDecisions: 128,
        stickyDecisions: 64,
        pendingSteers: 8,
        pendingSteerBytes: 64 * 1024,
        snapshotCacheTtlMs: 30_000,
        skillInstructionBytes: 256 * 1024,
        stateValueBytes: 64 * 1024,
        stateLogEntries: 10_000,
        externalStateEntries: 10_000,
        externalStateBytes: 8 * MiB,
        branchReadPages: 64,
        toolConcurrency: 16,
      },
    );
    assert.equal(resolveCeilings().maxResponseBytes, HARD_RUN_LIMITS.maxResponseBytes);
    assert.equal(resolveCeilings().branchReadPages, DEFAULT_MAX_BRANCH_PAGES);
    assert.ok(Object.isFrozen(resolveCeilings()));
    // The shipped run defaults are unchanged.
    const limits = resolveRunLimits();
    assert.equal(limits.maxResponseBytes, 8 * MiB);
    assert.equal(limits.maxRunStateBytes, 256 * 1024);
  });

  it("ceilings_reject_null_unknown_keys_and_non_integers", () => {
    for (const bad of [{ maxResponseBytes: null }, { maxResponseBytes: 0 }, { runStateBytes: 1.5 }, { maxTurns: 5 }]) {
      assert.throws(() => resolveCeilings(bad as never), TypeError);
    }
    // The message names the ceiling, never the value.
    assert.throws(
      () => resolveCeilings({ maxResponseBytes: -987654 }),
      (error: Error) => !error.message.includes("987654"),
    );
  });

  it("host_can_raise_the_response_byte_ceiling", async () => {
    const limits = { maxResponseBytes: 100 * MiB };
    await assert.rejects(
      createAgent({ model, packages: [provider()], limits }),
      /maxResponseBytes must be a positive safe integer at most/,
    );
    const agent = await createAgent({ model, packages: [provider()], limits, ceilings: { maxResponseBytes: 128 * MiB } });
    const result = await (await agent.session()).run("hi");
    assert.equal(result.status, "completed");
    // The run layer may also ask for a value up to the agent's ceiling, and no further.
    assert.equal((await (await agent.session()).run("hi", { limits: { maxResponseBytes: 120 * MiB } })).status, "completed");
    await assert.rejects((await agent.session()).run("hi", { limits: { maxResponseBytes: 129 * MiB } }), /ceilings\.maxResponseBytes/);
    // Lowering a ceiling below the shipped default lowers the default with it.
    assert.equal(resolveRunLimits(undefined, undefined, resolveCeilings({ maxResponseBytes: 1024 })).maxResponseBytes, 1024);
  });

  it("run_options_cannot_set_ceilings", async () => {
    const agent = await createAgent({ model, packages: [provider()] });
    const session = await agent.session();
    await assert.rejects(session.run("hi", { ceilings: { maxResponseBytes: 128 * MiB } } as never), /ceilings/);
    // The run layer cannot pass the agent's ceiling through its own limits either.
    await assert.rejects(session.run("hi", { limits: { maxResponseBytes: 65 * MiB } }), /ceilings\.maxResponseBytes/);
    await assert.rejects(session.run("hi", { limits: { maxRunStateBytes: 2 * MiB } }), /ceilings\.runStateBytes/);
  });

  it("package_config_cannot_raise_a_kernel_ceiling", async () => {
    const seen: { api?: PackageAPI<never>; write?: unknown } = {};
    const probe = definePackage({
      name: "probe",
      version: "1.0.0",
      requires: { api: 1 },
      setup(prism) {
        seen.api = prism as PackageAPI<never>;
        try {
          (prism.ceilings as { skillInstructionBytes: number }).skillInstructionBytes = 10 * MiB;
        } catch (error) {
          seen.write = error;
        }
        // A package skill above the agent's ceiling fails the load closed.
        prism.skills.register({ name: "big", description: "big", instructions: "x".repeat(300 * 1024) });
      },
    });
    await assert.rejects(createAgent({ model, packages: [provider(), probe] }), /ceilings\.skillInstructionBytes/);
    assert.ok(seen.write instanceof TypeError, "prism.ceilings is frozen");
    assert.equal(seen.api?.ceilings.skillInstructionBytes, 256 * 1024);
    // Package config has no route to a kernel ceiling: an unknown key fails closed.
    await assert.rejects(
      createAgent({ model, packages: [provider(), probe], packageConfig: { probe: { ceilings: { skillInstructionBytes: 10 * MiB } } } }),
    );
    // Only the host raises it.
    const agent = await createAgent({ model, packages: [provider(), probe], ceilings: { skillInstructionBytes: 512 * 1024 } });
    assert.equal(seen.api?.ceilings.skillInstructionBytes, 512 * 1024);
    assert.ok(agent.skills.some((skill) => skill.name === "big"));
  });

  it("a_late_config_write_cannot_raise_a_bound_ceiling", async () => {
    // A model or tool never reaches `AgentConfig`; even a direct write after `createAgent` leaves the bound value.
    const agent = await createAgent({ model, packages: [provider()] });
    (agent.config as { ceilings?: unknown }).ceilings = { snapshotCacheTtlMs: 120_000 };
    await assert.rejects(agent.session({ snapshotCacheTtlMs: 60_000 }), /ceilings\.snapshotCacheTtlMs \(30000\)/);
    const raised = await createAgent({ model, packages: [provider()], ceilings: { snapshotCacheTtlMs: 120_000 } });
    await raised.session({ snapshotCacheTtlMs: 60_000 });
  });

  it("branch_read_past_the_page_limit_throws_not_truncates", async () => {
    const store = pagingStore();
    const entries: SessionEntry[] = ["a", "b", "c"].map((id, index, all) =>
      createSessionEntry({ id, sessionId: "s", kind: "label", label: id, ...(index > 0 ? { parentId: all[index - 1] } : {}) }),
    );
    for (const entry of entries) await store.append(entry);
    const reader = (query: Parameters<NonNullable<SessionStore["readBranchPath"]>>[0]) => store.readBranchPath!(query);
    const read = await getSessionBranchEntries(reader, { sessionId: "s", leafId: "c" }, { maxPages: 3 });
    assert.deepEqual(
      read.map((entry) => entry.id),
      ["a", "b", "c"],
    );
    await assert.rejects(
      getSessionBranchEntries(reader, { sessionId: "s", leafId: "c" }, { maxPages: 2 }),
      (error: unknown) =>
        error instanceof SessionBranchReadLimitError && error.code === SESSION_BRANCH_READ_LIMIT_CODE && error.maxPages === 2,
    );

    // Through the agent: a session opened under a lower ceiling fails closed instead of reading short.
    const writer = await createAgent({ model, packages: [provider()], slots: { store } });
    const session = await writer.session({ id: "long", create: true });
    await session.run("hi");
    assert.ok((await session.entries()).length >= 2);
    const narrow = await createAgent({ model, packages: [provider()], slots: { store }, ceilings: { branchReadPages: 1 } });
    await assert.rejects(narrow.session({ id: "long" }), SessionBranchReadLimitError);
  });

  it("durable_state_load_fails_closed_above_a_lowered_ceiling", () => {
    const state = {
      schemaVersion: 1,
      agentId: "a",
      definitionRevision: "r",
      fingerprint: "f",
      runId: "run",
      sessionId: "s",
      status: "running",
      counters: {},
      padding: "x".repeat(4096),
    };
    assert.equal(parseAgentRunState(state).runId, "run");
    assert.throws(
      () => parseAgentRunState(state, undefined, runStateBounds(resolveCeilings({ runStateBytes: 1024 }))),
      /exceeds 1024 bytes/,
    );
  });

  it("skill_catalog_bounds_are_host_configurable", async () => {
    const skills: Skill[] = ["a", "b", "c"].map((name) => ({ name, description: `${name} ${"d".repeat(40)}`, instructions: name }));
    const text = (catalog?: { maxEntries?: number; maxDescriptionBytes?: number }) =>
      skillMessages(skills, { disclosure: "progressive", catalog })
        .flatMap((message) => message.content)
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("\n");
    assert.match(text(), /- c: c d{40}/);
    const bounded = text({ maxEntries: 2, maxDescriptionBytes: 4 });
    assert.match(bounded, /- a: a…\n/);
    assert.doesNotMatch(bounded, /- c:/);
    assert.match(bounded, /1 more skills are installed/);
    await assert.rejects(createAgent({ model, packages: [provider()], skills: { catalog: { maxEntries: 0 } } }), /maxEntries/);
  });

  it("memory_tool_effect_store_limits_are_host_set", async () => {
    const base = {
      ownership: { tenantId: "t" },
      sessionId: "s",
      runId: "r",
      toolCallId: "c",
      toolName: "t",
      argumentsHash: toolEffectArgumentsHash({}),
    };
    const shipped = createMemoryToolEffectStore();
    await assert.rejects(shipped.begin({ ...base, key: "k1", claimTtlMs: 2 * 60 * 60_000 }), /claim TTL/);
    const raised = createMemoryToolEffectStore({ limits: { maxClaimTtlMs: 4 * 60 * 60_000 } });
    assert.equal((await raised.begin({ ...base, key: "k1", claimTtlMs: 2 * 60 * 60_000 })).outcome, "acquired");
    assert.throws(() => createMemoryToolEffectStore({ limits: { maxAttempts: 0 } }), TypeError);
  });

  it("tool_concurrency_ceiling_is_host_raisable", async () => {
    await assert.rejects(createAgent({ model, packages: [provider()], tools: { concurrency: 32 } }), /from 1 to 16/);
    await createAgent({ model, packages: [provider()], tools: { concurrency: 32 }, ceilings: { toolConcurrency: 32 } });
  });
});
