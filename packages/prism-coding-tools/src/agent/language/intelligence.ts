/**
 * Host-selected language intelligence over one bounded in-package LSP client.
 * Servers spawn only on first use; URIs confined to workspaceRoot; renames gated by ExecutionPolicy.
 */

import { readFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertExecutionAllowed, ExecutionDeniedError } from "@arnilo/prism";
import { atomicWriteUtf8File } from "../atomic-write.js";
import { diagnosticDelta, type NormalizedDiagnostic } from "../diagnostics.js";
import { withFileMutationQueue } from "../file-mutation-queue.js";
import { resolveContainedMutationPath } from "../mutation-path.js";
import { LspClient } from "./client.js";
import {
  type CreateLanguageIntelligenceOptions,
  type LanguageDiagnostic,
  type LanguageIntelligence,
  LanguageIntelligenceError,
  type LanguageLocation,
  type LanguageServerSpec,
  type LanguageSymbol,
  type LanguageTextEdit,
  type LanguageWorkspaceEdit,
  resolveLanguageIntelligenceLimits,
} from "./types.js";

const EXT_LANGUAGE: Readonly<Record<string, string>> = {
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascriptreact",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".json": "json",
  ".md": "markdown",
  ".css": "css",
  ".html": "html",
};

export function createLanguageIntelligence(options: CreateLanguageIntelligenceOptions): LanguageIntelligence {
  const workspaceRoot = resolve(options.workspaceRoot);
  const limits = resolveLanguageIntelligenceLimits(options.limits);
  const serverEntries = Object.entries(options.servers);
  if (serverEntries.length === 0) {
    throw new LanguageIntelligenceError("ERR_PRISM_LSP_UNSUPPORTED", "servers map must not be empty");
  }
  if (serverEntries.length > limits.maxServers) {
    throw new LanguageIntelligenceError(
      "ERR_PRISM_LSP_LIMIT",
      `servers map has ${serverEntries.length} entries; maxServers is ${limits.maxServers}`,
    );
  }
  for (const [name, spec] of serverEntries) {
    assertHostServerSpec(name, spec);
  }

  const rootUri = pathToFileURL(workspaceRoot).href;
  const clients = new Map<string, LspClient>();
  const opened = new Map<string, Set<string>>(); // serverName → opened URIs
  const crashCounts = new Map<string, number>();
  let disposed = false;

  function getOrCreateClient(serverName: string, spec: LanguageServerSpec): LspClient {
    let client = clients.get(serverName);
    if (client) return client;
    const crashes = crashCounts.get(serverName) ?? 0;
    if (crashes > limits.maxRestartsPerServer) {
      throw new LanguageIntelligenceError(
        "ERR_PRISM_LSP_SERVER",
        `LSP server ${serverName} exceeded restart budget (${limits.maxRestartsPerServer})`,
      );
    }
    client = new LspClient(
      {
        name: serverName,
        command: spec.command,
        args: spec.args ?? [],
        env: spec.env,
        cwd: workspaceRoot,
        rootUri,
      },
      limits,
      {
        onUnexpectedExit: () => {
          clients.delete(serverName);
          opened.delete(serverName);
          crashCounts.set(serverName, (crashCounts.get(serverName) ?? 0) + 1);
        },
      },
    );
    clients.set(serverName, client);
    return client;
  }

  function findServerForLanguage(languageId: string): { name: string; spec: LanguageServerSpec } | undefined {
    for (const [name, spec] of serverEntries) {
      if (spec.languages.includes(languageId)) return { name, spec };
    }
    return undefined;
  }

  async function clientForFile(
    file: string,
    signal?: AbortSignal,
  ): Promise<{ client: LspClient; abs: string; uri: string; languageId: string }> {
    assertNotDisposed();
    const candidate = resolveWorkspacePathLoose(workspaceRoot, file);
    const languageId = languageIdForPath(candidate);
    const match = findServerForLanguage(languageId);
    if (!match) {
      throw new LanguageIntelligenceError(
        "ERR_PRISM_LSP_UNSUPPORTED",
        `No host server registered for language ${languageId} (file ${file})`,
      );
    }
    const abs = await resolveWorkspaceFile(workspaceRoot, file);
    const client = getOrCreateClient(match.name, match.spec);
    try {
      await client.ensureStarted(signal);
    } catch (error) {
      clients.delete(match.name);
      opened.delete(match.name);
      crashCounts.set(match.name, (crashCounts.get(match.name) ?? 0) + 1);
      try {
        const retry = getOrCreateClient(match.name, match.spec);
        await retry.ensureStarted(signal);
        const uri = fileUriFor(workspaceRoot, abs);
        await ensureOpen(retry, match.name, uri, abs, languageId, signal);
        return { client: retry, abs, uri, languageId };
      } catch {
        throw mapError(error);
      }
    }
    const uri = fileUriFor(workspaceRoot, abs);
    await ensureOpen(client, match.name, uri, abs, languageId, signal);
    return { client, abs, uri, languageId };
  }

  async function ensureOpen(
    client: LspClient,
    serverName: string,
    uri: string,
    abs: string,
    languageId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    let set = opened.get(serverName);
    if (!set) {
      set = new Set();
      opened.set(serverName, set);
    }
    if (set.has(uri)) return;
    const text = await readFile(abs, "utf8");
    if (signal?.aborted) {
      throw new LanguageIntelligenceError("ERR_PRISM_LSP_TIMEOUT", "LSP open aborted");
    }
    client.notify("textDocument/didOpen", {
      textDocument: { uri, languageId, version: 1, text },
    });
    client.documentVersions.set(uri, 1);
    set.add(uri);
  }

  async function ensureAllStarted(signal?: AbortSignal): Promise<LspClient[]> {
    assertNotDisposed();
    const out: LspClient[] = [];
    for (const [name, spec] of serverEntries) {
      const client = getOrCreateClient(name, spec);
      await client.ensureStarted(signal);
      out.push(client);
    }
    return out;
  }

  function assertNotDisposed(): void {
    if (disposed) {
      throw new LanguageIntelligenceError("ERR_PRISM_LSP_SERVER", "LanguageIntelligence is disposed");
    }
  }

  const api: LanguageIntelligence = {
    async workspaceSymbols(query, opts) {
      const clientsList = await ensureAllStarted(opts?.signal);
      const symbols: LanguageSymbol[] = [];
      for (const client of clientsList) {
        if (!client.hasCapability("workspaceSymbolProvider")) continue;
        const result = await client.request("workspace/symbol", { query }, opts?.signal);
        for (const item of asArray(result)) {
          const sym = normalizeSymbol(workspaceRoot, item);
          if (sym) symbols.push(sym);
          if (symbols.length >= limits.maxResultsPerQuery) {
            return symbols.slice(0, limits.maxResultsPerQuery);
          }
        }
      }
      return symbols;
    },

    async definitions(loc, opts) {
      const { client, uri } = await clientForFile(loc.file, opts?.signal);
      if (!client.hasCapability("definitionProvider")) {
        throw new LanguageIntelligenceError("ERR_PRISM_LSP_UNSUPPORTED", "Server does not advertise definitionProvider");
      }
      const result = await client.request(
        "textDocument/definition",
        { textDocument: { uri }, position: { line: loc.line, character: loc.character } },
        opts?.signal,
      );
      return takeLocations(workspaceRoot, result, limits.maxResultsPerQuery);
    },

    async references(loc, opts) {
      const { client, uri } = await clientForFile(loc.file, opts?.signal);
      if (!client.hasCapability("referencesProvider")) {
        throw new LanguageIntelligenceError("ERR_PRISM_LSP_UNSUPPORTED", "Server does not advertise referencesProvider");
      }
      const result = await client.request(
        "textDocument/references",
        {
          textDocument: { uri },
          position: { line: loc.line, character: loc.character },
          context: { includeDeclaration: true },
        },
        opts?.signal,
      );
      return takeLocations(workspaceRoot, result, limits.maxResultsPerQuery);
    },

    async diagnostics(file, opts) {
      assertNotDisposed();
      if (file) {
        const { client, uri } = await clientForFile(file, opts?.signal);
        return normalizeDiagnostics(workspaceRoot, uri, client.diagnosticsByUri.get(uri), limits.maxDiagnosticsPerFile);
      }
      await ensureAllStarted(opts?.signal);
      const out: LanguageDiagnostic[] = [];
      for (const client of clients.values()) {
        for (const [uri, diags] of client.diagnosticsByUri) {
          out.push(...normalizeDiagnostics(workspaceRoot, uri, diags, limits.maxDiagnosticsPerFile));
          if (out.length >= limits.maxResultsPerQuery) {
            return out.slice(0, limits.maxResultsPerQuery);
          }
        }
      }
      return out;
    },

    async hover(loc, opts) {
      const { client, uri } = await clientForFile(loc.file, opts?.signal);
      if (!client.hasCapability("hoverProvider")) {
        throw new LanguageIntelligenceError("ERR_PRISM_LSP_UNSUPPORTED", "Server does not advertise hoverProvider");
      }
      const result = await client.request(
        "textDocument/hover",
        { textDocument: { uri }, position: { line: loc.line, character: loc.character } },
        opts?.signal,
      );
      if (!result || typeof result !== "object") return undefined;
      const contents = (result as { contents?: unknown }).contents;
      const text = hoverToText(contents);
      return text === undefined ? undefined : { text };
    },

    async syncDocument(file, opts) {
      assertNotDisposed();
      const { client, uri, abs } = await clientForFile(file, opts?.signal);
      const text = await readFile(abs, "utf8");
      if (opts?.signal?.aborted) {
        throw new LanguageIntelligenceError("ERR_PRISM_LSP_TIMEOUT", "syncDocument aborted");
      }
      client.didChange(uri, text);
      const version = client.documentVersions.get(uri) ?? 1;
      return { version };
    },

    async diagnosticDelta(request, opts) {
      assertNotDisposed();
      if (!Array.isArray(request.files) || request.files.length === 0) {
        throw new LanguageIntelligenceError("ERR_PRISM_LSP_UNSUPPORTED", "diagnosticDelta requires a non-empty files list");
      }
      if (request.files.length > limits.maxResultsPerQuery) {
        throw new LanguageIntelligenceError("ERR_PRISM_LSP_LIMIT", `diagnosticDelta files exceed ${limits.maxResultsPerQuery}`);
      }
      const previous = request.previous ?? {};
      const files: Record<string, import("../diagnostics.js").DiagnosticDelta> = {};
      let latestGeneration = 0;
      for (const file of request.files) {
        const { client, uri } = await clientForFile(file, opts?.signal);
        const pulled = await client.pullDiagnostics(uri, opts?.signal);
        // Stale-version guard: the pull result carries the version at request
        // time; if the document advanced meanwhile, drop the response.
        const currentVersion = client.documentVersions.get(uri) ?? 1;
        if (pulled.version < currentVersion) continue;
        const generation = currentVersion;
        latestGeneration = Math.max(latestGeneration, generation);
        const prior = previous[file];
        if (prior && prior.generation > generation) continue; // stale previous view
        const raw = normalizeDiagnostics(workspaceRoot, uri, pulled.diagnostics, limits.maxDiagnosticsPerFile);
        const stamped: NormalizedDiagnostic[] = raw.map((diagnostic) => ({
          file: diagnostic.file,
          line: diagnostic.line,
          character: diagnostic.character,
          endLine: diagnostic.endLine,
          endCharacter: diagnostic.endCharacter,
          severity: diagnostic.severity,
          message: diagnostic.message,
          source: diagnostic.source ?? "lsp",
          code: diagnostic.code,
          generation,
        }));
        const delta = diagnosticDelta({
          next: stamped,
          previous: prior?.diagnostics,
        });
        files[file] = delta;
      }
      return { files, generation: latestGeneration };
    },

    async rename(loc, opts) {
      if (!loc.newName || typeof loc.newName !== "string") {
        throw new LanguageIntelligenceError("ERR_PRISM_LSP_UNSUPPORTED", "newName is required");
      }
      const { client, uri } = await clientForFile(loc.file, opts?.signal);
      if (!client.hasCapability("renameProvider")) {
        throw new LanguageIntelligenceError("ERR_PRISM_LSP_UNSUPPORTED", "Server does not advertise renameProvider");
      }
      const result = await client.request(
        "textDocument/rename",
        {
          textDocument: { uri },
          position: { line: loc.line, character: loc.character },
          newName: loc.newName,
        },
        opts?.signal,
      );
      const edit = normalizeWorkspaceEdit(workspaceRoot, result, limits.maxResultsPerQuery);
      await applyWorkspaceEdit(workspaceRoot, edit, options.policy, opts?.signal);
      return edit;
    },

    async dispose() {
      disposed = true;
      const all = [...clients.values()];
      clients.clear();
      opened.clear();
      await Promise.all(all.map((c) => c.dispose()));
    },
  };

  return api;
}

