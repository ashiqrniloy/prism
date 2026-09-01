/**
 * Inspector UI (plan 040 Task 3) — the served browser module.
 *
 * Framework-free DOM code kept in this one module. It is compiled by the
 * package's own tsc (zero runtime imports → a standalone ES module served
 * verbatim from `/assets/inspector.js`), so it must never import runtime
 * values — only `import type` from the core peer for event shapes.
 *
 * Data flow (server seams only, nothing invented here):
 * - live run: `POST {basePath}/agents/{id}/stream` (server SSE seam) → frames
 *   `data: <redacted AgentEvent JSON>` → `applyAgentEvent`.
 * - durable view of a past run: `GET {basePath}/events?runId=…` via
 *   `EventSource` — the server seam's reconnect with `Last-Event-ID`.
 * - decisions: `POST /runs/:runId/decisions/:approvalId` (fail-closed core
 *   boundary; unknown discriminants/stale versions rejected server-side).
 * - config: `GET /config` → `{ basePath, agentId }`.
 *
 * Safety: every dynamic string reaches the DOM through `textContent` or a
 * text node (never through string-concatenated markup) — redacted payloads
 * are rendered as-is, never parsed as HTML. No `eval`; no external origins
 * (CSP: `connect-src 'self'`).
 */

import type { AgentEvent, ContentBlock, PendingDecision } from "@arnilo/prism";

/** DOM rows actually rendered for a timeline; older rows are hidden (windowed list). */
export const MAX_RENDERED_WINDOW = 400;

export interface TimelineUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
}

export interface DecisionView {
  readonly approvalId: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly reason: string;
}

export type TimelineItem =
  | { readonly kind: "message"; readonly label: string; text: string }
  | {
      readonly kind: "tool";
      readonly toolCallId: string;
      name: string;
      argsText?: string;
      status: "running" | "ok" | "error" | "blocked";
      resultText?: string;
      note?: string;
    }
  | { readonly kind: "turn"; readonly turn: number }
  | { readonly kind: "note"; readonly level: "info" | "warn" | "error"; text: string };

export type RunStatus = "running" | "suspended" | "finished" | "denied" | "failed" | "unknown";

/** Everything the UI knows about one run. One instance per runId, session-scoped. */
export interface RunView {
  runId?: string;
  status: RunStatus;
  items: TimelineItem[];
  usage: TimelineUsage;
  decisions: DecisionView[];
  expectedVersion?: number;
  finishReason?: string;
}

export function createRunView(): RunView {
  return {
    status: "unknown",
    items: [],
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 },
    decisions: [],
  };
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function upsertTool(view: RunView, toolCallId: string, patch: (item: Mutable<Extract<TimelineItem, { kind: "tool" }>>) => void): void {
  // ponytail: reverse scan is O(n) per tool event; fine up to a few thousand events.
  for (let index = view.items.length - 1; index >= 0; index -= 1) {
    const candidate = view.items[index]!;
    if (candidate.kind !== "tool" || candidate.toolCallId !== toolCallId) continue;
    patch(candidate);
    return;
  }
  const item: Mutable<Extract<TimelineItem, { kind: "tool" }>> = { kind: "tool", toolCallId, name: "tool", status: "running" };
  view.items.push(item);
  patch(item);
}

function mergeIntoOpen(view: RunView, kind: "message", label: string, text: string): void {
  const last = view.items.at(-1);
  if (last && last.kind === kind && last.label === label) {
    last.text += text;
    return;
  }
  view.items.push({ kind, label, text });
}

function addUsage(total: TimelineUsage, usage: unknown): void {
  if (!usage || typeof usage !== "object") return;
  const record = usage as Record<string, unknown>;
  for (const key of ["inputTokens", "outputTokens", "totalTokens", "cost"] as const) {
    if (typeof record[key] === "number") total[key] += record[key] as number;
  }
}

function textOfContent(content: ContentBlock): string {
  return "text" in content && typeof content.text === "string" ? content.text : "";
}

function describeContent(content: ContentBlock): string {
  if (content.type === "tool_call") return `tool call ${content.name}`;
  if (content.type === "tool_call_delta") return `tool call stream`;
  if (content.type === "tool_result") return `tool result ${content.name}`;
  return content.type;
}

/**
 * Pure projection: fold one normalized `AgentEvent` into the run view.
 * Unknown event types still land as visible notes (trace parity) instead of
 * being dropped.
 */
