/**
 * The wiki's agent surface (plan 216 Task 3): `wiki.search` returns concepts first, each with its current claims and
 * the ids they cite, then one drill-down line; `wiki.read` reads a concept (by id or subject) or an evidence note (an
 * LTM note through the read-only `memory.ltm` port, or a wiki source). This follows the read-side contract plan 207
 * gave `memory.recall`: a stale claim never appears, and a claim whose citations are not all readable is dropped,
 * so a forgotten note's text cannot ride in on a concept. Neither tool calls a model or writes memory.
 */
import { type JsonObject, type ToolDefinition, type ToolResult } from "@arnilo/prism";
import { lexicalTerms, MemoryValidationError } from "@arnilo/prism-memory-system/core";
import { type ConceptDoc, type ConceptItem, parseConceptBody, renderConceptBody } from "../ontology/codec.js";
import type { WikiOntologyPort } from "../ontology/port.js";
import { citedByCurrentClaims, readConceptBody, renderConceptClaims, renderConceptRead } from "../ontology/render.js";
import { WIKI_SCOPE_LEVELS, type WikiScopeLevel } from "../ontology/types.js";
import type { WikiConceptRecord } from "../store.js";

export const WIKI_SEARCH_TOOL = "wiki.search";
export const WIKI_READ_TOOL = "wiki.read";
/** Concepts one search returns at most. */
export const MAX_WIKI_SEARCH_HITS = 8;
/** Ids one `wiki.read` takes. */
export const MAX_WIKI_READ_IDS = 8;
/** Cited ids one search checks for readability. */
const MAX_CITE_CHECK_IDS = 256;

export interface WikiKnowledgeToolOptions {
  readonly port: () => WikiOntologyPort;
  /** Claims one concept hit shows (`search.maxClaimsRendered`). */
  readonly maxClaimsRendered: number;
}

const ok = (name: string, toolCallId: string, text: string, value: JsonObject): ToolResult => ({
  toolCallId,
  name,
  value,
  content: [{ type: "text", text }],
});

const delivered = (record: WikiConceptRecord): boolean => record.status !== "archived" && record.flags.length === 0;

function scopesArg(port: WikiOntologyPort, value: unknown): readonly WikiScopeLevel[] {
  const readable = port.scopes();
  if (value === undefined) return WIKI_SCOPE_LEVELS.filter((level) => readable.includes(level));
  if (typeof value !== "string" || !(WIKI_SCOPE_LEVELS as readonly string[]).includes(value)) {
    throw new MemoryValidationError(`scope is one of ${WIKI_SCOPE_LEVELS.join(", ")}`);
  }
  if (!readable.includes(value as WikiScopeLevel)) throw new MemoryValidationError(`the ${value} scope is not readable here`);
  return [value as WikiScopeLevel];
}

/** Term overlap of a concept's names (weighted) and current claims with the query. */
function score(record: WikiConceptRecord, doc: ConceptDoc | undefined, terms: ReadonlySet<string>): number {
  let total = 0;
  for (const name of [record.subject.replace(/[.-]+/g, " "), record.title, ...record.aliases]) {
    for (const term of lexicalTerms(name)) if (terms.has(term)) total += 2;
  }
  const stale = new Set(record.stale);
  for (const claim of doc?.claims ?? []) {
    if (stale.has(claim.id)) continue;
    for (const term of lexicalTerms(claim.text)) if (terms.has(term)) total += 1;
  }
  return total;
}

/** A concept body with every item whose citations are not all readable left out (a person's uncited item stays). */
function readableOnly(doc: ConceptDoc, readable: ReadonlySet<string>): ConceptDoc {
  const keep = (items: readonly ConceptItem[]): ConceptItem[] => items.filter((item) => item.cites.every((cite) => readable.has(cite)));
  return { title: doc.title, claims: keep(doc.claims), questions: keep(doc.questions), contradictions: keep(doc.contradictions) };
}

