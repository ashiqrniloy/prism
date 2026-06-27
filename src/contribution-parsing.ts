import type { Skill } from "./contracts.js";
import type { JsonValue } from "./contracts.js";
import type { ManifestContributionDeclaration } from "./manifests.js";

/** Frontmatter split + scalar/simple-list parser for `SKILL.md` / `AGENT.md`.
 *  Stdlib `String` parsing only — no YAML dependency, no Markdown AST, no `node:*`
 *  import. Unknown frontmatter keys are tolerated (collected into metadata, not
 *  fatal). Core is fs-free: callers pass file text already read. */

const FENCE = "---";

export function splitFrontmatter(text: string, path: string): { front: Map<string, unknown>; body: string } {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0 || lines[0].trim() !== FENCE) {
    return { front: new Map(), body: text };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === FENCE || lines[i].trim() === "...") {
      end = i;
      break;
    }
  }
  if (end === -1) throw new Error(`Malformed frontmatter in ${path}: unterminated fence`);
  const frontLines = lines.slice(1, end);
  const body = lines.slice(end + 1).join("\n");
  return { front: parseFrontBlock(frontLines), body };
}

function parseFrontBlock(lines: readonly string[]): Map<string, unknown> {
  const out = new Map<string, unknown>();
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }
    const colon = line.indexOf(":");
    if (colon === -1) {
      i++;
      continue;
    }
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (value === "") {
      // block list: collect following ` - item` lines
      const items: string[] = [];
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
        items.push(lines[i + 1].replace(/^\s*-\s+/, "").trim());
        i++;
      }
      out.set(key, items);
    } else if (value.startsWith("[") && value.endsWith("]")) {
      out.set(key, value.slice(1, -1).split(",").map((s) => s.trim()).filter((s) => s.length > 0));
    } else {
      out.set(key, value);
    }
    i++;
  }
  return out;
}

// ponytail: core is fs-free — derive the fallback skill name from the path via a
// plain string split instead of `node:path`. Expects `.../<name>/SKILL.md`.
function parentDirName(path: string): string {
  const parts = path.split(/[/\\]+/).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : parts[parts.length - 1] ?? "";
}

const NAME_RE = /^[A-Za-z0-9 _-]+$/;

/** Parse a `SKILL.md` into a {@link Skill}. Frontmatter keys map to `name`
 *  (required), `description`, `toolNames` (comma- or YAML-list); the markdown
 *  body becomes `instructions`. `context` declared in a file is surfaced as
 *  metadata only — file-declared context providers need a `module`; Phase 30
 *  owns instruction injection and context wiring. */
export function parseSkillFile(text: string, path: string): Skill {
  const { front, body } = splitFrontmatter(text, path);
  const name = String(front.get("name") ?? "").trim() || parentDirName(path);
  if (!NAME_RE.test(name)) {
    throw new Error(`Invalid skill name in ${path}: ${JSON.stringify(name)}`);
  }
  const description = front.has("description") ? String(front.get("description")) : undefined;
  const toolNamesValue = front.get("toolNames") ?? front.get("tools");
  const toolNames = Array.isArray(toolNamesValue) ? (toolNamesValue as string[]) : undefined;
  const metadata: Record<string, JsonValue> = {};
  // ponytail: `context` from a file SKILL.md lands here as metadata; not wired into a live ContextProvider (needs a module). Phase 30.
  for (const [key, value] of front) {
    if (key !== "name" && key !== "description" && key !== "toolNames" && key !== "tools") {
      metadata[key] = value as JsonValue;
    }
  }
  const skill: Skill = {
    name: name.replace(/\s+/g, "-"),
    description,
    instructions: body.replace(/^\n+/, ""),
    ...(toolNames ? { toolNames } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
  return skill;
}

/** Parse an `AGENT.md` frontmatter into a manifest-referenced declaration.
 *  Only `name`/`metadata` surface here; full agent resolution is Phase 33's
 *  `resolveAgentDefinition`. The file path is recorded as `resource`. */
export function parseAgentFile(text: string, path: string): ManifestContributionDeclaration {
  const { front } = splitFrontmatter(text, path);
  const name = String(front.get("name") ?? "").trim() || parentDirName(path);
  if (!NAME_RE.test(name)) {
    throw new Error(`Invalid agent name in ${path}: ${JSON.stringify(name)}`);
  }
  // ponytail: full resolution is Phase 33's resolveAgentDefinition. Only name/metadata surface here.
  const metadata: Record<string, JsonValue> = {};
  for (const [key, value] of front) {
    if (key !== "name") metadata[key] = value as JsonValue;
  }
  const declaration: ManifestContributionDeclaration = {
    kind: "agent",
    name: name.replace(/\s+/g, "-"),
    resource: path,
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
  return declaration;
}

// Self-check: the smallest thing that fails if parsing breaks.
// Run with: node -e "import('./dist/contribution-parsing.js').then(m=>console.log(m.parseSkillFile('---\nname: x\ntoolNames:\n  - a\n---\nhi', '/s/x/SKILL.md').name))"
