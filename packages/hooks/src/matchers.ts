/**
 * Matcher compilation.
 *
 * Claude uses a hybrid: a pattern drawn only from letters, digits, `_`, `-`,
 * space, `,`, and `|` is a literal selector (pipe/comma separated alternatives),
 * anything else is an unanchored JavaScript regular expression. Codex patterns are
 * always regexes, and they fall into that branch too because a real pattern carries
 * metacharacters. Neither supports `$1` capture substitution — there is no
 * substitution step here.
 */
import { HooksConfigError } from "./schema.js";

const LITERAL_PATTERN = /^[A-Za-z0-9_\- ,|]+$/;

/** Compile a matcher into a predicate. Absent/`*` matches everything. */
export function compileMatcher(matcher: string | undefined): (candidate: string) => boolean {
  if (matcher === undefined || matcher.trim() === "" || matcher === "*") return () => true;
  if (LITERAL_PATTERN.test(matcher)) {
    const alternatives = matcher
      .split(/[|,]/)
      .map((part) => part.trim())
      .filter((part) => part !== "");
    return (candidate) => alternatives.includes(candidate);
  }
  let regex: RegExp;
  try {
    regex = new RegExp(matcher);
  } catch {
    throw new HooksConfigError(`matcher ${JSON.stringify(matcher)} is not a valid regular expression`);
  }
  return (candidate) => regex.test(candidate);
}
