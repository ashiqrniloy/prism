/**
 * Passive delivery of the ontology (plan 207 Task 4; the wiki's own context block since plan 216 Task 3): a pointer,
 * never content.
 *
 * A concept is pulled by the agent (`wiki.read`), not pushed. The wiki's passive block carries at most one concept
 * per turn, and only when its subject is in play: one of its names appears in the turn's own words, or a path the
 * session touched falls inside the concept's `appliesTo` globs. The line costs about fifteen tokens and carries no
 * claim, so a stale or wrong claim cannot be injected this way.
 */
import { lexicalTerms } from "@arnilo/prism-memory-core";
import { globMatches } from "./types.js";

interface PointerHit {
  readonly subject?: string;
  readonly title?: string;
  readonly aliases?: readonly string[];
  readonly appliesTo?: readonly string[];
}

/** Whether a concept's subject is in play this turn: a whole name in the turn's terms, or a touched path in its globs. */
export function conceptInPlay(hit: PointerHit, turnTerms: ReadonlySet<string>, touchedPaths: readonly string[]): boolean {
  if ((hit.appliesTo ?? []).some((glob) => touchedPaths.some((path) => globMatches(glob, path)))) return true;
  const names = [hit.subject?.replace(/[.-]+/g, " "), hit.title, ...(hit.aliases ?? [])];
  for (const name of names) {
    if (name === undefined) continue;
    const tokens = lexicalTerms(name);
    if (tokens.size > 0 && [...tokens].every((token) => turnTerms.has(token))) return true;
  }
  return false;
}

/** The one pointer line a concept adds to the tail. */
export function conceptPointerLine(id: string, subject: string | undefined): string {
  return `- [${id}] concept ${subject ?? "?"} — wiki.read ${id}`;
}