function assertHostServerSpec(name: string, spec: LanguageServerSpec): void {
  if (!spec || typeof spec.command !== "string" || spec.command.length === 0) {
    throw new LanguageIntelligenceError("ERR_PRISM_LSP_UNSUPPORTED", `Server ${name}: command is required`);
  }
  if (!Array.isArray(spec.languages) || spec.languages.length === 0) {
    throw new LanguageIntelligenceError("ERR_PRISM_LSP_UNSUPPORTED", `Server ${name}: languages must be non-empty`);
  }
  if (spec.args !== undefined && !Array.isArray(spec.args)) {
    throw new LanguageIntelligenceError("ERR_PRISM_LSP_UNSUPPORTED", `Server ${name}: args must be an array`);
  }
}

function languageIdForPath(absPath: string): string {
  const ext = extname(absPath).toLowerCase();
  return EXT_LANGUAGE[ext] ?? "plaintext";
}

function resolveWorkspacePathLoose(workspaceRoot: string, file: string): string {
  const root = resolve(workspaceRoot);
  const candidate = resolve(root, file);
  const rel = relative(root, candidate);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new LanguageIntelligenceError("ERR_PRISM_LSP_WORKSPACE", `path escapes workspace root: ${file}`);
  }
  return candidate;
}

async function resolveWorkspaceFile(workspaceRoot: string, file: string): Promise<string> {
  try {
    return await resolveContainedMutationPath(workspaceRoot, file);
  } catch (error) {
    throw new LanguageIntelligenceError("ERR_PRISM_LSP_WORKSPACE", error instanceof Error ? error.message : String(error));
  }
}

