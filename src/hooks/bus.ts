import type { AgentEvent, JsonObject, JsonValue } from "../contracts.js";
import type { SessionContext } from "../session-context.js";
import { errorToErrorInfo, redactSecrets } from "../redaction.js";
import { type DecideCombination, HOOK_CATALOG, HOOK_COMBINATION } from "./catalog.js";
import { packageEventFor, RAW_EMIT } from "./emit.js";
import { HookError, HookRejectedError, UnknownHookError } from "./errors.js";
import { jsonEqual } from "./json.js";
import type {
  AroundHook,
  AroundHookName,
  DecideHook,
  DecideHookName,
  HookBus,
  HookBusOptions,
  HookContext,
  HookDecision,
  HookKind,
  HookName,
  HookOptions,
  HookPayload,
  HookRegistrar,
  HookRegistrationInfo,
  HookRejection,
  HookResult,
  HookTransformResult,
  ObserveHook,
  ObserveHookName,
  TransformHook,
  TransformHookName,
} from "./types.js";

/** Bounded registration id suffix, mirroring the deterministic-turn id alphabet. */
const REGISTRATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

interface Registration {
  readonly name: HookName;
  readonly owner: string;
  readonly id: string;
  readonly priority: number;
  readonly onError: "ignore" | undefined;
  readonly seq: number;
  readonly handler: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRejection(value: unknown): value is HookRejection {
  return isRecord(value) && typeof value.__prismHookRejection === "string";
}

function combine(name: DecideHookName, values: readonly unknown[], payload?: unknown): unknown {
  const rule: DecideCombination = HOOK_COMBINATION[name];
  switch (rule) {
    case "any-stop":
      return values.find((value) => isRecord(value) && typeof value.stop === "string");
    case "first-continue":
      // A malformed `continue` (missing or empty reason) is treated as no continuation, so a
      // broken handler ends the run cleanly instead of queueing an undeliverable steer.
      return values.find(
        (value) =>
          isRecord(value) && isRecord(value.continue) && typeof value.continue.reason === "string" && value.continue.reason.length > 0,
      );
    case "any-compact":
      return values.find((value) => isRecord(value) && value.compact === true);
    case "tool-call": {
      let ask: unknown;
      let respond: unknown;
      let rewrite: Record<string, JsonValue> | undefined;
      for (const value of values) {
        if (!isRecord(value)) continue;
        if (typeof value.deny === "string") return { deny: value.deny };
        if (typeof value.ask === "string" && ask === undefined) ask = value;
        if (isRecord(value.rewrite)) {
          rewrite ??= {};
          for (const [key, next] of Object.entries(value.rewrite)) {
            // Two rewrites that set one key to different values are unauditable by load order: fail closed.
            if (key in rewrite && !jsonEqual(rewrite[key] as JsonValue, next as JsonValue)) {
              return { deny: `rewrite_conflict: ${key}` };
            }
            rewrite[key] = next as JsonValue;
          }
        }
        if (isRecord(value.respond) && respond === undefined) respond = value;
      }
      // A rewrite equal to this round's input changes nothing: drop it, so the round's `ask`/`respond`
      // is not hidden by the rewriter's own no-op on the already-rewritten arguments (plan 177 Task 2).
      const input = isRecord(payload) && isRecord(payload.args) ? (payload.args as JsonObject) : undefined;
      if (rewrite !== undefined && input !== undefined && jsonEqual(rewrite, input)) rewrite = undefined;
      if (rewrite !== undefined) return { rewrite };
      if (ask !== undefined) return ask;
      if (respond !== undefined) return respond;
      return undefined;
    }
  }
}

/**
 * Kernel-internal hook bus. Registrations go through `registrar(owner)`: the owner is a property of
 * the registrar the kernel hands out, never of a registration option, so a package cannot claim
 * another owner's name (plan 146 Task 3).
 */
export function createHookBus(options: HookBusOptions = {}): HookBus {
  const secrets = options.secrets ?? [];
  const byName = new Map<HookName, Registration[]>();
  const sortedCache = new Map<HookName, readonly Registration[]>();
  let seq = 0;

  const optionError = (owner: string, name: string, message: string) =>
    new HookError(message, { owner, hook: name, code: "ERR_PRISM_HOOK_OPTION" });

  const messageOf = (error: unknown): string => redactSecrets(error instanceof Error ? error.message : String(error), secrets);

  const emitError = (name: HookName, throwingOwner: string, error: unknown, context: HookContext): void => {
    options.onEvent?.({
      type: "hook.error",
      sessionId: context.sessionId,
      runId: context.runId,
      hook: name,
      owner: throwingOwner,
      error: errorToErrorInfo(error, secrets),
    });
  };

  const contextFor = (payload: unknown): HookContext => {
    const source = isRecord(payload) ? payload : {};
    return {
      sessionId: typeof source.sessionId === "string" ? source.sessionId : "",
      runId: typeof source.runId === "string" ? source.runId : "",
      // Replaced per registration by `viewOf`, which knows the owner; a bare context emits nothing.
      emit: () => undefined,
      reject: (reason: string): HookRejection => ({ __prismHookRejection: redactSecrets(reason, secrets) }),
    };
  };

  const sorted = (name: HookName): readonly Registration[] => {
    const cached = sortedCache.get(name);
    if (cached) return cached;
    const list = [...(byName.get(name) ?? [])].sort((a, b) => b.priority - a.priority || a.seq - b.seq);
    sortedCache.set(name, list);
    return list;
  };

  const entry = (name: string): { kind: HookKind } | undefined => (HOOK_CATALOG as Record<string, { kind: HookKind } | undefined>)[name];

  const register = (owner: string, name: HookName, handler: unknown, hookOptions: HookOptions | undefined): void => {
    const catalogEntry = entry(name);
    if (!catalogEntry) throw new UnknownHookError(name);
    if (typeof handler !== "function") throw optionError(owner, name, "hook handler must be a function");
    const priority = hookOptions?.priority;
    if (priority !== undefined && (typeof priority !== "number" || !Number.isFinite(priority))) {
      throw optionError(owner, name, "hook priority must be a finite number");
    }
    if (hookOptions?.onError !== undefined && (catalogEntry.kind !== "transform" || hookOptions.onError !== "ignore")) {
      throw optionError(owner, name, 'onError: "ignore" is only valid on transform hooks');
    }
    const suffix = hookOptions?.id;
    if (suffix !== undefined && (typeof suffix !== "string" || !REGISTRATION_ID.test(suffix))) {
      throw optionError(owner, name, "hook id must be a bounded id (1-64 chars: letters, digits, . _ : -)");
    }
    const id = `${owner}:${name}${suffix ? `#${suffix}` : ""}`;
    const list = byName.get(name) ?? [];
    // Unnamed registrations may repeat (a package can add several handlers). An explicit id is unique
    // per owner and hook; the id embeds the owner, so two owners may share a suffix.
    if (suffix !== undefined && list.some((registration) => registration.id === id)) {
      throw new HookError(`Duplicate hook registration id: ${id}`, {
        owner,
        hook: name,
        code: "ERR_PRISM_HOOK_DUPLICATE_ID",
      });
    }
    list.push({ name, owner, id, priority: priority ?? 0, onError: hookOptions?.onError, seq: seq++, handler });
    byName.set(name, list);
    sortedCache.delete(name);
  };

  const registrars = new Map<string, HookRegistrar>();
  const registrar = (owner: string): HookRegistrar => {
    if (typeof owner !== "string" || owner.length === 0) {
      throw new HookError("hook owner must be a non-empty string", { owner: String(owner), hook: "", code: "ERR_PRISM_HOOK_OPTION" });
    }
    let bound = registrars.get(owner);
    if (!bound) {
      bound = { on: (name, handler, hookOptions) => register(owner, name, handler, hookOptions) };
      registrars.set(owner, bound);
    }
    return bound;
  };

  const remove = (id: string): boolean => {
    let removed = false;
    for (const [name, list] of byName) {
      const kept = list.filter((registration) => registration.id !== id);
      if (kept.length === list.length) continue;
      removed = true;
      if (kept.length === 0) byName.delete(name);
      else byName.set(name, kept);
      sortedCache.delete(name);
    }
    return removed;
  };

  /** Per-dispatch, per-owner context views. */
  type Views = Map<string, HookContext>;

  const dispatchers = (sessionFor: ((owner: string) => SessionContext) | undefined) => {
    const viewsFor = (): Views => new Map();
    /** Each registration gets a context whose `emit` is a `package.event` owned by that registration. */
    const viewOf = (views: Views, base: HookContext, owner: string): HookContext => {
      let view = views.get(owner);
      if (!view) {
        view = {
          ...base,
          emit: (name, data) => options.onEvent?.(packageEventFor(owner, base.sessionId, base.runId, name, data)),
          ...(sessionFor ? { session: sessionFor(owner) } : {}),
        };
        Object.defineProperty(view, RAW_EMIT, { value: (event: AgentEvent) => options.onEvent?.(event) });
        views.set(owner, view);
      }
      return view;
    };

    const observe = <N extends ObserveHookName>(name: N, payload: HookPayload<N>): void => {
      if (!entry(name)) throw new UnknownHookError(name);
      const list = sorted(name);
      if (list.length === 0) return;
      const context = contextFor(payload);
      const views = viewsFor();
      for (const registration of list) {
        try {
          const result = (registration.handler as ObserveHook<unknown>)(payload, viewOf(views, context, registration.owner));
          if (result && typeof (result as Promise<unknown>).then === "function") {
            (result as Promise<unknown>).catch((error) => emitError(name, registration.owner, error, context));
          }
        } catch (error) {
          emitError(name, registration.owner, error, context);
        }
      }
    };

    const transform = async <N extends TransformHookName>(name: N, value: HookPayload<N>): Promise<HookTransformResult<N>> => {
      if (!entry(name)) throw new UnknownHookError(name);
      const list = sorted(name);
      if (list.length === 0) return value as HookTransformResult<N>;
      const context = contextFor(value);
      const views = viewsFor();
      let current: unknown = value;
      for (const registration of list) {
        try {
          const result = await (registration.handler as TransformHook<unknown, unknown>)(
            current,
            viewOf(views, context, registration.owner),
          );
          if (result === undefined) continue;
          if (isRejection(result)) throw new HookRejectedError(result.__prismHookRejection, registration.owner, name);
          current = result;
        } catch (error) {
          if (error instanceof HookRejectedError) throw error;
          if (registration.onError === "ignore") {
            emitError(name, registration.owner, error, context);
            continue;
          }
          throw new HookError(messageOf(error), { owner: registration.owner, hook: name });
        }
      }
      return current as HookTransformResult<N>;
    };

    const decide = async <N extends DecideHookName>(name: N, payload: HookPayload<N>): Promise<HookDecision<N> | undefined> => {
      if (!entry(name)) throw new UnknownHookError(name);
      const list = sorted(name);
      if (list.length === 0) return undefined;
      const context = contextFor(payload);
      const views = viewsFor();
      const values: unknown[] = [];
      for (const registration of list) {
        try {
          const result = await (registration.handler as DecideHook<unknown, unknown>)(payload, viewOf(views, context, registration.owner));
          if (result !== undefined) values.push(result);
        } catch (error) {
          if (name === "tool.call") {
            return { deny: `${registration.owner}:${name}: ${messageOf(error)}` } as unknown as HookDecision<N>;
          }
          throw new HookError(messageOf(error), { owner: registration.owner, hook: name });
        }
      }
      return combine(name, values, payload) as HookDecision<N> | undefined;
    };

    const around = async <N extends AroundHookName>(
      name: N,
      payload: HookPayload<N>,
      terminal: (value: HookPayload<N>) => Promise<HookResult<N>>,
    ): Promise<HookResult<N>> => {
      if (!entry(name)) throw new UnknownHookError(name);
      const context = contextFor(payload);
      const views = viewsFor();
      const registrations = sorted(name);
      const dispatch = async (index: number, value: unknown): Promise<unknown> => {
        const registration = registrations[index];
        if (!registration) return terminal(value as HookPayload<N>);
        let calledNext = false;
        const next = async (nextValue: unknown): Promise<unknown> => {
          if (calledNext) {
            throw new HookError(`Hook ${registration.owner}:${name} called next() more than once`, {
              owner: registration.owner,
              hook: name,
              code: "ERR_PRISM_HOOK_NEXT_REENTRY",
            });
          }
          calledNext = true;
          return dispatch(index + 1, nextValue);
        };
        try {
          return await (registration.handler as AroundHook<unknown, unknown>)(value, next, viewOf(views, context, registration.owner));
        } catch (error) {
          if (error instanceof HookError || error instanceof HookRejectedError) throw error;
          throw new HookError(messageOf(error), { owner: registration.owner, hook: name });
        }
      };
      return (await dispatch(0, payload)) as HookResult<N>;
    };

    return { observe, transform, decide, around };
  };

  const registrations = (): readonly HookRegistrationInfo[] =>
    [...byName.keys()]
      .flatMap((name) => sorted(name))
      .map((registration) => ({
        name: registration.name,
        kind: entry(registration.name)?.kind ?? "observe",
        owner: registration.owner,
        id: registration.id,
        priority: registration.priority,
      }));

  const has = (name: HookName): boolean => (byName.get(name)?.length ?? 0) > 0;

  const removeOwner = (owner: string): number => {
    let removed = 0;
    for (const [name, list] of byName) {
      const kept = list.filter((registration) => registration.owner !== owner);
      if (kept.length === list.length) continue;
      removed += list.length - kept.length;
      if (kept.length === 0) byName.delete(name);
      else byName.set(name, kept);
      sortedCache.delete(name);
    }
    return removed;
  };

  const shared = { registrar, remove, removeOwner, registrations, has };
  const unbound = {
    ...shared,
    ...dispatchers(undefined),
    bound: (sessionFor: (owner: string) => SessionContext): HookBus => ({ ...shared, ...dispatchers(sessionFor), bound: unbound.bound }),
  };
  return unbound;
}
