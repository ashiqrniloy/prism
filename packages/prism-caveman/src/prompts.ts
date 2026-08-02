import type { CavemanLevel } from "./types.js";
import { MAX_INJECTED_INSTRUCTION_BYTES, MAX_SKILL_FILE_BYTES, readBoundedFile } from "./upstream.js";

const SKILL_RELATIVE_PATH = "skills/caveman/SKILL.md";

function stripFrontmatter(text: string): string {
  return text.replace(/^---[\s\S]*?---\s*/, "");
}

function modeLabel(level: CavemanLevel): string {
  return level === "wenyan" ? "wenyan-full" : level;
}

/** Filter upstream caveman SKILL.md body to the active intensity slice (caveman-activate.js parity). */
export function filterSkillBodyForLevel(body: string, level: CavemanLevel): string {
  const label = modeLabel(level);
  const filtered = body.split("\n").reduce<string[]>((acc, line) => {
    const tableRowMatch = line.match(/^\|\s*\*\*(\S+?)\*\*\s*\|/);
    if (tableRowMatch) {
      if (tableRowMatch[1] === label) acc.push(line);
      return acc;
    }
    const exampleMatch = line.match(/^- (\S+?):\s/);
    if (exampleMatch) {
      if (exampleMatch[1] === label) acc.push(line);
      return acc;
    }
    acc.push(line);
    return acc;
  }, []);

  return `CAVEMAN MODE ACTIVE — level: ${label}\n\n${filtered.join("\n").trim()}`;
}

export function buildCavemanInstructions(upstreamRoot: string, level: CavemanLevel): string | undefined {
  if (level === "off") return undefined;
  const raw = readBoundedFile(upstreamRoot, SKILL_RELATIVE_PATH, MAX_SKILL_FILE_BYTES);
  const body = stripFrontmatter(raw);
  const text = filterSkillBodyForLevel(body, level);
  if (text.length > MAX_INJECTED_INSTRUCTION_BYTES) {
    return `${text.slice(0, MAX_INJECTED_INSTRUCTION_BYTES - 1)}…`;
  }
  return text;
}