function fileUriFor(workspaceRoot: string, absPath: string): string {
  const rootReal = resolve(workspaceRoot);
  const abs = resolve(absPath);
  const rel = relative(rootReal, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new LanguageIntelligenceError("ERR_PRISM_LSP_WORKSPACE", `URI escapes workspace: ${absPath}`);
  }
  return pathToFileURL(abs).href;
}

function uriToWorkspaceFile(workspaceRoot: string, uri: string): string {
  let abs: string;
  try {
    abs = resolve(fileUrlToPathSafe(uri));
  } catch {
    throw new LanguageIntelligenceError("ERR_PRISM_LSP_WORKSPACE", `Invalid file URI: ${uri}`);
  }
  const root = resolve(workspaceRoot);
  const rel = relative(root, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new LanguageIntelligenceError("ERR_PRISM_LSP_WORKSPACE", `URI outside workspace: ${uri}`);
  }
  return rel.split("\\").join("/");
}

function fileUrlToPathSafe(uri: string): string {
  if (!uri.startsWith("file:")) {
    throw new LanguageIntelligenceError("ERR_PRISM_LSP_WORKSPACE", `Non-file URI rejected: ${uri}`);
  }
  try {
    return fileURLToPath(uri);
  } catch {
    throw new LanguageIntelligenceError("ERR_PRISM_LSP_WORKSPACE", `Invalid file URI: ${uri}`);
  }
}

