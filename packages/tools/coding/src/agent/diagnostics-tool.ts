/**
 * `diagnostics` tool: the host-configured language server's diagnostics for one file, as
 * `path:line:col severity message`. Opt-in — no `language.servers` config means no tool and no
 * server process. Commands come from host config only; the model supplies a path.
 */

import type { JsonObject, ToolDefinition, ToolExecutionContext, ToolResult } from "@arnilo/prism";
import { resolveDiagnosticsLimits } from "./diagnostics.js";
import { CODING_OBSERVATION_EFFECT } from "./effects.js";
import type { ExecutionPolicy } from "./execution-policy.js";
import { createLanguageIntelligence, type LanguageIntelligence, type LanguageServerSpec } from "./language/index.js";
import { languageIdForPath } from "./language/intelligence.js";

/** How long a push-only server gets to publish after the document opens. */
const DIAGNOSTICS_SETTLE_MS = 500;
const DIAGNOSTICS_POLL_MS = 25;

export interface DiagnosticsToolOptions {
  /** Host-configured servers, keyed by name. The model never supplies `command`. */
  readonly servers: Readonly<Record<string, LanguageServerSpec>>;
  /** Policy for server-initiated edits. Diagnostics reads; a rename never runs from this tool. */
  readonly policy?: ExecutionPolicy;
  readonly maxDiagnosticsPerFile?: number;
  readonly maxMessageBytes?: number;
  /** Called once per server that fails to start, so the host can warn without failing the run. */
  readonly onServerFailure?: (server: string, message: string) => void;
}

/** The tool plus the handle that stops its servers (agent dispose, last session closed). */
export interface DiagnosticsToolHandle {
  readonly tool: ToolDefinition;
  /** Stops every language server; the next call starts them again. Idempotent. */
  dispose(): Promise<void>;
}

function errorResult(toolCallId: string, message: string): ToolResult {
  return {
    toolCallId,
    name: "diagnostics",
    content: [{ type: "text", text: message }],
    error: { message },
  };
}

function serverNameForFile(servers: Readonly<Record<string, LanguageServerSpec>>, file: string): string | undefined {
  const languageId = languageIdForPath(file);
  for (const [name, spec] of Object.entries(servers)) {
    if (spec.languages.includes(languageId)) return name;
  }
  return undefined;
}

/** The fields both the LSP view and the normalized delta carry. */
interface DiagnosticLine {
  readonly file: string;
  readonly line: number;
  readonly character: number;
  readonly severity: string;
  readonly message: string;
}

/** LSP positions are 0-based; every other tool in this package prints 1-based lines. */
function formatDiagnostic(diagnostic: DiagnosticLine): string {
  return `${diagnostic.file}:${diagnostic.line + 1}:${diagnostic.character + 1} ${diagnostic.severity} ${diagnostic.message}`;
}

export function createDiagnosticsTool(cwd: string, options: DiagnosticsToolOptions): DiagnosticsToolHandle {
  const limits = resolveDiagnosticsLimits({
    maxDiagnosticsPerFile: options.maxDiagnosticsPerFile,
    maxMessageBytes: options.maxMessageBytes,
  });
  const servers = options.servers;
  const warned = new Set<string>();
  let language: LanguageIntelligence | undefined;

  function getLanguage(): LanguageIntelligence {
    if (language !== undefined) return language;
    language = createLanguageIntelligence({
      workspaceRoot: cwd,
      servers,
      ...(options.policy !== undefined ? { policy: options.policy } : {}),
    });
    return language;
  }

  const tool: ToolDefinition = {
    name: "diagnostics",
    kind: "search",
    effect: CODING_OBSERVATION_EFFECT,
    effects: ["read"],
    description: `Report the language server's diagnostics for one file as "path:line:col severity message" (1-based line and column). Servers are configured by the host; the first call for a language starts its server, and a server that fails to start is reported as a tool error. Use it after an edit to check the file you just wrote. Caps the diagnostic count and message length.`,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative file to check" },
      },
      required: ["path"],
      additionalProperties: false,
    } as JsonObject,
    async execute(args, context: ToolExecutionContext): Promise<ToolResult> {
      const toolCallId = context.toolCallId;
      if (context.signal?.aborted) return errorResult(toolCallId, "Operation aborted");
      const file = typeof args.path === "string" ? args.path : "";
      if (file.length === 0) return errorResult(toolCallId, "path is required and must be a non-empty string.");

      const server = serverNameForFile(servers, file);
      let lang: LanguageIntelligence;
      try {
        lang = getLanguage();
      } catch (error) {
        return errorResult(toolCallId, error instanceof Error ? error.message : String(error));
      }

      try {
        // didOpen/didChange first: push servers publish only after the document is known.
        await lang.syncDocument(file, { signal: context.signal });
        let diagnostics: readonly DiagnosticLine[] = [];
        const delta = await lang.diagnosticDelta({ files: [file] }, { signal: context.signal });
        const deltaEntry = delta.files[file];
        if (deltaEntry !== undefined) diagnostics = [...deltaEntry.added, ...deltaEntry.unchanged];
        if (diagnostics.length === 0) {
          const deadline = Date.now() + DIAGNOSTICS_SETTLE_MS;
          while (diagnostics.length === 0 && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, DIAGNOSTICS_POLL_MS));
            diagnostics = await lang.diagnostics(file, { signal: context.signal });
          }
        }
        if (diagnostics.length === 0) {
          return { toolCallId, name: "diagnostics", content: [{ type: "text", text: `No diagnostics for ${file}.` }] };
        }
        const kept = [...diagnostics].sort((a, b) => a.line - b.line || a.character - b.character || a.message.localeCompare(b.message));
        const shown = kept.slice(0, limits.maxDiagnosticsPerFile);
        const lines = shown.map(formatDiagnostic);
        const more = kept.length - shown.length;
        if (more > 0) lines.push(`(… ${more} more diagnostics)`);
        return {
          toolCallId,
          name: "diagnostics",
          content: [{ type: "text", text: lines.join("\n") }],
          value: { file, diagnostics: shown.length, truncated: more > 0 },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // A server that cannot start is a host-config problem: name it once, never fail the run.
        const name = server ?? "language server";
        if (server !== undefined && !warned.has(server) && !message.includes("No host server registered")) {
          warned.add(server);
          options.onServerFailure?.(server, message);
        }
        return errorResult(toolCallId, `language server "${name}": ${message}`);
      }
    },
  };

  return {
    tool,
    async dispose() {
      const current = language;
      language = undefined;
      if (current !== undefined) await current.dispose();
    },
  };
}