export function applyAgentEvent(view: RunView, event: AgentEvent): void {
  switch (event.type) {
    case "agent_started":
      view.runId = event.runId;
      view.status = "running";
      return;
    case "agent_suspended": {
      view.status = "suspended";
      view.expectedVersion = event.version;
      const { interruption } = event;
      // Legacy single-approval state has no pendingDecisions array.
      const pending: readonly PendingDecision[] =
        interruption.pendingDecisions ??
        (interruption.toolCallId
          ? [
              {
                kind: "tool_approval" as const,
                approvalId: interruption.toolCallId,
                toolCallId: interruption.toolCallId,
                scope: { ...(interruption.toolName === undefined ? {} : { toolName: interruption.toolName }) },
                reason: interruption.reason,
              },
            ]
          : []);
      view.decisions = pending
        // Drop malformed entries instead of rendering decision buttons without ids.
        .filter((decision) => typeof decision?.approvalId === "string" && decision.approvalId.length > 0)
        .map((decision) => ({
          approvalId: decision.approvalId,
          ...(decision.toolCallId === undefined ? {} : { toolCallId: decision.toolCallId }),
          ...(decision.scope?.toolName === undefined ? {} : { toolName: decision.scope.toolName }),
          reason: decision.reason,
        }));
      view.items.push({ kind: "note", level: "warn", text: `suspended: ${interruption.reason}` });
      return;
    }
    case "agent_resumed":
      view.status = "running";
      view.decisions = [];
      return;
    case "agent_denied":
      view.status = "denied";
      view.decisions = [];
      return;
    case "agent_finished":
      addUsage(view.usage, event.usage);
      view.status = "finished";
      if (event.finishReason) view.finishReason = event.finishReason;
      return;
    case "turn_started":
      view.items.push({ kind: "turn", turn: event.turn });
      return;
    case "message_delta": {
      const content = event.content;
      if (content.type === "tool_call" || content.type === "tool_result") {
        const toolCallId = content.type === "tool_call" ? content.id : content.toolCallId;
        upsertTool(view, toolCallId, (item) => {
          if (content.type === "tool_call") {
            item.name = content.name;
            item.argsText = JSON.stringify(content.arguments, null, 2);
          } else {
            item.resultText = content.error
              ? `error: ${content.error.message ?? JSON.stringify(content.error)}`
              : stringify(content.result);
          }
        });
        return;
      }
      const text = textOfContent(content);
      if (content.type === "text" || content.type === "thinking") {
        mergeIntoOpen(view, "message", content.type, text);
        return;
      }
      view.items.push({ kind: "note", level: "info", text: `${describeContent(content)}: ${stringify(content).slice(0, 400)}` });
      return;
    }
    case "tool_execution_started":
      upsertTool(view, event.call.id, (item) => {
        item.name = event.call.name;
        item.argsText = JSON.stringify(event.call.arguments, null, 2);
      });
      return;
    case "tool_execution_progress":
      upsertTool(view, event.toolCallId, (item) => {
        item.note = stringify(event.progress ?? event.metadata);
      });
      return;
    case "tool_execution_finished": {
      const toolCallId = event.result?.toolCallId ?? event.result?.name ?? "";
      if (!toolCallId) return;
      upsertTool(view, toolCallId, (item) => {
        item.name = event.result.name ?? item.name;
        item.status = event.result.error ? "error" : "ok";
        item.resultText = event.result.error
          ? `error: ${event.result.error.message ?? stringify(event.result.error)}`
          : stringify(event.result.value ?? event.result.content);
      });
      return;
    }
    case "tool_execution_error": {
      // Malformed payloads (no call identity) still surface as a note.
      const toolCallId = event.call?.id ?? "";
      if (!toolCallId && !event.call?.name) {
        view.items.push({ kind: "note", level: "error", text: `tool error: ${event.error.message ?? stringify(event.error)}` });
        return;
      }
      upsertTool(view, toolCallId, (item) => {
        item.name = event.call?.name ?? item.name;
        item.status = "error";
        item.resultText = `error: ${event.error.message ?? stringify(event.error)}`;
      });
      return;
    }
    case "tool_execution_blocked":
      upsertTool(view, event.toolCallId, (item) => {
        item.name = event.name;
        item.status = "blocked";
        item.note = event.reason;
      });
      return;
    case "provider_turn_finished":
      addUsage(view.usage, event.usage);
      if (event.error)
        view.items.push({ kind: "note", level: "warn", text: `provider turn error: ${event.error.message ?? stringify(event.error)}` });
      return;
    case "run_limit_exceeded":
      view.items.push({ kind: "note", level: "warn", text: `run limit exceeded: ${stringify(event.breach).slice(0, 400)}` });
      return;
    case "error":
      view.status = "failed";
      view.items.push({ kind: "note", level: "error", text: `error: ${event.error.message ?? stringify(event.error)}` });
      return;
    case "compaction_started":
      view.items.push({ kind: "note", level: "info", text: "compaction started" });
      return;
    case "compaction_finished":
      view.items.push({ kind: "note", level: "info", text: `compaction finished: ${event.summary.slice(0, 400)}` });
      return;
    case "retry_scheduled":
      view.items.push({
        kind: "note",
        level: "warn",
        text: `retry scheduled (attempt ${event.attempt} in ${event.delayMs}ms): ${event.error.message ?? stringify(event.error)}`,
      });
      return;
    case "steer_rejected":
      view.items.push({ kind: "note", level: "warn", text: `steered message rejected: ${describeMessage(event.message)}` });
      return;
    case "event_subscriber_overflow":
      view.items.push({
        kind: "note",
        level: "warn",
        text: `event subscriber overflow: dropped ${event.droppedEvents} (queued max ${event.maxQueuedEvents})`,
      });
      return;
    case "message_finished":
      // Safety net for runs that never stream deltas: show the finished
      // assistant text only when nothing streamed (deltas → last item is the
      // merged message and the finished copy is redundant).
      if (event.message.role !== "assistant") return;
      {
        const text = event.message.content.map(textOfContent).join("");
        const last = view.items.at(-1);
        if (text && !(last?.kind === "message")) view.items.push({ kind: "message", label: "assistant", text });
      }
      return;
    case "turn_finished":
    case "provider_turn_started":
    case "message_started":
    case "queue_updated":
      return; // Redundant with deltas / not inspector-relevant.
    default:
      // Delegated steps, artifact lifecycle, and any future event type.
      view.items.push({ kind: "note", level: "info", text: `${event.type}` });
  }
}