function asArray(value: unknown): unknown[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function takeLocations(workspaceRoot: string, result: unknown, max: number): LanguageLocation[] {
  const out: LanguageLocation[] = [];
  for (const item of asArray(result)) {
    const loc = normalizeLocation(workspaceRoot, item);
    if (loc) out.push(loc);
    if (out.length >= max) break;
  }
  return out;
}

function normalizeLocation(workspaceRoot: string, item: unknown): LanguageLocation | undefined {
  if (!item || typeof item !== "object") return undefined;
  const obj = item as {
    uri?: string;
    targetUri?: string;
    range?: { start?: { line?: number; character?: number } };
    targetRange?: { start?: { line?: number; character?: number } };
    targetSelectionRange?: { start?: { line?: number; character?: number } };
  };
  const uri = obj.uri ?? obj.targetUri;
  if (typeof uri !== "string") return undefined;
  const start = obj.range?.start ?? obj.targetSelectionRange?.start ?? obj.targetRange?.start ?? { line: 0, character: 0 };
  return {
    file: uriToWorkspaceFile(workspaceRoot, uri),
    line: Number(start.line ?? 0),
    character: Number(start.character ?? 0),
  };
}

function normalizeSymbol(workspaceRoot: string, item: unknown): LanguageSymbol | undefined {
  if (!item || typeof item !== "object") return undefined;
  const obj = item as {
    name?: string;
    kind?: number;
    containerName?: string;
    location?: { uri?: string; range?: { start?: { line?: number; character?: number } } };
  };
  if (typeof obj.name !== "string" || typeof obj.location?.uri !== "string") return undefined;
  const start = obj.location.range?.start ?? { line: 0, character: 0 };
  return {
    name: obj.name,
    kind: typeof obj.kind === "number" ? obj.kind : 0,
    file: uriToWorkspaceFile(workspaceRoot, obj.location.uri),
    line: Number(start.line ?? 0),
    character: Number(start.character ?? 0),
    containerName: typeof obj.containerName === "string" ? obj.containerName : undefined,
  };
}

function normalizeDiagnostics(workspaceRoot: string, uri: string, raw: unknown, maxPerFile: number): LanguageDiagnostic[] {
  let file: string;
  try {
    file = uriToWorkspaceFile(workspaceRoot, uri);
  } catch {
    return [];
  }
  const list = Array.isArray(raw) ? raw : [];
  const out: LanguageDiagnostic[] = [];
  for (const d of list) {
    if (!d || typeof d !== "object") continue;
    const diag = d as {
      range?: { start?: { line?: number; character?: number }; end?: { line?: number; character?: number } };
      severity?: number;
      message?: string;
      source?: string;
      code?: string | number;
    };
    if (typeof diag.message !== "string") continue;
    const start = diag.range?.start ?? { line: 0, character: 0 };
    const end = diag.range?.end ?? start;
    out.push({
      file,
      line: Number(start.line ?? 0),
      character: Number(start.character ?? 0),
      endLine: Number(end.line ?? 0),
      endCharacter: Number(end.character ?? 0),
      severity: severityName(diag.severity),
      message: diag.message,
      source: typeof diag.source === "string" ? diag.source : undefined,
      code: typeof diag.code === "string" || typeof diag.code === "number" ? diag.code : undefined,
    });
    if (out.length >= maxPerFile) break;
  }
  return out;
}

function severityName(severity: number | undefined): LanguageDiagnostic["severity"] {
  switch (severity) {
    case 1:
      return "error";
    case 2:
      return "warning";
    case 3:
      return "info";
    case 4:
      return "hint";
    default:
      return "error";
  }
}

function hoverToText(contents: unknown): string | undefined {
  if (contents == null) return undefined;
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents)) {
    return (
      contents
        .map((c) => hoverToText(c) ?? "")
        .filter(Boolean)
        .join("\n") || undefined
    );
  }
  if (typeof contents === "object") {
    const o = contents as { value?: string; language?: string };
    if (typeof o.value === "string") return o.value;
  }
  return undefined;
}

