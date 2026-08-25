import type { Skill } from "@arnilo/prism";

/**
 * Static pull-mode skill body. Size-capped constant — graft ships no skill files to
 * harvest (unlike ponytail), so this is authored here and kept small.
 */
export const GRAFT_SKILL_BODY = [
  "## graft — repository context graph",
  "",
  "A graft graph of this repo may be available (a `graft/` directory with an INDEX.md).",
  "Prefer it before grep-spelunking:",
  "",
  "- `ask` — natural-language questions about architecture/behavior; returns node titles + file:line locators.",
  "- `grep` — regex search grouped by enclosing symbol, ranked by in-edge coupling.",
  "- `callers` / `blast` — who depends on a symbol/file before you edit it.",
  "- `skeleton` — file outline without reading whole files.",
  "- `map` — token-budgeted repo overview when orienting.",
  "",
  "Workflow: ask or map first → open only the located files → edit.",
  "Locators are pointers, not source: always read the file before editing.",
  "",
  "The graph never rebuilds itself in your session. After edits, ask/grep results may lag one",
  "turn — graft self-refreshes on the next indexed query; run `/graft build` for an immediate refresh.",
  "",
  "If no wrapper tools are registered in this session, call the CLI directly through your",
  'shell tool instead (`graft <command> --json`, e.g. `graft ask "where is auth handled?" . --json -n 3`).',
].join("\n");

export function createGraftSkill(): Skill {
  return {
    name: "graft",
    description: "Use the graft context graph to locate code by architecture, callers, and coupling before spelunking.",
    instructions: GRAFT_SKILL_BODY,
    metadata: { source: "@arnilo/prism-graft" },
  };
}
