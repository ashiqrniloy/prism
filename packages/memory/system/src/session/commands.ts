/**
 * The package's session commands: `memory:session` (toggle), `memory:session:model` (worker models),
 * `memory:session:status` (counts), `memory:session:view` (the rendered ledger), and `memory:scope` (the episode scope).
 *
 * Every command acts on `context.session`; without one it answers with a named refusal instead of
 * throwing, so a host listing commands without a session (conformance, `doctor`) sees data, not a crash.
 */
import type {
  JsonObject,
  JsonSchema,
  JsonValue,
  ModelRef,
  PackageCommand,
  PackageCommandContext,
  SessionContext,
  SessionLog,
  SessionState,
} from "@arnilo/prism";

import type { ResolvedMemorySystemConfig } from "./config.js";
import type { ObservationalFlush } from "./flush.js";
import type { ObservationalMemoryLedger } from "./ledger.js";
import { activeObservations, activeWmItems } from "./ledger.js";
import { renderObservationalMemory } from "./render.js";
import type { ScopeStore } from "./scope.js";
import {
  ledgerOf,
  type ObservationalMemoryState,
  readObservationalMemoryState,
  storedModelRef,
  toStoredModelRef,
  writeObservationalMemoryState,
} from "./state.js";

export interface MemoryCommandDeps {
  readonly contextMode?: (session: SessionContext) => Promise<"none" | "own-compaction" | "pinned">;
  readonly log: SessionLog<JsonValue>;
  readonly state: SessionState<JsonObject>;
  readonly config: ResolvedMemorySystemConfig;
  readonly flush: ObservationalFlush;
  readonly scope: ScopeStore;
  /** Emits `memory.session.status` after a toggle. */
  readonly onStatus: (session: SessionContext) => void;
}

const noSession = (name: string) => ({ ok: false, reason: "no_session", text: `${name} needs a session: run it against one.` });

const modelRefSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    stm: {
      description: 'STM worker model: "provider/model" or a model object.',
      anyOf: [{ type: "string" }, { type: "object", additionalProperties: true }],
    },
    wm: {
      description: 'WM worker model: "provider/model" or a model object.',
      anyOf: [{ type: "string" }, { type: "object", additionalProperties: true }],
    },
    reset: {
      type: "boolean",
      description: "Clear the stored worker refs so the session's own model is used again.",
    },
  },
};

export function createObservationalMemoryCommands(deps: MemoryCommandDeps): readonly PackageCommand[] {
  return [toggleCommand(deps), modelCommand(deps), statusCommand(deps), viewCommand(deps), scopeCommand(deps)];
}

function toggleCommand(deps: MemoryCommandDeps): PackageCommand {
  return {
    name: "memory:session",
    description: "Toggle session memory for this session.",
    run: async (_args: JsonObject, context: PackageCommandContext) => {
      const session = context.session;
      if (!session) return noSession("memory:session");
      const current = readObservationalMemoryState(deps.state.get(session));
      const enabled = !current.enabled;
      await deps.state.set(session, writeObservationalMemoryState({ ...current, enabled }));
      deps.onStatus(session);
      return { ok: true, enabled, text: `Session memory ${enabled ? "on" : "off"} for this session.` };
    },
  };
}

function modelCommand(deps: MemoryCommandDeps): PackageCommand {
  return {
    name: "memory:session:model",
    description: "Set the STM and/or WM worker model for this session.",
    args: modelRefSchema,
    run: async (args: JsonObject, context: PackageCommandContext) => {
      const session = context.session;
      if (!session) return noSession("memory:session:model");
      const stm = args.stm as ModelRef | undefined;
      const wm = args.wm as ModelRef | undefined;
      const reset = args.reset === true;
      // Resolve before writing: an unknown provider fails the command and leaves state unchanged.
      if (stm !== undefined) context.agent.models.resolve(stm);
      if (wm !== undefined) context.agent.models.resolve(wm);
      const current = readObservationalMemoryState(deps.state.get(session));
      const next: ObservationalMemoryState = reset
        ? { enabled: current.enabled, ...(current.scope === undefined ? {} : { scope: current.scope }) }
        : {
            ...current,
            ...(stm === undefined ? {} : { stmModel: toStoredModelRef(stm) }),
            ...(wm === undefined ? {} : { wmModel: toStoredModelRef(wm) }),
          };
      await deps.state.set(session, writeObservationalMemoryState(next));
      return {
        ok: true,
        stm: stm ?? storedModelRef(next.stmModel) ?? deps.config.stm.model ?? "session",
        wm: wm ?? storedModelRef(next.wmModel) ?? deps.config.wm.model ?? "session",
      };
    },
  };
}