function normalizeWorkspaceEdit(workspaceRoot: string, result: unknown, maxEdits: number): LanguageWorkspaceEdit {
  if (!result || typeof result !== "object") {
    return { edits: [] };
  }
  const edits: LanguageTextEdit[] = [];
  const obj = result as {
    changes?: Record<string, Array<{ range?: LanguageTextEdit["range"]; newText?: string }>>;
    documentChanges?: unknown[];
  };

  if (obj.changes) {
    for (const [uri, changeList] of Object.entries(obj.changes)) {
      const file = uriToWorkspaceFile(workspaceRoot, uri);
      for (const c of changeList ?? []) {
        if (!c?.range || typeof c.newText !== "string") continue;
        edits.push({ file, range: c.range, newText: c.newText });
        if (edits.length >= maxEdits) return { edits };
      }
    }
  }

  if (Array.isArray(obj.documentChanges)) {
    for (const dc of obj.documentChanges) {
      if (!dc || typeof dc !== "object") continue;
      const doc = dc as {
        textDocument?: { uri?: string };
        edits?: Array<{ range?: LanguageTextEdit["range"]; newText?: string }>;
      };
      if (typeof doc.textDocument?.uri !== "string" || !Array.isArray(doc.edits)) continue;
      const file = uriToWorkspaceFile(workspaceRoot, doc.textDocument.uri);
      for (const c of doc.edits) {
        if (!c?.range || typeof c.newText !== "string") continue;
        edits.push({ file, range: c.range, newText: c.newText });
        if (edits.length >= maxEdits) return { edits };
      }
    }
  }

  return { edits };
}

