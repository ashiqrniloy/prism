/**
 * `@arnilo/prism-extensions/approval` — `deny` | `ask` | `edits` | `auto` over tool effects and roots.
 *
 * One `tool.call` handler, id `@arnilo/prism-extensions/approval:tool.call`. Hard denies from a tool
 * package win in every mode, because any deny wins. A missing `coding.targets` service, or
 * a call it does not report, counts as outside roots.
 *
 * ```ts
 * import approval from "@arnilo/prism-extensions/approval";
 * import toolsCoding from "@arnilo/prism-tools/coding";
 *
 * packages: [toolsCoding({ root }), approval({ mode: "edits" })];
 * ```
 */

import { isAbsolute, relative, resolve } from "node:path";
import {
  definePackage,
  type HookContext,
  type HostUi,
  type JsonValue,
  type PackageAPI,
  type PackageInstance,
  type ToolCallDecision,
  type ToolCallHookPayload,
} from "@arnilo/prism";
import manifest from "../../package.json" with { type: "json" };

import { type ApprovalConfig, type ApprovalMode, type ApprovalRule, approvalConfigSchema } from "./config.js";
import { decideApproval, grantKey } from "./decide.js";

export type { ApprovalConfig, ApprovalMode, ApprovalRule } from "./config.js";
export { approvalConfigSchema } from "./config.js";
export { commandPrefix, decideApproval, grantKey } from "./decide.js";

const PACKAGE = "@arnilo/prism-extensions/approval";

type CodingTargetsService = (
  name: string,
  args: { readonly [key: string]: unknown },
  context?: { readonly sessionId?: string },
) => { readonly paths: readonly string[]; readonly roots: readonly string[] } | undefined;

export interface ApprovalControls {
  getMode(): ApprovalMode;
  setMode(mode: ApprovalMode): void;
  listRules(): readonly ApprovalRule[];
  addRule(rule: ApprovalRule): void;
  removeRule(index: number): ApprovalRule | undefined;
}

interface LiveGate {
  mode: ApprovalMode;
  rules: ApprovalRule[];
  ruleKeys: Set<string>;
  /** Session id → grant keys. The lookup. The store is written only when an always grant is stored. */
  grants: Map<string, Set<string>>;
}

const gates = new WeakMap<PackageInstance, LiveGate>();

function ruleKey(rule: ApprovalRule): string {
  return rule.commandPrefix ? `${rule.tool}\u0000${rule.commandPrefix}` : rule.tool;
}

function liveFrom(config: ApprovalConfig | undefined): LiveGate {
  const rules = [...(config?.rules ?? [])];
  return { mode: config?.mode ?? "ask", rules, ruleKeys: new Set(rules.map(ruleKey)), grants: new Map() };
}

function controlsFor(gate: LiveGate): ApprovalControls {
  return {
    getMode: () => gate.mode,
    setMode: (mode) => {
      gate.mode = mode;
    },
    listRules: () => gate.rules,
    addRule: (rule) => {
      gate.rules.push(rule);
      gate.ruleKeys.add(ruleKey(rule));
    },
    removeRule: (index) => {
      const removed = gate.rules[index];
      if (!removed) return undefined;
      gate.rules.splice(index, 1);
      gate.ruleKeys = new Set(gate.rules.map(ruleKey));
      return removed;
    },
  };
}

function pathInside(path: string, roots: readonly string[]): boolean {
  const target = resolve(path);
  return roots.some((root) => {
    const rel = relative(resolve(root), target);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  });
}

function matched(gate: LiveGate, sessionId: string | undefined, payload: ToolCallHookPayload): boolean {
  const command = typeof payload.args.command === "string" ? payload.args.command : undefined;
  const key = grantKey(payload.name, command);
  if (gate.ruleKeys.has(payload.name) || gate.ruleKeys.has(key)) return true;
  const grants = sessionId ? gate.grants.get(sessionId) : undefined;
  return grants?.has(payload.name) === true || grants?.has(key) === true;
}

function summary(payload: ToolCallHookPayload): string {
  const command = typeof payload.args.command === "string" ? payload.args.command.slice(0, 64) : "";
  return command.length > 0 ? `${payload.name} ${command}` : payload.name;
}

function withTimeout<T>(request: Promise<T>, timeoutMs: number | undefined): Promise<T | { status: "dismissed" }> {
  if (!timeoutMs) return request;
  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => resolvePromise({ status: "dismissed" }), timeoutMs);
    request.then(
      (value) => {
        clearTimeout(timer);
        resolvePromise(value);
      },
      () => {
        clearTimeout(timer);
        resolvePromise({ status: "dismissed" });
      },
    );
  });
}