function describeMessage(message: { readonly role: string; readonly content: readonly ContentBlock[] }): string {
  return `${message.role}: ${message.content.map((content) => describeContent(content)).join(", ")}`;
}

function stringify(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}

/** Windowed slice for rendering: the tail of the timeline plus the hidden count. */
export function visibleItems(items: readonly TimelineItem[]): { readonly visible: readonly TimelineItem[]; readonly hidden: number } {
  if (items.length <= MAX_RENDERED_WINDOW) return { visible: items, hidden: 0 };
  return { visible: items.slice(items.length - MAX_RENDERED_WINDOW), hidden: items.length - MAX_RENDERED_WINDOW };
}

const jsonHeaders = { "content-type": "application/json" };

export interface MountHandles {
  readonly refreshRuns: () => void;
}

/** Browser entry point: builds the whole inspector DOM into `root`. */
export async function mountInspector(root: HTMLElement): Promise<MountHandles> {
  const config = (await (await fetch("/config")).json()) as { basePath: string; agentId: string };

  const runs = new Map<string, RunView>();
  let selected: RunView | undefined;

  const main = el(
    "div",
    { class: "main" },
    promptForm(),
    el("div", { id: "usage", class: "usage" }),
    el("div", { id: "decisions", class: "decisions" }),
    el("h2", {}, "timeline"),
    el("div", { id: "timeline", class: "timeline" }),
  );
  const aside = el("aside", { class: "side" }, sidePanel());
  root.replaceChildren(
    el("h1", {}, "prism dev inspector"),
    el("p", { class: "hint" }, `agent ${config.agentId} — loopback only, host-redacted payloads`),
    el("div", { class: "layout" }, main, aside),
  );
  const usageBox = must(root, "#usage");
  const decisionsBox = must(root, "#decisions");
  const timeline = must(root, "#timeline");

  // --- prompt + live streaming -------------------------------------------------

  function promptForm(): HTMLElement {
    const input = document.createElement("textarea");
    input.id = "prompt-input";
    input.rows = 2;
    input.placeholder = "Ask the host agent something…";
    const button = el("button", { id: "prompt-run" }, "Run") as HTMLButtonElement;
    const form = el("div", { class: "prompt" }, input, button);
    button.addEventListener("click", () => {
      const prompt = input.value;
      if (!prompt || busy) return;
      busy = true;
      button.disabled = true;
      void runLive(prompt).finally(() => {
        busy = false;
        button.disabled = false;
      });
    });
    return form;
  }

  let busy = false;

  async function runLive(input: string): Promise<void> {
    const view = createRunView();
    view.status = "running";
    const response = await fetch(`${config.basePath}/agents/${encodeURIComponent(config.agentId)}/stream`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ input }),
    });
    if (!response.ok || !response.body) {
      view.status = "failed";
      view.items.push({ kind: "note", level: "error", text: `stream request failed: ${response.status}` });
      registerRun(view);
      return;
    }
    registerRun(view);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      let boundary = buffered.indexOf("\n\n");
      while (boundary >= 0) {
        ingestSseFrame(view, buffered.slice(0, boundary));
        buffered = buffered.slice(boundary + 2);
        boundary = buffered.indexOf("\n\n");
      }
    }
    ingestSseFrame(view, buffered);
    refreshDecisions();
    refreshUsage();
    refreshRuns();
    renderTimeline();
  }

  function ingestSseFrame(view: RunView, frame: string): void {
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("");
    if (!data) return;
    let event: AgentEvent;
    try {
      event = JSON.parse(data) as AgentEvent;
    } catch {
      return;
    }
    applyAgentEvent(view, event);
    if (event.type === "agent_started") refreshRuns();
    scheduleRender();
  }

  // --- durable replay / run selection ------------------------------------------

  function registerRun(view: RunView): void {
    if (!view.runId) return;
    runs.set(view.runId, view);
    select(view);
    refreshRuns();
  }

  function loadStoredRun(runId: string): void {
    const existing = runs.get(runId);
    if (existing && existing.status !== "unknown") {
      select(existing);
      return;
    }
    // Durable source view: the server seam streams stored events (redacted,
    // ownership-scoped) and reconnects with Last-Event-ID on its own.
    const view = createRunView();
    view.runId = runId;
    const source = new EventSource(`${config.basePath}/events?runId=${encodeURIComponent(runId)}`);
    source.onmessage = (message: MessageEvent<string>) => {
      try {
        applyAgentEvent(view, JSON.parse(message.data) as AgentEvent);
        scheduleRender();
      } catch {
        /* malformed frame: skip */
      }
    };
    source.onerror = () => {
      if (view.status !== "unknown" && runs.get(runId) === view) return refreshRuns();
      // Source unreachable/absent (e.g. no durable event source wired).
      source.close();
      if (view.status === "unknown") {
        view.status = "failed";
        view.items.push({ kind: "note", level: "error", text: "no durable event source for this run (host must wire eventSource)" });
      }
      if (!runs.has(runId)) runs.set(runId, view);
      select(view);
      refreshRuns();
    };
    runs.set(runId, view);
    select(view);
    refreshRuns();
  }

  // --- rendering ---------------------------------------------------------------

  let renderQueued = false;

  /** Coalesce bursts: 1k-event streams render at animation-frame cadence. */
  function scheduleRender(): void {
    if (renderQueued) return;
    renderQueued = true;
    const paint = (): void => {
      renderQueued = false;
      renderTimeline();
      refreshDecisions();
      refreshUsage();
      refreshRuns();
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(paint);
    else setTimeout(paint, 16);
  }

  function select(view: RunView): void {
    selected = view;
    renderTimeline();
    refreshDecisions();
    refreshUsage();
  }

  function renderTimeline(): void {
    const view = selected;
    if (!view) {
      timeline.replaceChildren(el("p", { class: "hint" }, "Send a prompt or load a run to see its event timeline."));
      return;
    }
    const { visible, hidden } = visibleItems(view.items);
    const children: HTMLElement[] = [];
    if (hidden > 0) children.push(el("div", { class: "hidden-note" }, `… ${hidden} earlier events hidden (windowed view)`));
    for (const item of visible) children.push(renderItem(item));
    timeline.replaceChildren(...children);
    timeline.scrollTop = timeline.scrollHeight;
  }

  function renderItem(item: TimelineItem): HTMLElement {
    switch (item.kind) {
      case "message":
        return el("div", { class: `evt message ${item.label}` }, el("span", { class: "k" }, item.label), el("pre", {}, item.text || "…"));
      case "turn":
        return el("div", { class: "evt turn" }, el("span", { class: "k" }, `turn ${item.turn}`));
      case "tool": {
        const box = el(
          "details",
          { class: `evt tool ${item.status}` },
          el("summary", {}, el("span", { class: "k" }, `tool ${item.name}`), item.status),
        );
        if (item.argsText !== undefined) box.append(el("pre", { class: "args" }, item.argsText));
        if (item.resultText !== undefined) box.append(el("pre", { class: "result" }, item.resultText || "(empty result)"));
        if (item.note !== undefined) box.append(el("pre", { class: "note" }, item.note));
        return box;
      }
      case "note":
        return el("div", { class: `evt note ${item.level}` }, el("span", { class: "k" }, item.level), item.text);
    }
  }

  function refreshUsage(): void {
    const view = selected;
    if (!view) {
      usageBox.replaceChildren();
      return;
    }
    const usage = view.usage;
    usageBox.replaceChildren(
      el(
        "span",
        {},
        `usage${view.runId ? ` · ${view.runId}` : ""}: in ${usage.inputTokens}, out ${usage.outputTokens}, total ${usage.totalTokens}${usage.cost ? `, cost ${usage.cost}` : ""}`,
      ),
    );
  }

  // --- decisions ----------------------------------------------------------------

  function refreshDecisions(): void {
    const view = selected;
    if (!view || view.decisions.length === 0) {
      decisionsBox.replaceChildren();
      return;
    }
    const children: HTMLElement[] = [];
    if (view.runId && typeof view.expectedVersion === "number") {
      for (const decision of view.decisions) children.push(decisionCard(view, decision));
    } else {
      children.push(el("div", { class: "decision hint" }, "suspended run has no resumable decision ids"));
    }
    decisionsBox.replaceChildren(...children);
  }

  function decisionCard(view: RunView, decision: DecisionView): HTMLElement {
    const card = el(
      "div",
      { class: "decision" },
      el("strong", {}, `approval ${decision.approvalId}${decision.toolName ? ` (${decision.toolName})` : ""}`),
      el("span", { class: "reason" }, decision.reason),
    );
    for (const outcome of ["allow_once", "allow_always", "deny"] as const) {
      const button = el("button", { class: `decision-${outcome}` }, outcome) as HTMLButtonElement;
      button.addEventListener("click", () => {
        if (!view.runId) return;
        for (const other of card.querySelectorAll("button")) (other as HTMLButtonElement).disabled = true;
        void postDecision(view, decision, outcome, button);
      });
      card.append(button);
    }
    return card;
  }

  async function postDecision(view: RunView, decision: DecisionView, outcome: string, button: HTMLElement): Promise<void> {
    try {
      const response = await fetch(`/runs/${encodeURIComponent(view.runId!)}/decisions/${encodeURIComponent(decision.approvalId)}`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ outcome, ...(typeof view.expectedVersion === "number" ? { expectedVersion: view.expectedVersion } : {}) }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        status?: string;
        error?: { message?: string };
        runState?: { version?: number; interruption?: { pendingDecisions?: readonly DecisionView[] } };
      };
      if (!response.ok) {
        button.textContent = result.error?.message ?? `rejected (${response.status})`;
        button.classList.add("error");
      } else if (result.status === "suspended" && result.runState?.interruption?.pendingDecisions) {
        view.expectedVersion = result.runState.version;
        view.decisions = [...result.runState.interruption.pendingDecisions];
      } else if (result.status === "denied") {
        view.status = "denied";
        view.decisions = [];
      } else {
        // Resumed: the durable event source (when wired) keeps streaming; the
        // live view stays as-is until the run's own events arrive.
        view.decisions = [];
        if (result.status) view.status = result.status as RunStatus;
      }
      scheduleRender();
    } catch (error) {
      button.textContent = error instanceof Error ? error.message : String(error);
      button.classList.add("error");
      scheduleRender();
    }
  }

  // --- run selector --------------------------------------------------------------

  function refreshRuns(): void {
    const list = must(root, "#runs");
    const children: HTMLElement[] = [];
    for (const [runId, view] of runs) {
      const row = el("li", { class: view === selected ? "selected" : "" }, `${runId.slice(0, 8)}… ${view.status}`);
      row.addEventListener("click", () => {
        select(view);
        refreshRuns();
      });
      children.push(row);
    }
    list.replaceChildren(...children);
  }

  // --- layout --------------------------------------------------------------------

  function sidePanel(): HTMLElement {
    const list = el("ul", { id: "runs", class: "runs" }, el("li", { class: "hint" }, "none yet"));
    const loader = document.createElement("input");
    loader.id = "load-run";
    loader.placeholder = "load runId (durable events)";
    const loadButton = el("button", { id: "load-run-btn" }, "Load");
    loadButton.addEventListener("click", () => {
      const runId = loader.value.trim();
      if (runId) void loadStoredRun(runId);
    });
    return el("div", {}, el("h2", {}, "runs"), list, loader, loadButton);
  }

  refreshRuns();
  refreshUsage();
  refreshDecisions();
  return {
    refreshRuns,
  };
}

// --- tiny DOM helpers (markup never concatenated from strings) ------------------

function el(tag: string, attributes: Readonly<Record<string, string>> = {}, ...children: (string | Node)[]): HTMLElement {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  for (const child of children) element.append(child);
  return element;
}

function must(root: HTMLElement, selector: string): HTMLElement {
  const found = root.querySelector(selector);
  if (!(found instanceof HTMLElement)) throw new Error(`inspector UI: missing ${selector}`);
  return found;
}