async function applyWorkspaceEdit(
  workspaceRoot: string,
  edit: LanguageWorkspaceEdit,
  policy: CreateLanguageIntelligenceOptions["policy"],
  signal?: AbortSignal,
): Promise<void> {
  if (edit.edits.length === 0) return;
  const paths = [...new Set(edit.edits.map((e) => resolve(workspaceRoot, e.file)))];
  try {
    await assertExecutionAllowed(policy, {
      kind: "edit",
      operation: "rename",
      paths,
      risk: "high",
      metadata: { editCount: edit.edits.length, signal },
    });
  } catch (error) {
    if (error instanceof ExecutionDeniedError) {
      throw new LanguageIntelligenceError("ERR_PRISM_LSP_UNSUPPORTED", error.message);
    }
    throw error;
  }

  const byFile = new Map<string, LanguageTextEdit[]>();
  for (const e of edit.edits) {
    const list = byFile.get(e.file) ?? [];
    list.push(e);
    byFile.set(e.file, list);
  }

  for (const [file, fileEdits] of byFile) {
    const abs = await resolveContainedMutationPath(workspaceRoot, file);
    await withFileMutationQueue(abs, async () => {
      if (signal?.aborted) {
        throw new LanguageIntelligenceError("ERR_PRISM_LSP_TIMEOUT", "Rename aborted");
      }
      const original = await readFile(abs, "utf8");
      const next = applyTextEdits(original, fileEdits);
      await atomicWriteUtf8File(abs, next, { signal });
    });
  }
}

/** Apply LSP text edits (0-based line/character) from end to start. */
export function applyTextEdits(content: string, edits: readonly LanguageTextEdit[]): string {
  const sorted = [...edits].sort((a, b) => {
    if (a.range.start.line !== b.range.start.line) return b.range.start.line - a.range.start.line;
    return b.range.start.character - a.range.start.character;
  });
  let text = content;
  for (const e of sorted) {
    const start = offsetAt(text, e.range.start.line, e.range.start.character);
    const end = offsetAt(text, e.range.end.line, e.range.end.character);
    text = text.slice(0, start) + e.newText + text.slice(end);
  }
  return text;
}

function offsetAt(text: string, line: number, character: number): number {
  let lineNo = 0;
  let i = 0;
  while (i < text.length && lineNo < line) {
    if (text[i] === "\n") lineNo += 1;
    i += 1;
  }
  return Math.min(i + character, text.length);
}

function mapError(error: unknown): never {
  if (error instanceof LanguageIntelligenceError) throw error;
  throw new LanguageIntelligenceError("ERR_PRISM_LSP_SERVER", error instanceof Error ? error.message : String(error));
}

export type {
  CreateLanguageIntelligenceOptions,
  LanguageDiagnostic,
  LanguageIntelligence,
  LanguageIntelligenceLimits,
  LanguageLocation,
  LanguageServerSpec,
  LanguageSymbol,
  LanguageTextEdit,
  LanguageWorkspaceEdit,
} from "./types.js";
export { LanguageIntelligenceError, resolveLanguageIntelligenceLimits } from "./types.js";
