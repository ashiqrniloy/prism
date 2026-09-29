/**
 * Session management, durable SQLite persistence, repo-scoped search,
 * and coding LLM compaction for prism-code.
 */

import { execSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  type AgentSession,
  type AIProvider,
  type CompactionResult,
  createMemorySessionStore,
  type ModelConfig,
  redactSecrets,
  SESSION_SEARCH_WORKSPACE_METADATA_KEY,
  SESSION_TITLE_MAX_LENGTH,
  SESSION_TITLE_METADATA_KEY,
  type SessionSearchHit,
  type SessionStore,
} from "@arnilo/prism";
import { createSqlitePersistence } from "@arnilo/prism-core/sessions/sqlite";
import { createCodingCompactionStrategy } from "@arnilo/prism-memory/compaction/llm";
import type { PrismCodeConfig } from "./config.js";
import { ensureHomeDir, resolvePrismHome } from "./home.js";

/**
 * Resolves the canonical, real filesystem path for a workspace root: the real git
 * top-level when `cwd` is inside a repository, otherwise the real `cwd`.
 * Keeps repo scoping stable across subdirectories, symlinks, and casing.
 */
export function getCanonicalWorkspaceRoot(cwd: string): string {
  const resolved = resolve(cwd);
  const root = resolveGitRoot(resolved) ?? resolved;
  try {
    return existsSync(root) ? realpathSync(root) : root;
  } catch {
    return root;
  }
}

