/**
 * Plan 218.3 Task 9: Session-Bench's simulated workspace. Deterministic, in memory, no network, no container.
 *
 * State is one JSON document per session (`files`, `tickets`, `messages`, `config`, `rules`); the tools read and change
 * it and log every call with the task it ran in, so the scorer can count re-derivation calls. Tools are plain objects
 * (`execute(args) -> string`); the runner adapts them to whatever agent drives them. This module imports nothing from
 * Prism (guardrail G2).
 */

/** The workspace's tool names, in the order every arm receives them (G6). */
export const WORKSPACE_TOOL_NAMES = Object.freeze([
  "list_files",
  "read_file",
  "search_files",
  "write_file",
  "list_tickets",
  "get_ticket",
  "update_ticket",
  "create_ticket",
  "read_messages",
  "post_message",
  "get_config",
  "set_config",
  "run_check",
]);

/** Calls that only read; a read of an object an earlier task already read is a re-derivation call. */
export const READ_TOOLS = Object.freeze(
  new Set(["list_files", "read_file", "search_files", "list_tickets", "get_ticket", "read_messages", "get_config", "run_check"]),
);

const MAX_WRITE_BYTES = 16_384;
const MAX_SEARCH_HITS = 50;

const object = (properties, required = []) => ({ type: "object", additionalProperties: false, properties, required });
const str = { type: "string" };
const scalar = { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }] };

/** JSON schemas of the tools; part of what every arm shares (G6). */
export const WORKSPACE_TOOL_SCHEMAS = Object.freeze({
  list_files: { description: "List the workspace's file paths.", parameters: object({}) },
  read_file: { description: "Read one workspace file.", parameters: object({ path: str }, ["path"]) },
  search_files: {
    description: "Search every file for a literal string; answers path:line:text lines (at most 50).",
    parameters: object({ query: str }, ["query"]),
  },
  write_file: { description: "Write a workspace file (at most 16 KB).", parameters: object({ path: str, text: str }, ["path", "text"]) },
  list_tickets: {
    description: "List tickets as `id status title` lines, optionally only one status.",
    parameters: object({ status: str }),
  },
  get_ticket: { description: "Read one ticket: fields and body.", parameters: object({ id: str }, ["id"]) },
  update_ticket: {
    description: "Change a ticket's status, assignee or labels, or add a comment.",
    parameters: object({ id: str, status: str, assignee: str, labels: { type: "array", items: str }, comment: str }, ["id"]),
  },
  create_ticket: {
    description: "Create a ticket; answers its id.",
    parameters: object({ title: str, body: str, labels: { type: "array", items: str } }, ["title"]),
  },
  read_messages: { description: "Read a team channel's message log, oldest first.", parameters: object({ channel: str }, ["channel"]) },
  post_message: { description: "Post a message to a team channel.", parameters: object({ channel: str, text: str }, ["channel", "text"]) },
  get_config: {
    description: "Read one service config key, or every key as `key = value` lines when no key is given.",
    parameters: object({ key: str }),
  },
  set_config: { description: "Set one service config key.", parameters: object({ key: str, value: scalar }, ["key", "value"]) },
  run_check: {
    description: "Run a named project rule against the config; answers one line per key it checks.",
    parameters: object({ rule: str }, ["rule"]),
  },
});

const show = (value) => (typeof value === "string" ? value : JSON.stringify(value));

/** One rule's report: a PASS or FAIL line per key, in the rule's order. */
export function ruleReport(rule, config) {
  const lines = rule.keys.map(([key, expected, note]) => {
    const about = note ? ` (${note})` : "";
    return config[key] === expected
      ? `PASS ${key} = ${show(expected)}${about}`
      : `FAIL ${key}: expected ${show(expected)}, found ${config[key] === undefined ? "nothing" : show(config[key])}${about}`;
  });
  const failed = lines.filter((line) => line.startsWith("FAIL")).length;
  return `rule ${rule.id}: ${rule.keys.length - failed} passed, ${failed} failed\n${lines.join("\n")}`;
}

/**
 * A live workspace over a copy of `env`. `task` is the task the next calls belong to (the runner sets it); `calls`
 * logs `{ task, name, object, read }`; `changes` logs config writes and creations with their task.
 */
