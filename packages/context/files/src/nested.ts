import { readFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type {
  AgentState,
  ContextDraft,
  HookContext,
  JsonValue,
  Message,
  PackageAPI,
  SessionContext,
  SessionLog,
  TrustPolicy,
} from "@arnilo/prism";
import { isPathInside, isTrusted } from "@arnilo/prism";
import type { ContextFilesConfig } from "./config.js";
import { agentFileCandidates } from "./layers.js";

export const DEFAULT_NESTED_MAX_FILE_BYTES = 16_384;
export const HARD_NESTED_MAX_FILE_BYTES = 65_536;
export const DEFAULT_NESTED_MAX_FILES = 16;
export const HARD_NESTED_MAX_FILES = 16;

export interface ResolvedNestedConfig {
  readonly maxFileBytes: number;
  readonly maxFiles: number;
}

/** `nested` config normalized. `false` disables the feature; an absent value is the default. */
export function resolveNestedConfig(value: ContextFilesConfig["nested"]): ResolvedNestedConfig | undefined {
  if (value === false) return undefined;
  if (value === undefined || value === true) {
    return { maxFileBytes: DEFAULT_NESTED_MAX_FILE_BYTES, maxFiles: DEFAULT_NESTED_MAX_FILES };
  }
  const maxFileBytes = value.maxFileBytes ?? DEFAULT_NESTED_MAX_FILE_BYTES;
  const maxFiles = value.maxFiles ?? DEFAULT_NESTED_MAX_FILES;
  if (!Number.isInteger(maxFileBytes) || maxFileBytes < 1 || maxFileBytes > HARD_NESTED_MAX_FILE_BYTES) {
    throw new RangeError(`nested.maxFileBytes must be an integer from 1 to ${HARD_NESTED_MAX_FILE_BYTES}`);
  }
  if (!Number.isInteger(maxFiles) || maxFiles < 1 || maxFiles > HARD_NESTED_MAX_FILES) {
    throw new RangeError(`nested.maxFiles must be an integer from 1 to ${HARD_NESTED_MAX_FILES}`);
  }
  return { maxFileBytes, maxFiles };
}

/** The part of the plan nested instructions need. Kept structural so this module does not import `index.ts`. */
export interface NestedPlan {
  readonly root: string;
  readonly trust: TrustPolicy;
}

/** One frozen insertion. `dir` / `file` are root-relative POSIX paths; `part` is the exact text part. */
interface NestedInsertionRecord {
  readonly toolCallId: string;
  readonly dir: string;
  readonly file: string;
  readonly part: string;
}

interface FileCache {
  readonly mtime: number;
  readonly size: number;
  readonly text: string;
}

interface NestedSessionCache {
  readonly processed: Set<string>;
  readonly files: Map<string, FileCache>;
  readonly noted: Set<string>;
}

/**
 * Register the just-in-time nested prompt-file handler. The session log holds each first insertion's
 * exact bytes, so a later request reproduces it after a file edit; compaction removes the anchoring
 * tool result and the next touch inserts the then-current file.
 */
export function installNested(prism: PackageAPI<ContextFilesConfig>, plan: NestedPlan, config: ResolvedNestedConfig): void {
  const insertions = prism.state.log<JsonValue>("nested");
  const sessions = prism.state.agent<Map<string, NestedSessionCache>>("nested-sessions", new Map());
  prism.hooks.on("context.build", (draft: ContextDraft, context: HookContext) =>
    projectNestedInstructions(draft, context, prism, plan, config, insertions, sessions),
  );
}

export async function projectNestedInstructions(
  draft: ContextDraft,
  context: HookContext,
  prism: PackageAPI<ContextFilesConfig>,
  plan: NestedPlan,
  config: ResolvedNestedConfig,
  insertions: SessionLog<JsonValue>,
  sessions: AgentState<Map<string, NestedSessionCache>>,
): Promise<ContextDraft | undefined> {
  const session = context.session;
  if (!session) return undefined;
  const records = insertions.entries(session) as unknown as readonly NestedInsertionRecord[];
  const byCall = new Map<string, NestedInsertionRecord[]>();
  for (const record of records) {
    const list = byCall.get(record.toolCallId);
    if (list) list.push(record);
    else byCall.set(record.toolCallId, [record]);
  }
  const calls = toolCallsById(draft.messages);
  const cache = cacheFor(sessions.get(), session);
  const visibleDirs = new Set<string>();
  const existingFiles = new Set(records.map((record) => record.file));
  let messages: Message[] | undefined;

  // Re-attach recorded bytes to their anchoring tool result. This is the provider-view projection:
  // the text never enters the stored transcript, so it must be rebuilt every turn.
  for (let index = 0; index < draft.messages.length; index++) {
    const message = draft.messages[index]!;
    const result = toolResult(message);
    if (!result) continue;
    const anchored = byCall.get(result.toolCallId);
    if (!anchored?.length) continue;
    for (const record of anchored) visibleDirs.add(record.dir);
    const next = withRecords(message, anchored);
    if (next !== message) {
      messages ??= [...draft.messages];
      messages[index] = next;
    }
  }

  // New tool results: pair the result with its assistant call and inspect only path arguments.
  for (let index = 0; index < draft.messages.length; index++) {
    const message = draft.messages[index]!;
    const result = toolResult(message);
    if (!result || cache.processed.has(result.toolCallId)) continue;
    const anchored = byCall.get(result.toolCallId);
    if (anchored?.length) {
      cache.processed.add(result.toolCallId);
      continue;
    }
    const call = calls.get(result.toolCallId);
    if (!call) {
      cache.processed.add(result.toolCallId);
      continue;
    }
    const targets = pathTargets(call, plan.root);
    let current = message;
    for (const target of targets) {
      const base = target.mayBeFile ? await directoryOf(target.directory) : target.directory;
      for (const directory of candidateDirectories(plan.root, base)) {
        const dir = relativePath(plan.root, directory);
        if (visibleDirs.has(dir)) continue;
        const probe = await probeAgentFile(directory);
        if (!probe) continue;

        if (!(await isTrusted(plan.trust, { kind: "project", target: probe.path }))) {
          noteOnce(prism, cache, "warn", `trust:${probe.path}`, `skipped nested instructions ${probe.path}: outside trusted roots`);
          continue;
        }
        if (probe.size > config.maxFileBytes) {
          noteOnce(
            prism,
            cache,
            "info",
            `size:${probe.path}`,
            `skipped nested instructions ${probe.path}: ${probe.size} bytes exceeds maxFileBytes (${config.maxFileBytes})`,
          );
          continue;
        }
        const file = relativePath(plan.root, probe.path);
        if (!existingFiles.has(file) && existingFiles.size >= config.maxFiles) {
          noteOnce(
            prism,
            cache,
            "info",
            `files:${probe.path}`,
            `skipped nested instructions ${probe.path}: maxFiles (${config.maxFiles}) reached`,
          );
          continue;
        }
        const text = await readCached(probe, cache);
        if (text === undefined) continue;
        if (Buffer.byteLength(text, "utf8") > config.maxFileBytes) {
          noteOnce(
            prism,
            cache,
            "info",
            `size:${probe.path}`,
            `skipped nested instructions ${probe.path}: text exceeds maxFileBytes (${config.maxFileBytes})`,
          );
          continue;
        }
        const record: NestedInsertionRecord = {
          toolCallId: result.toolCallId,
          dir,
          file,
          part: `[context-files] Instructions for ${dir}/ (from ${file}):\n${text}`,
        };
        await insertions.append(session, record as unknown as JsonValue);
        existingFiles.add(file);
        visibleDirs.add(dir);
        current = withRecords(current, [record]);
      }
    }
    cache.processed.add(result.toolCallId);
    if (current !== message) {
      messages ??= [...draft.messages];
      messages[index] = current;
    }
  }

  return messages ? { ...draft, messages } : undefined;
}

function cacheFor(sessions: Map<string, NestedSessionCache>, session: SessionContext): NestedSessionCache {
  const key = session.id;
  const existing = sessions.get(key);
  if (existing) return existing;
  const created: NestedSessionCache = { processed: new Set(), files: new Map(), noted: new Set() };
  sessions.set(key, created);
  return created;
}

interface ToolCall {
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

function toolCallsById(messages: readonly Message[]): Map<string, ToolCall> {
  const calls = new Map<string, ToolCall>();
  for (const message of messages) {
    for (const part of message.content) {
      if (part.type === "tool_call")
        calls.set(part.id, { name: part.name, arguments: part.arguments as Readonly<Record<string, unknown>> });
    }
  }
  return calls;
}

function toolResult(message: Message): Extract<Message["content"][number], { type: "tool_result" }> | undefined {
  if (message.role !== "tool") return undefined;
  const result = message.content.find((part) => part.type === "tool_result");
  return result?.type === "tool_result" ? result : undefined;
}

interface PathTarget {
  readonly directory: string;
  /** `grep` and `glob` take a directory or a single file; a file's instructions come from its directory. */
  readonly mayBeFile: boolean;
}

const FILE_PATH_TOOLS = new Set(["read", "edit", "write", "diagnostics"]);
const DIRECTORY_PATH_TOOLS = new Set(["grep", "glob"]);

/** The path arguments that make a tool touch a subtree, as root-absolute directories. */
function pathTargets(call: ToolCall, root: string): readonly PathTarget[] {
  const values: { readonly value: unknown; readonly directory: boolean }[] = [];
  if (FILE_PATH_TOOLS.has(call.name)) values.push({ value: call.arguments.path, directory: false });
  else if (DIRECTORY_PATH_TOOLS.has(call.name)) values.push({ value: call.arguments.path, directory: true });
  else if (call.name === "move") {
    values.push({ value: call.arguments.from, directory: false }, { value: call.arguments.to, directory: false });
  }
  const targets: PathTarget[] = [];
  for (const { value, directory } of values) {
    if (typeof value !== "string" || value.trim() === "") continue;
    const absolute = resolve(root, value);
    const target = directory ? absolute : dirname(absolute);
    if (!isPathInside(root, target)) continue;
    targets.push({ directory: target, mayBeFile: directory });
  }
  return targets;
}

/** Directories from `root` (exclusive) down to `target` (inclusive), outermost first. */
function candidateDirectories(root: string, target: string): readonly string[] {
  const base = resolve(root);
  const dirs: string[] = [];
  for (let directory = resolve(target); directory !== base; directory = dirname(directory)) {
    if (!isPathInside(base, directory)) return [];
    dirs.unshift(directory);
    if (dirname(directory) === directory) break;
  }
  return dirs;
}

/** A `grep`/`glob` path that names a file touches the file's directory; a missing path stays as given. */
async function directoryOf(path: string): Promise<string> {
  try {
    return (await stat(path)).isDirectory() ? path : dirname(path);
  } catch (error) {
    if (isEnoent(error) || isNotDirectory(error)) return path;
    throw error;
  }
}

interface AgentFileProbe {
  readonly path: string;
  readonly size: number;
  readonly mtime: number;
}

async function probeAgentFile(directory: string): Promise<AgentFileProbe | undefined> {
  for (const path of agentFileCandidates(directory)) {
    try {
      const info = await stat(path);
      if (!info.isFile()) continue;
      return { path, size: info.size, mtime: info.mtime.getTime() };
    } catch (error) {
      // ENOTDIR: a path component is a file (a tool path that runs through one), so no directory holds the file.
      if (!isEnoent(error) && !isNotDirectory(error)) throw error;
    }
  }
  return undefined;
}

async function readCached(probe: AgentFileProbe, cache: NestedSessionCache): Promise<string | undefined> {
  const cached = cache.files.get(probe.path);
  if (cached && cached.mtime === probe.mtime && cached.size === probe.size) return cached.text;
  try {
    const text = await readFile(probe.path, "utf8");
    cache.files.set(probe.path, { mtime: probe.mtime, size: probe.size, text });
    return text;
  } catch (error) {
    if (isEnoent(error)) return undefined;
    throw error;
  }
}

function withRecords(message: Message, records: readonly NestedInsertionRecord[]): Message {
  const existingTexts = new Set(message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])));
  const missing = records.filter((record) => !existingTexts.has(record.part));
  const priorFiles = contextFiles(message);
  const files = unique([...priorFiles, ...records.map((record) => record.file)]);
  const metadataChanged = message.metadata?.source !== "context-files-nested" || files.length !== priorFiles.length;
  if (missing.length === 0 && !metadataChanged) return message;
  return {
    ...message,
    content: [...message.content, ...missing.map((record): Message["content"][number] => ({ type: "text", text: record.part }))],
    metadata: { ...message.metadata, contextFiles: files, source: "context-files-nested" },
  };
}

function contextFiles(message: Message): readonly string[] {
  const value = message.metadata?.contextFiles;
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function relativePath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function noteOnce(
  prism: PackageAPI<ContextFilesConfig>,
  cache: NestedSessionCache,
  level: "info" | "warn",
  key: string,
  message: string,
): void {
  if (cache.noted.has(key)) return;
  cache.noted.add(key);
  prism.status.note(level, message);
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { readonly code?: unknown }).code === "ENOENT";
}

function isNotDirectory(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { readonly code?: unknown }).code === "ENOTDIR";
}

/** `AGENTS.md` candidates from the outermost enclosing trusted root down to `root`. */
export function agentsMdCandidates(root: string, trustedRoots: readonly string[]): readonly string[] {
  const dirs = [root];
  for (let dir = root; ; ) {
    const parent = dirname(dir);
    if (parent === dir || !trustedRoots.some((trusted) => isPathInside(trusted, parent))) break;
    dirs.unshift(parent);
    dir = parent;
  }
  return dirs.map((dir) => join(dir, "AGENTS.md"));
}