function resolveGitRoot(cwd: string): string | undefined {
  try {
    const topLevel = execSync("git rev-parse --show-toplevel", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
      encoding: "utf-8",
    }).trim();
    return topLevel.length > 0 ? resolve(topLevel) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolves the durable session database path: `store.path` when configured, otherwise
 * the shared home store `~/.prism/sessions/sessions.db`. `store: "memory"` resolves to `:memory:`.
 */
export function resolveSessionDbPath(config: PrismCodeConfig, home: string = resolvePrismHome()): string {
  if (config.store?.type === "memory") return ":memory:";
  if (config.store?.type === "sqlite" && config.store.path !== undefined) {
    return config.store.path === ":memory:" ? ":memory:" : resolve(config.cwd, config.store.path);
  }
  return join(home, "sessions", "sessions.db");
}

/**
 * Resolves and prepares the session database path: creates the parent directory `0700`,
 * and tightens/creates the Prism home `0700` when the database lives inside it.
 * The adapter creates the database file `0600`.
 */
export function prepareSessionDbPath(config: PrismCodeConfig, home: string = resolvePrismHome()): string {
  const dbPath = resolveSessionDbPath(config, home);
  if (dbPath === ":memory:") return dbPath;
  const dir = dirname(dbPath);
  const relativeToHome = relative(home, dir);
  if (relativeToHome === "" || (!relativeToHome.startsWith("..") && !isAbsolute(relativeToHome))) {
    ensureHomeDir(home);
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") chmodSync(dir, 0o700);
  return dbPath;
}

/**
 * One-line startup notice when `<cwd>/.prism/sessions.db` from the pre-0.13 default exists.
 * The legacy database is never migrated or deleted. `undefined` when an explicit store is configured.
 */
export function legacySessionDbNotice(config: PrismCodeConfig, home: string = resolvePrismHome()): string | undefined {
  if (config.store) return undefined;
  const legacy = resolve(config.cwd, ".prism", "sessions.db");
  if (!existsSync(legacy)) return undefined;
  return `prism-code: sessions are now stored in ${resolveSessionDbPath(config, home)}; the old ${legacy} can be deleted`;
}

/**
 * Resolves the session store for Prism Code based on config.
 * By default, uses the shared durable SQLite store at `<home>/sessions/sessions.db`.
 */
export function resolveSessionStore(config: PrismCodeConfig, home: string = resolvePrismHome()): SessionStore {
  if (config.store?.type === "memory") {
    return createMemorySessionStore();
  }

  return createSqlitePersistence({ filename: prepareSessionDbPath(config, home) });
}

export interface SessionStoreWithAppend extends SessionStore {
  appendSession?(record: {
    readonly id: string;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly userId?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
  }): Promise<{ readonly version: number } | undefined>;
}

/** Optional session-record reads/metadata merges exposed by durable SQLite persistence. */
export interface SessionRecordStore extends SessionStoreWithAppend {
  querySessions?(query: { readonly id?: string; readonly limit?: number }): Promise<{ readonly items: readonly { readonly id: string }[] }>;
  mergeSessionMetadata?(
    id: string,
    patch: Readonly<Record<string, unknown>>,
    options?: { readonly onlyIfMissing?: readonly string[] },
  ): { readonly version: number } | undefined;
}

/**
 * Title text for a session: first line, whitespace-collapsed, capped at the
 * `SESSION_TITLE_MAX_LENGTH` convention. Callers pass already-redacted prompt text
 * (`session.redact`) so the title never stores a secret the message would not.
 * Returns `undefined` for blank prompts.
 */
export function deriveSessionTitle(prompt: string): string | undefined {
  const firstLine = prompt.split(/\r?\n/, 1)[0] ?? "";
  const collapsed = firstLine.replace(/\s+/g, " ").trim();
  if (!collapsed) return undefined;
  return collapsed.length > SESSION_TITLE_MAX_LENGTH ? collapsed.slice(0, SESSION_TITLE_MAX_LENGTH) : collapsed;
}

/**
 * Merges `title` into the session metadata without clobbering other keys. `onlyIfUnset`
 * keeps the first prompt's title; `/rename` overwrites. Returns false on stores without
 * a metadata-merge surface (session titles are display-only).
 */
export async function setSessionTitle(
  store: SessionStore,
  sessionId: string,
  title: string,
  options?: { readonly onlyIfUnset?: boolean },
): Promise<boolean> {
  const records = store as SessionRecordStore;
  if (typeof records.mergeSessionMetadata !== "function") return false;
  const result = records.mergeSessionMetadata(
    sessionId,
    { [SESSION_TITLE_METADATA_KEY]: title },
    {
      ...(options?.onlyIfUnset ? { onlyIfMissing: [SESSION_TITLE_METADATA_KEY] } : {}),
    },
  );
  return result !== undefined;
}

/** True when the store can confirm a session record exists (missing = fail closed). */
export async function sessionRecordExists(store: SessionStore, sessionId: string): Promise<boolean> {
  const records = store as SessionRecordStore;
  if (typeof records.querySessions !== "function") return true;
  const page = await records.querySessions({ id: sessionId, limit: 1 });
  return page.items.length > 0;
}

/** Most recent durable session for the canonical repo root, or `undefined` when none. */
export async function resolveContinueSessionId(store: SessionStore, workspaceRoot: string): Promise<string | undefined> {
  const { items } = await searchRepoSessions(store, { workspaceRoot, limit: 1 });
  return items[0]?.sessionId;
}

/** Short relative time for pickers/logs; falls back to the raw value when unparsable. */
export function formatRelativeTime(value: string | undefined, now: number = Date.now()): string {
  if (!value) return "unknown";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 45) return "just now";
  if (seconds < 90) return "1m ago";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

/**
 * Ensures a durable session record exists in the store with repository metadata.
 * Enables repo-scoped session search even for freshly created, empty sessions.
 */
export async function ensureDurableSessionRecord(
  store: SessionStore,
  sessionId: string,
  workspaceRoot: string,
  options?: {
    userId?: string;
    createdAt?: string;
    updatedAt?: string;
    metadata?: Readonly<Record<string, unknown>>;
  },
): Promise<void> {
  const storeWithAppend = store as SessionStoreWithAppend;
  if (typeof storeWithAppend.appendSession !== "function") {
    return;
  }

  const now = options?.createdAt ?? new Date().toISOString();
  const canonicalRoot = getCanonicalWorkspaceRoot(workspaceRoot);

  await storeWithAppend.appendSession({
    id: sessionId,
    createdAt: now,
    updatedAt: options?.updatedAt ?? now,
    userId: options?.userId,
    metadata: {
      ...options?.metadata,
      [SESSION_SEARCH_WORKSPACE_METADATA_KEY]: canonicalRoot,
      ...(options?.userId ? { userId: options.userId } : {}),
    },
  });
}

export interface SearchRepoSessionsOptions {
  readonly workspaceRoot: string;
  readonly cursor?: string;
  readonly limit?: number;
  readonly signal?: AbortSignal;
}

export interface SearchRepoSessionsResult {
  readonly items: readonly SessionSearchHit[];
  readonly nextCursor?: string;
}

/**
 * Searches all durable sessions scoped to the canonical workspace repository root.
 * Orders newest first. Throws if the store does not support session search.
 */
export async function searchRepoSessions(store: SessionStore, options: SearchRepoSessionsOptions): Promise<SearchRepoSessionsResult> {
  const storeWithAppend = store as SessionStoreWithAppend;
  if (typeof store.searchSessions !== "function" || typeof storeWithAppend.appendSession !== "function") {
    throw new Error("Session resumption is not supported with this session store. Configure a durable SQLite store in prism-code.json.");
  }

  const canonicalRoot = getCanonicalWorkspaceRoot(options.workspaceRoot);

  try {
    const page = await store.searchSessions({
      workspaceRoot: canonicalRoot,
      cursor: options.cursor,
      limit: options.limit ?? 20,
      signal: options.signal,
    });

    return {
      items: page.items,
      nextCursor: page.nextCursor,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "SessionSearchUnsupportedError") {
      throw new Error("Session resumption is not supported with this session store. Configure a durable SQLite store in prism-code.json.");
    }
    throw err;
  }
}

/**
 * Formats a session search hit for display in pickers/logs.
 * Redacts secrets, truncates snippets, and formats timestamp.
 */
export function formatSessionOption(
  hit: SessionSearchHit,
  currentSessionId?: string,
  secrets: readonly string[] = [],
): { name: string; value: string; description: string } {
  const isCurrent = hit.sessionId === currentSessionId;
  const rawTitle = hit.metadata?.[SESSION_TITLE_METADATA_KEY];
  const title = typeof rawTitle === "string" && rawTitle.trim().length > 0 ? rawTitle.trim() : undefined;
  const label = hit.label ? redactSecrets(hit.label, secrets) : undefined;
  const baseName = title ? redactSecrets(title, secrets) : (label ?? hit.sessionId);
  const name = isCurrent ? `${baseName} (current)` : baseName;

  const parts: string[] = [formatRelativeTime(hit.updatedAt), `${hit.messageCount ?? 0} messages`];
  if (title) parts.push(hit.sessionId);

  if (hit.summary) {
    const cleanSummary = redactSecrets(hit.summary.replace(/[\r\n]+/g, " ").trim(), secrets);
    parts.push(cleanSummary.length > 50 ? `${cleanSummary.slice(0, 47)}...` : cleanSummary);
  } else if (hit.snippet) {
    const cleanSnippet = redactSecrets(hit.snippet.replace(/[\r\n]+/g, " ").trim(), secrets);
    parts.push(cleanSnippet.length > 50 ? `${cleanSnippet.slice(0, 47)}...` : cleanSnippet);
  } else if (!title && hit.leafId) {
    parts.push(`leaf: ${hit.leafId.slice(0, 8)}`);
  } else if (!title) {
    parts.push("empty session");
  }

  return {
    name,
    value: hit.sessionId,
    description: parts.join(" | "),
  };
}

export interface CompactSessionOptions {
  readonly session: AgentSession;
  readonly provider: AIProvider;
  readonly model: ModelConfig;
  readonly customInstructions?: string;
  readonly signal?: AbortSignal;
}

/**
 * Compacts the active session branch using the coding LLM compaction strategy.
 * Raw transcript entries remain in the store; the session leaf moves to a new compaction entry.
 * If provider or summarization fails, throws without altering the session leaf.
 */
export async function compactSession(options: CompactSessionOptions): Promise<CompactionResult> {
  const strategy = createCodingCompactionStrategy({
    provider: options.provider,
    model: options.model,
    customInstructions: options.customInstructions,
  });

  return options.session.compact({
    strategy,
    signal: options.signal,
  });
}