function statusCommand(deps: MemoryCommandDeps): PackageCommand {
  return {
    name: "memory:session:status",
    description: "Show session-memory counts, thresholds, and pass state for this session.",
    run: async (_args: JsonObject, context: PackageCommandContext) => {
      const session = context.session;
      if (!session) return noSession("memory:session:status");
      const state = readObservationalMemoryState(deps.state.get(session));
      const ledger = ledgerOf(deps.log.entries(session));
      const active = activeObservations(ledger);
      const status = deps.flush.status(session.id);
      const value = {
        enabled: state.enabled,
        contextMode: (await deps.contextMode?.(session)) ?? "none",
        stm: storedModelRef(state.stmModel) ?? deps.config.stm.model ?? "session",
        wm: storedModelRef(state.wmModel) ?? deps.config.wm.model ?? "session",
        observations: {
          recorded: ledger.observations.length,
          dropped: ledger.droppedObservationIds.length,
          tombstoned: Object.keys(ledger.tombstones ?? {}).length,
          active: active.length,
        },
        wmItems: { recorded: ledger.wmItems.length, active: activeWmItems(ledger).length },
        // The latest WM pass's protected records alone exceeded its target (plan 218 Task 3); Rehearsal reads it too.
        ...(ledger.budgetUnmet ? { budgetUnmet: ledger.budgetUnmet } : {}),
        tokens: { activeObservationPool: active.reduce((sum, item) => sum + item.tokenCount, 0) },
        thresholds: {
          triggerTokens: deps.config.stm.triggerTokens,
          wmTriggerTokens: deps.config.wm.triggerTokens,
          wmBatchTokens: deps.config.wm.batchTokens,
          wmTargetRatio: deps.config.wm.targetRatio,
          wmPolicy: deps.config.wm.policy,
          targetTokens: deps.config.rehearsal.targetTokens,
          compactAt: deps.config.context.compactAt,
        },
        scope: scopeStatus(deps.scope, session),
        inFlight: status.inFlight,
        ...(status.lastError === undefined ? {} : { lastError: status.lastError }),
      };
      const text = [
        `Session memory ${state.enabled ? "on" : "off"}: ${active.length} active / ${ledger.observations.length} recorded observations (${ledger.droppedObservationIds.length} dropped), ${activeWmItems(ledger).length} active / ${ledger.wmItems.length} recorded WM items.`,
        `Pass: ${status.inFlight ? "in flight" : "idle"}${status.lastError === undefined ? "" : `; last error: ${status.lastError}`}.`,
        `Episode scope: ${scopeLine(deps.scope.get(session))}.`,
        ...(ledger.budgetUnmet
          ? [
              `WM budget unmet: protected records hold ${ledger.budgetUnmet.protectedTokens} tokens over a ${ledger.budgetUnmet.targetTokens}-token target.`,
            ]
          : []),
      ].join("\n");
      return { ...value, text };
    },
  };
}

function viewCommand(deps: MemoryCommandDeps): PackageCommand {
  return {
    name: "memory:session:view",
    description: "Render this session's session memory.",
    run: (_args: JsonObject, context: PackageCommandContext) => {
      const session = context.session;
      if (!session) return noSession("memory:session:view");
      const ledger: ObservationalMemoryLedger = ledgerOf(deps.log.entries(session));

      const observations = activeObservations(ledger);
      const wmItems = activeWmItems(ledger);
      const text = renderObservationalMemory(wmItems, observations, {
        advertiseRecall: false,
        taskState: ledger.taskState,
        maxTaskStateBytes: deps.config.worker.maxTaskStateBytes,
      });
      return { observations: observations.length, wmItems: wmItems.length, text };
    },
  };
}

const scopeArgs: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    text: { type: "string", description: "The scope text: what the current body of work must achieve, with its later steps." },
    path: {
      type: "string",
      minLength: 1,
      maxLength: 4_096,
      description: "A file the host resolves to text through host.ui; the package never reads it itself.",
    },
    clear: { type: "boolean", description: "Clear the scope, including the config scope, for this session." },
  },
};

/** The scope's hash and size, never its text (the scope is not shown outside WM and Rehearsal requests). */
function scopeStatus(scope: ScopeStore, session: SessionContext): JsonValue {
  const current = scope.get(session);
  return current ? { set: true, hash: current.hash, bytes: current.bytes, at: current.at } : { set: false };
}

function scopeLine(scope: ReturnType<ScopeStore["get"]>): string {
  return scope ? `set (${scope.bytes} bytes, ${scope.hash})` : "none (the episode is the current work)";
}

function scopeCommand(deps: MemoryCommandDeps): PackageCommand {
  return {
    name: "memory:scope",
    description: "Set ({ text } or { path }) or clear ({ clear: true }) this session's episode scope, read by WM and Rehearsal only.",
    args: scopeArgs,
    run: async (args: JsonObject, context: PackageCommandContext) => {
      const session = context.session;
      if (!session) return noSession("memory:scope");
      const forms = ["text", "path", "clear"].filter((key) => args[key] !== undefined);
      if (forms.length !== 1 || (args.clear !== undefined && args.clear !== true))
        return { ok: false, reason: "invalid_args", text: "memory:scope takes exactly one of { text }, { path } or { clear: true }." };
      if (args.clear === true) {
        await deps.scope.clear(session);
        return { ok: true, cleared: true, text: "Episode scope cleared for this session." };
      }
      let text = args.text as string | undefined;
      if (typeof args.path === "string") {
        // The host resolves the path (I11 security): the package never opens a file itself.
        const answer = context.host.ui
          ? await context.host.ui.request({
              kind: "input",
              title: "Episode scope",
              detail: "Answer with the text of this file as the session's episode scope.",
              value: args.path,
              ...(session.id ? { sessionId: session.id } : {}),
            })
          : ({ status: "unavailable" } as const);
        if (answer.status !== "answered" || typeof answer.value !== "string")
          return {
            ok: false,
            reason: "scope_path_unresolved",
            text: `The host did not resolve the scope path (${answer.status}); set { text } instead.`,
          };
        text = answer.value;
      }
      const result = await deps.scope.set(session, text ?? "");
      if (!result.ok) return { ok: false, reason: result.reason, text: result.text };
      return {
        ok: true,
        hash: result.scope.hash,
        bytes: result.scope.bytes,
        text: `Episode scope set for this session (${result.scope.bytes} bytes).`,
      };
    },
  };
}
