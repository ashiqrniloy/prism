#!/usr/bin/env node
// ponytail — Claude Code SubagentStart hook
//
// SessionStart context is parent-thread only and never reaches subagents, so
// without this every Task-spawned agent runs ponytail-unaware (issue #252).
// When ponytail mode is active, inject the same ruleset into each subagent.
//
// Scoping (opt-in, issue #506): set PONYTAIL_SUBAGENT_MATCHER to scope injection to
// matching agent_types. Supported safe forms (case-insensitive, no RegExp is ever
// compiled from the environment, so hostile patterns cannot backtracking-bomb the hook):
//   "explore|general"  inject if agent_type contains any literal alternative
//   "^general$"        inject only on an exact match
// Unset, invalid, or oversized (>256 chars) means inject into every subagent, as before.

const { getPonytailInstructions } = require("./ponytail-instructions");
const { readMode, writeHookOutput } = require("./ponytail-runtime");

const mode = readMode();

// Absent flag or off → ponytail isn't active; inject nothing.
if (!mode || mode === "off") {
  process.exit(0);
}

function inject() {
  try {
    writeHookOutput("SubagentStart", mode, getPonytailInstructions(mode));
  } catch (_e) {
    // Silent fail — a stdout error at hook exit must not surface as a hook failure.
  }
}

// Parses the documented safe matcher subset; never constructs a RegExp.
function parseMatcher(pattern) {
  if (typeof pattern !== "string" || pattern.length === 0 || pattern.length > 256) return null;
  let exact = false;
  if (pattern.startsWith("^") && pattern.endsWith("$")) {
    pattern = pattern.slice(1, -1);
    if (pattern.includes("^") || pattern.includes("$")) return null;
    exact = true;
  }
  const alternatives = pattern
    .split("|")
    .map((a) => a.trim().toLowerCase())
    .filter((a) => a.length > 0);
  if (alternatives.length === 0) return null;
  return { exact, alternatives };
}

function matcherMatches(matcher, agentType) {
  const type = agentType.toLowerCase();
  return matcher.exact ? matcher.alternatives.includes(type) : matcher.alternatives.some((a) => type.includes(a));
}

const matcher = parseMatcher(process.env.PONYTAIL_SUBAGENT_MATCHER);

// No matcher → keep the original synchronous, stdin-independent path. On Windows
// the PowerShell `if {}` wrapper can swallow the piped JSON so stdin 'end' never
// fires (#443); the default path must not wait on stdin or it would stall every
// subagent spawn.
if (!matcher) {
  inject();
  process.exit(0);
}

// Matcher set → read agent_type from stdin and skip only on a definite
// mismatch. Missing/unparseable agent_type, a stdin error, or the timeout all
// fail open (inject), so scoping never silently drops the persona.
let input = "";
let done = false;

function finish() {
  if (done) return;
  done = true;

  let agentType = "";
  try {
    // Strip UTF-8 BOM some shells prepend when piping (breaks JSON.parse)
    agentType = String(JSON.parse(input.replace(/^\uFEFF/, "")).agent_type || "").trim();
  } catch (_e) {
    // Unparseable payload — fall through and inject to be safe.
  }
  if (agentType && !matcherMatches(matcher, agentType)) {
    process.exit(0);
  }
  inject();
}

process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", finish);
// Never block the session (#443): recover on stdin error or a short fallback.
process.stdin.on("error", () => {
  finish();
  process.exit(0);
});
setTimeout(() => {
  finish();
  process.exit(0);
}, 1000).unref();