export function createWikiSearchTool(options: WikiKnowledgeToolOptions): ToolDefinition {
  return {
    name: WIKI_SEARCH_TOOL,
    kind: "read",
    description:
      "Search the wiki: concepts first, each with its current claims and the ids each claim cites, then a drill-down line. Read a concept or a cited note with wiki.read.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string", minLength: 1, maxLength: 2000, description: "What to look for." },
        scope: { type: "string", enum: [...WIKI_SCOPE_LEVELS], description: "Only this scope; defaults to every readable scope." },
        limit: { type: "integer", minimum: 1, maximum: MAX_WIKI_SEARCH_HITS, description: "Concepts to return; default 3." },
      },
    },
    async execute(args, context) {
      const port = options.port();
      await port.refresh(context.signal === undefined ? {} : { signal: context.signal });
      if (typeof args.query !== "string" || args.query.trim().length === 0) throw new MemoryValidationError("query is required");
      const limit = typeof args.limit === "number" ? Math.min(Math.max(1, Math.trunc(args.limit)), MAX_WIKI_SEARCH_HITS) : 3;
      const terms = lexicalTerms(args.query);
      const ranked: { record: WikiConceptRecord; doc: ConceptDoc | undefined; score: number }[] = [];
      for (const scope of scopesArg(port, args.scope)) {
        for (const record of await port.concepts(scope)) {
          if (!delivered(record)) continue;
          const doc = readConceptBody(record.body);
          const value = score(record, doc, terms);
          if (value > 0) ranked.push({ record, doc, score: value });
        }
      }
      ranked.sort((a, b) => b.score - a.score || b.record.uses - a.record.uses || (a.record.subject < b.record.subject ? -1 : 1));
      const hits = ranked.slice(0, limit);
      if (hits.length === 0) {
        return ok(WIKI_SEARCH_TOOL, context.toolCallId, "No wiki concept matches.", { concepts: [] });
      }
      const lines: string[] = [];
      const concepts: JsonObject[] = [];
      for (const hit of hits) {
        const cited = hit.doc === undefined ? [] : citedByCurrentClaims(hit.doc, hit.record.stale).slice(0, MAX_CITE_CHECK_IDS);
        const readable = await port.readable(hit.record.scope, cited, context.signal === undefined ? {} : { signal: context.signal });
        const render = renderConceptClaims(hit.record.id, {
          text: hit.record.body,
          stale: hit.record.stale,
          queryTerms: terms,
          max: options.maxClaimsRendered,
          ...(hit.record.scope === "team" ? { evidence: false } : { readable }),
        });
        lines.push(`[${hit.record.id}] ${hit.record.scope} concept ${hit.record.subject} — ${hit.record.title}`, ...render.lines);
        concepts.push({
          id: hit.record.id,
          scope: hit.record.scope,
          subject: hit.record.subject,
          claims: render.claims,
          cited: [...render.cited],
        });
      }
      return ok(WIKI_SEARCH_TOOL, context.toolCallId, lines.join("\n"), { concepts });
    },
  };
}

export function createWikiReadTool(options: WikiKnowledgeToolOptions): ToolDefinition {
  return {
    name: WIKI_READ_TOOL,
    kind: "read",
    description:
      "Read a wiki concept (by id or subject) with its claim ids and citations, or up to 8 cited notes by id (memory notes or wiki sources).",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string", pattern: "^[0-9a-f]{12}$", description: "A concept or cited note id." },
        ids: { type: "array", items: { type: "string", pattern: "^[0-9a-f]{12}$" }, maxItems: MAX_WIKI_READ_IDS },
        subject: { type: "string", pattern: "^[a-z0-9.-]{1,64}$", description: "A concept's subject." },
        scope: { type: "string", enum: [...WIKI_SCOPE_LEVELS], description: "Only this scope; defaults to every readable scope." },
      },
    },
    async execute(args, context) {
      const port = options.port();
      const signal = context.signal === undefined ? {} : { signal: context.signal };
      await port.refresh(signal);
      const ids = [
        ...(typeof args.id === "string" ? [args.id] : []),
        ...(Array.isArray(args.ids) ? args.ids.filter((id): id is string => typeof id === "string") : []),
      ];
      const subject = typeof args.subject === "string" ? args.subject : undefined;
      if (ids.length === 0 && subject === undefined) throw new MemoryValidationError("wiki.read needs id, ids or subject");
      if (ids.length > MAX_WIKI_READ_IDS) throw new MemoryValidationError(`wiki.read takes at most ${MAX_WIKI_READ_IDS} ids`);
      const parts: string[] = [];
      const found: JsonObject[] = [];
      const wanted = new Set(ids);
      for (const scope of scopesArg(port, args.scope)) {
        if (wanted.size === 0 && subject === undefined) break;
        const concepts = (await port.concepts(scope)).filter(
          (record) => delivered(record) && (wanted.has(record.id) || (subject !== undefined && record.subject === subject)),
        );
        for (const record of concepts) {
          wanted.delete(record.id);
          let doc: ConceptDoc;
          try {
            doc = parseConceptBody(record.body, { allowUncited: true });
          } catch {
            continue;
          }
          const cited = [...new Set([...doc.claims, ...doc.questions, ...doc.contradictions].flatMap((item) => item.cites))];
          const readable = record.scope === "team" ? new Set(cited) : await port.readable(scope, cited, signal);
          parts.push(
            `[${record.id}] ${scope} concept ${record.subject}`,
            renderConceptRead(renderConceptBody(readableOnly(doc, readable)), record.stale),
          );
          found.push({ id: record.id, kind: "concept", scope, subject: record.subject });
          await port.noteUse(scope, record.id);
        }
        const rest = [...wanted];
        if (rest.length === 0) continue;
        for (const view of await port.read(scope, rest, signal)) {
          if (view.kind === "concept") continue;
          wanted.delete(view.id);
          parts.push(`[${view.id}] ${view.scope} ${view.kind}${view.path === undefined ? "" : ` ${view.path}`}`, view.text);
          found.push({ id: view.id, kind: view.kind, scope: view.scope });
        }
      }
      const missing = [...wanted];
      if (missing.length > 0) parts.push(`Not readable here: ${missing.join(", ")}.`);
      if (subject !== undefined && !found.some((entry) => entry.subject === subject)) parts.push(`No concept for subject ${subject}.`);
      return ok(WIKI_READ_TOOL, context.toolCallId, parts.join("\n\n"), { found, missing });
    },
  };
}