export function createWorkspace(env) {
  const state = structuredClone(env);
  state.changes = [];
  state.created = { tickets: [], messages: [] };
  let nextTicket = 900;
  const ws = {
    state,
    task: 0,
    calls: [],
    /** Run one tool by name; a bad argument answers an error string, as a real tool would, and never throws. */
    call(name, args = {}) {
      const handler = handlers[name];
      if (!handler) return `unknown tool: ${name}`;
      try {
        const { text, object } = handler(args ?? {});
        ws.calls.push({ task: ws.task, name, object, read: READ_TOOLS.has(name) });
        return text;
      } catch (error) {
        ws.calls.push({ task: ws.task, name, object: null, read: READ_TOOLS.has(name), error: true });
        return `error: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  };
  const need = (value, what) => {
    if (typeof value !== "string" || !value.trim()) throw new Error(`${what} is required`);
    return value.trim();
  };
  const ticket = (id) => {
    const found = state.tickets.find((row) => row.id === need(id, "id"));
    if (!found) throw new Error(`no such ticket: ${id}`);
    return found;
  };
  const handlers = {
    list_files: () => ({ text: Object.keys(state.files).sort().join("\n"), object: "files" }),
    read_file: ({ path }) => {
      const clean = need(path, "path").replace(/^\.?\/+/, "");
      const text = state.files[clean];
      return { text: text ?? `no such file: ${clean}`, object: `file:${clean}` };
    },
    search_files: ({ query }) => {
      const q = need(query, "query");
      const hits = Object.entries(state.files)
        .sort(([a], [b]) => a.localeCompare(b))
        .flatMap(([path, text]) => text.split("\n").flatMap((line, index) => (line.includes(q) ? [`${path}:${index + 1}:${line}`] : [])))
        .slice(0, MAX_SEARCH_HITS);
      return { text: hits.length ? hits.join("\n") : "(no matches)", object: `search:${q}` };
    },
    write_file: ({ path, text }) => {
      const clean = need(path, "path").replace(/^\.?\/+/, "");
      if (typeof text !== "string" || Buffer.byteLength(text) > MAX_WRITE_BYTES) throw new Error("text must be a string of at most 16 KB");
      state.files[clean] = text;
      state.changes.push({ task: ws.task, kind: "file", key: clean });
      return { text: `wrote ${clean}`, object: `file:${clean}` };
    },
    list_tickets: ({ status }) => {
      const rows = state.tickets.filter((row) => !status || row.status === status);
      return { text: rows.map((row) => `${row.id} ${row.status} ${row.title}`).join("\n") || "(no tickets)", object: "tickets" };
    },
    get_ticket: ({ id }) => {
      const row = ticket(id);
      const text = [
        `${row.id}: ${row.title}`,
        `status: ${row.status}`,
        `assignee: ${row.assignee || "(none)"}`,
        `labels: ${row.labels.length ? row.labels.join(", ") : "(none)"}`,
        "",
        row.body,
        ...(row.comments ?? []).map((comment) => `comment: ${comment}`),
      ].join("\n");
      return { text, object: `ticket:${row.id}` };
    },
    update_ticket: ({ id, status, assignee, labels, comment }) => {
      const row = ticket(id);
      if (status !== undefined) row.status = need(status, "status");
      if (assignee !== undefined) row.assignee = need(assignee, "assignee");
      if (labels !== undefined) {
        if (!Array.isArray(labels) || labels.some((label) => typeof label !== "string")) throw new Error("labels must be strings");
        row.labels = [...labels];
      }
      if (comment !== undefined) (row.comments ??= []).push(String(comment));
      state.changes.push({ task: ws.task, kind: "ticket", key: row.id });
      return { text: `updated ${row.id}`, object: `ticket:${row.id}` };
    },
    create_ticket: ({ title, body, labels }) => {
      if (labels !== undefined && (!Array.isArray(labels) || labels.some((label) => typeof label !== "string")))
        throw new Error("labels must be strings");
      const row = {
        id: `T-${nextTicket++}`,
        title: need(title, "title"),
        status: "open",
        assignee: "",
        labels: [...(labels ?? [])],
        body: String(body ?? ""),
      };
      state.tickets.push(row);
      state.created.tickets.push({ task: ws.task, id: row.id });
      return { text: `created ${row.id}`, object: `ticket:${row.id}` };
    },
    read_messages: ({ channel }) => {
      const name = need(channel, "channel").replace(/^#?/, "#");
      const log = state.messages[name];
      if (!log) return { text: `no such channel: ${name}`, object: `channel:${name}` };
      return { text: log.map((row) => `${row.author}: ${row.text}`).join("\n") || "(empty)", object: `channel:${name}` };
    },
    post_message: ({ channel, text }) => {
      const name = need(channel, "channel").replace(/^#?/, "#");
      const body = need(text, "text");
      (state.messages[name] ??= []).push({ author: "agent", text: body, task: ws.task });
      state.created.messages.push({ task: ws.task, channel: name, text: body });
      return { text: `posted to ${name}`, object: `channel:${name}` };
    },
    get_config: ({ key }) => {
      if (key === undefined || key === "")
        return {
          text: Object.keys(state.config)
            .sort()
            .map((name) => `${name} = ${show(state.config[name])}`)
            .join("\n"),
          object: "config:*",
        };
      const name = need(key, "key");
      return { text: name in state.config ? `${name} = ${show(state.config[name])}` : `no such key: ${name}`, object: `config:${name}` };
    },
    set_config: ({ key, value }) => {
      const name = need(key, "key");
      if (!["string", "number", "boolean"].includes(typeof value)) throw new Error("value must be a string, number or boolean");
      const created = !(name in state.config);
      state.config[name] = value;
      state.changes.push({ task: ws.task, kind: "config", key: name, value, created });
      return { text: `set ${name} = ${show(value)}`, object: `config:${name}` };
    },
    run_check: ({ rule }) => {
      const id = need(rule, "rule");
      const found = state.rules.find((row) => row.id === id);
      if (!found) return { text: `no such rule: ${id}`, object: `check:${id}` };
      return { text: ruleReport(found, state.config), object: `check:${id}` };
    },
  };
  return ws;
}

/**
 * Every text an agent could read before it acts, at the session's start: files, tickets, messages, config and every
 * rule report. G5's lint reads this to prove a user-only or superseded answer is in no tool output.
 */
export function initialObservableText(env) {
  const ws = createWorkspace(env);
  return [
    ...Object.keys(env.files).map((path) => ws.call("read_file", { path })),
    ws.call("list_files"),
    ws.call("list_tickets"),
    ...env.tickets.map((row) => ws.call("get_ticket", { id: row.id })),
    ...Object.keys(env.messages).map((channel) => ws.call("read_messages", { channel })),
    ws.call("get_config"),
    ...env.rules.map((row) => ws.call("run_check", { rule: row.id })),
  ].join("\n");
}