async function prompt(
  ui: HostUi,
  payload: ToolCallHookPayload,
  timeoutMs: number | undefined,
): Promise<"once" | "always" | ToolCallDecision> {
  const confirm = await withTimeout(
    ui.request({ kind: "confirm", title: `Approve ${payload.name}?`, detail: summary(payload) }),
    timeoutMs,
  );
  if (confirm.status === "unavailable") return { ask: summary(payload) };
  if (confirm.status !== "answered" || confirm.value !== true) {
    return { deny: `${payload.name} denied: approval dismissed` };
  }
  const selected = await withTimeout(
    ui.request({
      kind: "select",
      title: `Remember approval for ${payload.name}?`,
      options: [
        { value: "once", label: "Once" },
        { value: "always", label: "Always for this session" },
      ],
    }),
    timeoutMs,
  );
  if (selected.status === "unavailable") return { ask: summary(payload) };
  if (selected.status !== "answered") return { deny: `${payload.name} denied: approval dismissed` };
  if (selected.value === "always") return "always";
  if (selected.value === "once") return "once";
  return { deny: `${payload.name} denied: approval dismissed` };
}

function install(prism: PackageAPI<ApprovalConfig>, gate: LiveGate): void {
  const grants = prism.state.session<JsonValue>("grants", []);
  const extraRoots = prism.config.roots ?? [];
  const timeoutMs = prism.config.timeoutMs;
  prism.hooks.on("tool.call", async (payload, context: HookContext) => {
    const service = prism.services.consume<CodingTargetsService>("coding.targets");
    // A session bound to a worktree reports it as its root, so "inside roots" follows the session.
    const reported = service?.(payload.name, payload.args, { sessionId: payload.sessionId });
    const roots = [...(reported?.roots ?? []), ...extraRoots];
    const inside = reported !== undefined && (reported.paths.length === 0 || reported.paths.every((path) => pathInside(path, roots)));
    const sessionId = context.session?.id;
    const cell = decideApproval({
      mode: gate.mode,
      effects: payload.effects,
      inside,
      granted: matched(gate, sessionId, payload),
    });
    if (cell === "allow") return "allow";
    if (cell === "deny") return { deny: `${payload.name} denied: approval mode is deny` };
    let outcome: "once" | "always" | ToolCallDecision;
    try {
      const ui = prism.host.ui;
      if (!ui) return { ask: summary(payload) };
      outcome = await prompt(ui, payload, timeoutMs);
    } catch {
      return { deny: `${payload.name} denied: approval prompt failed` };
    }
    if (outcome === "once") return "allow";
    if (outcome !== "always") return outcome;
    if (sessionId) {
      const key = grantKey(payload.name, typeof payload.args.command === "string" ? payload.args.command : undefined);
      const set = gate.grants.get(sessionId) ?? new Set<string>();
      set.add(key);
      gate.grants.set(sessionId, set);
    }
    if (context.session && sessionId) {
      await grants.set(context.session, [...(gate.grants.get(sessionId) ?? [])]).catch(() => undefined);
    }
    return "allow";
  });
}

function createDefinition(gate: LiveGate) {
  return definePackage<ApprovalConfig>({
    name: PACKAGE,
    version: manifest.version,
    description: "Approval modes over tool effects and roots.",
    requires: { api: 1 },
    capabilities: ["host-ui", "session-state"],
    config: approvalConfigSchema,
    setup(prism) {
      if (prism.config.mode) gate.mode = prism.config.mode;
      if (prism.config.rules && gate.rules.length === 0) {
        gate.rules.push(...prism.config.rules);
        gate.ruleKeys = new Set(gate.rules.map(ruleKey));
      }
      install(prism, gate);
    },
  });
}

const defaultGate = liveFrom(undefined);
const definition = createDefinition(defaultGate);

/** Bare definition: schema defaults, one shared gate. `approval({ mode })` is an instance of it. */
export default definition;

/**
 * An instance whose gate the caller can change after load (`approvalControls`).
 * A fresh definition so two agents do not share a mode.
 */
export function approvalPackage(config?: ApprovalConfig): PackageInstance {
  const gate = liveFrom(config);
  const instance = createDefinition(gate)(config);
  gates.set(instance, gate);
  return instance;
}

export function approvalControls(instance: PackageInstance): ApprovalControls | undefined {
  const gate = gates.get(instance);
  return gate ? controlsFor(gate) : undefined;
}
