/**
 * The wiki's passive pointer (plan 207 Task 4; the wiki's own `context.build` block since plan 216 Task 3). At most
 * one concept per user turn, and only when its subject is in play: every token of one of its names appears in the
 * turn's words, or a path the session's file tools touched falls inside its `appliesTo` globs (the path-scoped cue).
 * The block is one line, carries no claim, and is computed once per user turn: a rebuild of the same turn is
 * byte-identical, and nothing changes until the next turn or the next LTM retraction epoch.
 */
import { type ContextBlock, type ContextDraft, type HookContext, type Message, withContextBlocks } from "@arnilo/prism";
import { lexicalTerms } from "@arnilo/prism-memory-core";
import type { WikiOntologyPort } from "./ontology/port.js";
import { conceptInPlay, conceptPointerLine } from "./ontology/pointer.js";
import { WIKI_SCOPE_LEVELS } from "./ontology/types.js";

export const WIKI_CONTEXT_HOOK_ID = "wiki-pointer";
const MAX_TOUCHED_PATHS = 256;
const MAX_SESSIONS = 64;
/** File tools whose `path` argument names a project file. */
const FILE_TOOLS = new Set(["read", "edit", "write"]);

function latestUser(messages: readonly Message[]): { readonly id: string; readonly text: string } | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role !== "user") continue;
    const text = message.content
      .filter((block): block is Extract<(typeof message.content)[number], { type: "text" }> => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    return { id: message.id ?? `${index}:${text.length}`, text };
  }
  return undefined;
}

export interface WikiPointer {
  build(draft: ContextDraft, context: HookContext): Promise<ContextDraft | undefined>;
  /** Record a file tool's path (workspace-relative, `/`-separated). */
  touched(sessionId: string, call: { readonly name: string; readonly arguments: Record<string, unknown> }): void;
  forget(sessionId: string): void;
}

export function createWikiPointer(deps: { readonly port: () => WikiOntologyPort; readonly root: string }): WikiPointer {
  const paths = new Map<string, string[]>();
  const turns = new Map<string, { readonly key: string; readonly block: ContextBlock | undefined }>();

  const normalize = (path: string): string | undefined => {
    const clean = path.startsWith(`${deps.root}/`) ? path.slice(deps.root.length + 1) : path;
    if (clean.length === 0 || clean.startsWith("/") || clean.split("/").includes("..")) return undefined;
    return clean;
  };

  return {
    async build(draft, context) {
      const sessionId = context.sessionId;
      const user = latestUser(draft.messages);
      if (sessionId === undefined || user === undefined) return undefined;
      const port = deps.port();
      // Catching up with memory first: a forgotten citation never points the agent at a stale concept.
      const before = turns.get(sessionId);
      if (before === undefined || before.key !== user.id) {
        await port.refresh(context.signal === undefined ? {} : { signal: context.signal });
        const terms = lexicalTerms(user.text.slice(0, 4000));
        const touched = paths.get(sessionId) ?? [];
        let chosen: { readonly id: string; readonly subject: string; readonly uses: number } | undefined;
        for (const scope of WIKI_SCOPE_LEVELS) {
          if (!port.scopes().includes(scope)) continue;
          for (const record of await port.concepts(scope)) {
            if (record.status !== "verified" || record.flags.length > 0 || record.body.indexOf("\n- [c") === -1) continue;
            if (!conceptInPlay(record, terms, touched)) continue;
            if (chosen === undefined || record.uses > chosen.uses) chosen = { id: record.id, subject: record.subject, uses: record.uses };
          }
        }
        const block: ContextBlock | undefined =
          chosen === undefined
            ? undefined
            : {
                id: "wiki:pointer",
                title: "Wiki",
                content: `A wiki concept is in play; read it before relying on it:\n${conceptPointerLine(chosen.id, chosen.subject)}`,
                metadata: { inert: true },
              };
        turns.delete(sessionId);
        turns.set(sessionId, { key: user.id, block });
        if (turns.size > MAX_SESSIONS) turns.delete(turns.keys().next().value as string);
      }
      const block = turns.get(sessionId)?.block;
      return block === undefined ? undefined : withContextBlocks(draft, [block]);
    },
    touched(sessionId, call) {
      if (!FILE_TOOLS.has(call.name) || typeof call.arguments.path !== "string") return;
      const path = normalize(call.arguments.path);
      if (path === undefined) return;
      const list = (paths.get(sessionId) ?? []).filter((entry) => entry !== path);
      list.unshift(path);
      paths.set(sessionId, list.slice(0, MAX_TOUCHED_PATHS));
    },
    forget(sessionId) {
      paths.delete(sessionId);
      turns.delete(sessionId);
    },
  };
}
