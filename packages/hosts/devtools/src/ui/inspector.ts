/**
 * Browser module for the devtools page. It has no imports: it reads the JSON routes on this origin and
 * renders with text nodes only, so no session or event payload becomes markup.
 */

/** Newest live events kept on screen; older rows drop off the top. */
export const LIVE_FEED_LIMIT = 500;
/** Entries per replay page. */
export const REPLAY_PAGE_SIZE = 100;
const SESSIONS_PAGE_SIZE = 20;

/** A one-line label for a session entry or event: its `type`, and its `id` when it has one. */
export function describeRecord(value: unknown): string {
  if (!value || typeof value !== "object") return String(value);
  const record = value as { type?: unknown; id?: unknown };
  const kind = typeof record.type === "string" ? record.type : "record";
  return typeof record.id === "string" ? `${kind} ${record.id}` : kind;
}

export function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? "undefined";
}

function errorMessage(body: unknown): string {
  const message = (body as { error?: { message?: unknown } } | undefined)?.error?.message;
  return typeof message === "string" ? message : "request failed";
}

/** Mounts the page into `doc`. Every request is same-origin and relative. */
export function mount(doc: Document): void {
  const byId = <T extends HTMLElement>(id: string): T => {
    const node = doc.getElementById(id);
    if (!node) throw new Error(`missing #${id}`);
    return node as T;
  };
  const inspect = byId<HTMLPreElement>("inspect");
  const inspectSummary = byId<HTMLDivElement>("inspect-summary");
  const sessions = byId<HTMLUListElement>("sessions");
  const sessionsMore = byId<HTMLButtonElement>("sessions-more");
  const sessionsStatus = byId<HTMLDivElement>("sessions-status");
  const replay = byId<HTMLDivElement>("replay");
  const replayMore = byId<HTMLButtonElement>("replay-more");
  const replayStatus = byId<HTMLDivElement>("replay-status");
  const replayTitle = byId<HTMLSpanElement>("replay-title");
  const live = byId<HTMLDivElement>("live");
  const liveStatus = byId<HTMLDivElement>("live-status");
  const compareInput = byId<HTMLTextAreaElement>("compare-input");
  const compareOut = byId<HTMLPreElement>("compare-out");

  let selected: string | undefined;
  let replayCursor: string | undefined;
  let sessionsCursor: string | undefined;
  let source: EventSource | undefined;

  async function getJson(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetch(path, init);
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) throw new Error(`${response.status}: ${errorMessage(body)}`);
    return body;
  }

  async function loadInspect(): Promise<void> {
    const info = (await getJson("/api/inspect")) as Record<string, unknown[] | undefined>;
    const count = (key: string): number => info[key]?.length ?? 0;
    inspectSummary.textContent = `${count("packages")} packages · ${count("tools")} tools · ${count("skills")} skills · ${count("commands")} commands`;
    inspect.textContent = formatJson(info);
  }

  async function loadSessions(reset: boolean): Promise<void> {
    if (reset) {
      sessionsCursor = undefined;
      sessions.replaceChildren();
    }
    const params = new URLSearchParams({ limit: String(SESSIONS_PAGE_SIZE) });
    if (sessionsCursor !== undefined) params.set("cursor", sessionsCursor);
    const page = (await getJson(`/api/sessions?${params}`)) as { items: Array<{ sessionId: string }>; nextCursor?: string };
    for (const item of page.items) {
      const row = doc.createElement("li");
      row.textContent = item.sessionId;
      row.dataset.session = item.sessionId;
      if (item.sessionId === selected) row.classList.add("selected");
      row.addEventListener("click", () => selectSession(item.sessionId));
      sessions.append(row);
    }
    sessionsCursor = page.nextCursor;
    sessionsMore.disabled = sessionsCursor === undefined;
    sessionsStatus.textContent = page.items.length === 0 && reset ? "no sessions yet" : "";
  }

  function selectSession(id: string): void {
    selected = id;
    for (const row of sessions.querySelectorAll("li")) row.classList.toggle("selected", row.dataset.session === id);
    replay.replaceChildren();
    replayCursor = undefined;
    replayTitle.textContent = id;
    void loadReplay();
    follow(id);
  }

  async function loadReplay(): Promise<void> {
    if (selected === undefined) return;
    const params = new URLSearchParams({ session: selected, limit: String(REPLAY_PAGE_SIZE) });
    if (replayCursor !== undefined) params.set("cursor", replayCursor);
    try {
      const page = (await getJson(`/api/replay?${params}`)) as { items: unknown[]; nextCursor?: string };
      for (const item of page.items) {
        const details = doc.createElement("details");
        const summary = doc.createElement("summary");
        summary.textContent = describeRecord(item);
        const body = doc.createElement("pre");
        body.textContent = formatJson(item);
        details.append(summary, body);
        replay.append(details);
      }
      replayCursor = page.nextCursor;
      replayMore.disabled = replayCursor === undefined;
      replayStatus.textContent = page.items.length === 0 && replay.childElementCount === 0 ? "no entries" : "";
      replayStatus.className = "status";
    } catch (error) {
      replayStatus.textContent = error instanceof Error ? error.message : "replay failed";
      replayStatus.className = "status error";
    }
  }

  function follow(id: string): void {
    source?.close();
    live.replaceChildren();
    const next = new EventSource(`/api/events?session=${encodeURIComponent(id)}`);
    source = next;
    liveStatus.textContent = `following ${id}`;
    for (const name of ["agent", "session"]) {
      next.addEventListener(name, (message) => {
        let label: string;
        try {
          label = describeRecord(JSON.parse((message as MessageEvent<string>).data));
        } catch {
          label = "unreadable event";
        }
        const row = doc.createElement("div");
        row.textContent = `${name}: ${label}`;
        live.append(row);
        // Bounded: the oldest rows drop off so a long run never grows the page without limit.
        while (live.childElementCount > LIVE_FEED_LIMIT) live.firstElementChild?.remove();
        live.scrollTop = live.scrollHeight;
      });
    }
    next.onerror = () => {
      liveStatus.textContent = "stream disconnected; the browser retries";
    };
  }

  async function runCompare(): Promise<void> {
    try {
      const result = await getJson("/api/compare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: compareInput.value,
      });
      compareOut.textContent = formatJson(result);
    } catch (error) {
      compareOut.textContent = error instanceof Error ? error.message : "compare failed";
    }
  }

  byId<HTMLButtonElement>("sessions-refresh").addEventListener("click", () => void loadSessions(true).catch(reportSessions));
  sessionsMore.addEventListener("click", () => void loadSessions(false).catch(reportSessions));
  replayMore.addEventListener("click", () => void loadReplay());
  byId<HTMLButtonElement>("compare-run").addEventListener("click", () => void runCompare());

  function reportSessions(error: unknown): void {
    sessionsStatus.textContent = error instanceof Error ? error.message : "sessions failed";
    sessionsStatus.className = "status error";
  }

  void loadInspect().catch((error: unknown) => {
    inspectSummary.textContent = error instanceof Error ? error.message : "inspect failed";
    inspectSummary.className = "status error";
  });
  void loadSessions(true).catch(reportSessions);
}

if (typeof document !== "undefined" && document.getElementById("inspect") !== null) mount(document);
