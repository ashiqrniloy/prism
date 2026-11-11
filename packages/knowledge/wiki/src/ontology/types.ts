/**
 * The ontology's vocabulary (plan 216 Task 3: moved out of the fabric with the rest of the ontology). Scope levels
 * mirror the long-term memory's, so a concept and the notes it cites live at the same level.
 */
import { MemoryValidationError } from "@arnilo/prism-memory-system/core";

/** Where a concept lives. `user` and `project` are written by the curator; `agent` and `team` are read only. */
export type WikiScopeLevel = "user" | "project" | "agent" | "team";
export const WIKI_SCOPE_LEVELS: readonly WikiScopeLevel[] = ["project", "agent", "user", "team"];

/** Closed set of relations a concept may hold toward another subject's concept. */
export const CONCEPT_RELATIONS = ["part-of", "instance-of", "uses", "related"] as const;
export type ConceptRelation = (typeof CONCEPT_RELATIONS)[number];

export function isConceptRelation(value: unknown): value is ConceptRelation {
  return typeof value === "string" && (CONCEPT_RELATIONS as readonly string[]).includes(value);
}

export const CONCEPT_TYPES = ["entity", "topic"] as const;
export type ConceptType = (typeof CONCEPT_TYPES)[number];

/** Why a concept needs a consolidation pass; the cascade and the port record these, the curator reads them. */
export const CONCEPT_DIRTY_REASONS = ["removed", "stale", "evidence", "edited"] as const;
export type ConceptDirtyReason = (typeof CONCEPT_DIRTY_REASONS)[number];

export const MAX_CONCEPT_ALIASES = 16;
export const MAX_CONCEPT_TITLE_CHARS = 120;

/** Who stamped a concept write. `consolidation` is the curator pass; `human` a person's file edit; `host` a host call. */
export type ConceptWriter = "consolidation" | "human" | "host";
export const CONCEPT_WRITERS: readonly ConceptWriter[] = ["consolidation", "human", "host"];

const NOTE_KEY = /^[a-z0-9.-]{1,64}$/;

/** A subject slug: `[a-z0-9.-]{1,64}`. */
export function validateNoteKey(value: unknown): string {
  if (typeof value !== "string" || !NOTE_KEY.test(value)) {
    throw new MemoryValidationError("key must match [a-z0-9.-]{1,64}");
  }
  return value;
}

/** `appliesTo`: 1-8 globs relative to the project root. No absolute path, no home path, no upward traversal. */
export function validateAppliesTo(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8)
    throw new MemoryValidationError("appliesTo must be an array of 1-8 globs");
  for (const glob of value) {
    if (typeof glob !== "string" || glob.length === 0 || glob.length > 512) {
      throw new MemoryValidationError("each appliesTo glob must be a non-empty string of at most 512 characters");
    }
    if (glob.includes("\0") || glob.includes("\\")) throw new MemoryValidationError("appliesTo globs must not contain NUL or backslash");
    if (glob.startsWith("/") || glob.startsWith("~") || /^[A-Za-z]:/.test(glob)) {
      throw new MemoryValidationError(`appliesTo glob must be relative to the project root: ${glob}`);
    }
    if (glob.split("/").includes("..")) throw new MemoryValidationError(`appliesTo glob must not traverse upward: ${glob}`);
  }
  return value as readonly string[];
}

const GLOB_CACHE = new Map<string, RegExp>();

/** `*` within a segment, `**` across segments, `?` one character. */
export function globMatches(pattern: string, path: string): boolean {
  let compiled = GLOB_CACHE.get(pattern);
  if (compiled === undefined) {
    let source = "^";
    for (let index = 0; index < pattern.length; index += 1) {
      const char = pattern[index]!;
      if (char === "*" && pattern[index + 1] === "*") {
        index += 1;
        if (pattern[index + 1] === "/") {
          index += 1;
          source += "(?:[^/]+/)*";
        } else source += ".*";
      } else if (char === "*") source += "[^/]*";
      else if (char === "?") source += "[^/]";
      else source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
    compiled = new RegExp(`${source}$`);
    if (GLOB_CACHE.size >= 1_024) GLOB_CACHE.clear();
    GLOB_CACHE.set(pattern, compiled);
  }
  return compiled.test(path);
}
