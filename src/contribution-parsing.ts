import type { JsonValue, Skill } from "./contracts.js";

/** Frontmatter split + strict YAML-subset parser for `SKILL.md` and agent bundle
 *  markdown files. Stdlib `String` parsing only — no YAML dependency, no Markdown
 *  AST, no `node:*` import. Unknown frontmatter keys are tolerated (collected into
 *  metadata, not fatal). Core is fs-free: callers pass file text already read. */

const FENCE = "---";

/** Split a markdown file with `---` frontmatter into a parsed map and body.
 *  Exported so Node-side loaders (e.g. agent bundle resolution) can reuse the
 *  same frontmatter parser without duplicating it. */
export function splitFrontmatter(text: string, path: string): { front: Map<string, unknown>; body: string } {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0 || lines[0].trim() !== FENCE) {
    return { front: new Map(), body: text };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === FENCE || lines[i] === "...") {
      end = i;
      break;
    }
  }
  if (end === -1) throw new Error(`Malformed frontmatter in ${path}: unterminated fence`);
  const frontLines = lines.slice(1, end);
  const body = lines.slice(end + 1).join("\n");
  return { front: parseFrontBlock(frontLines, path), body };
}

function parseFrontBlock(lines: readonly string[], path: string): Map<string, unknown> {
  const parsed = new FrontmatterParser(lines, path, 2).parse();
  return new Map(Object.entries(parsed));
}

/** JSON-safe frontmatter value: strings only, nested maps and lists. */
type FrontValue = string | FrontValue[] | FrontMapping;
interface FrontMapping {
  [key: string]: FrontValue;
}

interface MappingEntry {
  readonly key: string;
  readonly value: string;
  /** Zero-based index into the frontmatter lines (file line = index + 2). */
  readonly line: number;
}

const MAX_FRONTMATTER_DEPTH = 8;

/** Strict YAML subset used by `SKILL.md` and agent frontmatter. One indentation
 *  stack, no regex over characters, and no syntax outside the supported subset
 *  is accepted silently. Values stay strings so frontmatter never coerces a
 *  `true` or a version into a boolean or number. */
class FrontmatterParser {
  private index = 0;

  constructor(
    private readonly lines: readonly string[],
    private readonly path: string,
    private readonly baseLine: number,
  ) {}

  parse(): FrontMapping {
    const parsed = this.parseMapping(0, 0);
    this.skipTrivia();
    if (this.index < this.lines.length) this.fail("unexpected content", this.index);
    return parsed;
  }

  private parseMapping(indent: number, depth: number, first?: MappingEntry): FrontMapping {
    if (depth > MAX_FRONTMATTER_DEPTH) this.fail(`nesting exceeds ${MAX_FRONTMATTER_DEPTH} levels`, this.index);
    const out: FrontMapping = {};
    if (first) this.assign(out, first, indent, depth);
    for (;;) {
      this.skipTrivia();
      if (this.index >= this.lines.length) break;
      const line = this.lines[this.index];
      const lineIndent = this.indentation(line, this.index);
      if (lineIndent < indent) break;
      if (lineIndent > indent) this.fail("unexpected indentation", this.index);
      if (isSequenceItem(line, lineIndent)) break;
      const entry = this.readKey(line, this.index);
      this.index++;
      this.assign(out, entry, indent, depth);
    }
    return out;
  }

  private parseSequence(indent: number, depth: number): FrontValue[] {
    if (depth > MAX_FRONTMATTER_DEPTH) this.fail(`nesting exceeds ${MAX_FRONTMATTER_DEPTH} levels`, this.index);
    const out: FrontValue[] = [];
    for (;;) {
      this.skipTrivia();
      if (this.index >= this.lines.length) break;
      const line = this.lines[this.index];
      const lineIndent = this.indentation(line, this.index);
      if (lineIndent < indent) break;
      if (lineIndent > indent) this.fail("unexpected indentation", this.index);
      if (!isSequenceItem(line, lineIndent)) break;
      const itemLine = this.index;
      this.index++;
      const rest = line.slice(lineIndent + 1);
      const content = rest.trimStart();
      if (content === "") {
        const next = this.nextSignificant();
        if (next !== -1 && this.indentation(this.lines[next], next) > indent) {
          this.index = next;
          const childIndent = this.indentation(this.lines[next], next);
          out.push(
            isSequenceItem(this.lines[next], childIndent)
              ? this.parseSequence(childIndent, depth + 1)
              : this.parseMapping(childIndent, depth + 1),
          );
        } else {
          out.push("");
        }
        continue;
      }
      const contentIndent = lineIndent + 1 + (rest.length - content.length);
      const entry = this.tryReadKey(content, itemLine);
      out.push(entry ? this.parseMapping(contentIndent, depth + 1, entry) : this.parseValue(content, contentIndent, itemLine));
    }
    return out;
  }

  private assign(out: FrontMapping, entry: MappingEntry, parentIndent: number, depth: number): void {
    if (entry.value === "") {
      const next = this.nextSignificant();
      if (next !== -1 && this.indentation(this.lines[next], next) > parentIndent) {
        this.index = next;
        const childIndent = this.indentation(this.lines[next], next);
        setFrontEntry(
          out,
          entry.key,
          isSequenceItem(this.lines[next], childIndent)
            ? this.parseSequence(childIndent, depth + 1)
            : this.parseMapping(childIndent, depth + 1),
        );
      } else {
        setFrontEntry(out, entry.key, []);
      }
      return;
    }
    setFrontEntry(out, entry.key, this.parseValue(entry.value, parentIndent, entry.line));
  }

  private parseValue(text: string, parentIndent: number, line: number): FrontValue {
    const first = text[0];
    if (first === "&" || first === "*" || first === "!" || first === "%" || first === "@" || first === "`" || first === "{") {
      this.fail(`unsupported frontmatter syntax ${JSON.stringify(first)}`, line);
    }
    if (first === "|" || first === ">") return this.parseBlockScalar(text, parentIndent, line);
    if (first === "'" || first === '"') return this.parseQuoted(text, parentIndent, line);
    if (first === "[") return this.parseFlowSequence(text, line);
    return this.parsePlain(text, parentIndent);
  }

  private parseBlockScalar(header: string, parentIndent: number, line: number): string {
    const match = /^([|>])([+-]?)(\d?)$/.exec(header);
    if (!match) this.fail("invalid block scalar header", line);
    const style = match[1];
    const chomp = match[2];
    const explicitIndent = match[3] === "" ? undefined : Number(match[3]);
    let contentIndent = explicitIndent === undefined ? -1 : parentIndent + explicitIndent;
    const collected: string[] = [];
    while (this.index < this.lines.length) {
      const raw = this.lines[this.index];
      if (raw.trim() === "") {
        collected.push("");
        this.index++;
        continue;
      }
      let spaces = 0;
      while (raw[spaces] === " ") spaces++;
      if (spaces <= parentIndent) break;
      if (contentIndent < 0) contentIndent = spaces;
      else if (spaces < contentIndent) this.fail("invalid block scalar indentation", this.index);
      collected.push(raw.slice(contentIndent));
      this.index++;
    }
    const text = style === "|" ? collected.join("\n") : foldBlockLines(collected);
    return chompBlockScalar(text, chomp);
  }

  private parseQuoted(text: string, parentIndent: number, line: number): string {
    const quote = text[0];
    let segment = text;
    let at = 1;
    let out = "";
    for (;;) {
      while (at < segment.length) {
        const char = segment[at];
        if (quote === "'") {
          if (char === "'") {
            if (segment[at + 1] === "'") {
              out += "'";
              at += 2;
              continue;
            }
            this.assertQuotedEnd(segment.slice(at + 1), line);
            return out;
          }
          out += char;
          at++;
          continue;
        }
        if (char === "\\") {
          const next = segment[at + 1];
          if (next === undefined) this.fail("unterminated escape in quoted scalar", line);
          if (next === "u") {
            const hex = segment.slice(at + 2, at + 6);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail("invalid unicode escape in quoted scalar", line);
            out += String.fromCharCode(Number.parseInt(hex, 16));
            at += 6;
            continue;
          }
          out += decodeEscape(next);
          at += 2;
          continue;
        }
        if (char === '"') {
          this.assertQuotedEnd(segment.slice(at + 1), line);
          return out;
        }
        out += char;
        at++;
      }
      if (this.index >= this.lines.length) this.fail("unterminated quoted scalar", line);
      const continuation = this.lines[this.index];
      if (this.indentation(continuation, this.index) <= parentIndent) this.fail("unterminated quoted scalar", line);
      this.index++;
      const trimmed = continuation.trim();
      if (trimmed === "") out += "\n";
      else out += out.length === 0 || out.endsWith("\n") ? trimmed : ` ${trimmed}`;
      segment = continuation;
      at = this.indentation(continuation, this.index - 1);
    }
  }

  private parseFlowSequence(text: string, line: number): FrontValue[] {
    const close = findFlowClose(text);
    if (close === -1) this.fail("unterminated flow sequence", line);
    if (text.slice(close + 1).trim() !== "") this.fail("unexpected content after flow sequence", line);
    const items = splitFlowItems(text.slice(1, close), (reason) => this.fail(reason, line));
    return items.map((item) => this.parseFlowValue(item, line));
  }

  private parseFlowValue(item: string, line: number): FrontValue {
    if (item === "") this.fail("empty flow sequence item", line);
    const first = item[0];
    if (first === "&" || first === "*" || first === "!" || first === "[" || first === "{" || first === "%") {
      this.fail("unsupported syntax in flow sequence", line);
    }
    if (first === "'" || first === '"') return this.decodeQuoted(item, line);
    return item;
  }

  private decodeQuoted(text: string, line: number): string {
    const quote = text[0];
    let out = "";
    let at = 1;
    while (at < text.length) {
      const char = text[at];
      if (quote === "'") {
        if (char === "'") {
          if (text[at + 1] === "'") {
            out += "'";
            at += 2;
            continue;
          }
          this.assertQuotedEnd(text.slice(at + 1), line);
          return out;
        }
        out += char;
        at++;
        continue;
      }
      if (char === "\\") {
        const next = text[at + 1];
        if (next === undefined) this.fail("unterminated escape in quoted scalar", line);
        if (next === "u") {
          const hex = text.slice(at + 2, at + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail("invalid unicode escape in quoted scalar", line);
          out += String.fromCharCode(Number.parseInt(hex, 16));
          at += 6;
          continue;
        }
        out += decodeEscape(next);
        at += 2;
        continue;
      }
      if (char === '"') {
        this.assertQuotedEnd(text.slice(at + 1), line);
        return out;
      }
      out += char;
      at++;
    }
    this.fail("unterminated quoted scalar", line);
  }

  private parsePlain(text: string, parentIndent: number): string {
    let out = text;
    for (;;) {
      if (this.index >= this.lines.length) break;
      const raw = this.lines[this.index];
      if (raw.trim().startsWith("#")) {
        this.index++;
        continue;
      }
      if (raw.trim() === "") {
        let next = this.index;
        while (next < this.lines.length && this.lines[next].trim() === "") next++;
        if (next < this.lines.length && this.indentation(this.lines[next], next) > parentIndent) {
          out += "\n".repeat(next - this.index);
          this.index = next;
          continue;
        }
        break;
      }
      const lineIndent = this.indentation(raw, this.index);
      if (lineIndent <= parentIndent) break;
      out += ` ${raw.trim()}`;
      this.index++;
    }
    return out.trim();
  }

  private readKey(text: string, line: number): MappingEntry {
    const entry = this.tryReadKey(text, line);
    if (!entry) this.fail('expected "key: value"', line);
    return entry;
  }

  private tryReadKey(text: string, line: number): MappingEntry | undefined {
    const colon = text.indexOf(":");
    if (colon <= 0) return undefined;
    const after = text[colon + 1];
    if (after !== undefined && after !== " " && after !== "\t") return undefined;
    const key = text.slice(0, colon).trim();
    if (key === "") this.fail("empty frontmatter key", line);
    if (key === "__proto__") this.fail("unsupported frontmatter key", line);
    return { key, value: text.slice(colon + 1).trim(), line };
  }

  private assertQuotedEnd(rest: string, line: number): void {
    if (rest.trim() !== "" && !rest.trim().startsWith("#")) this.fail("unexpected content after quoted scalar", line);
  }

  private skipTrivia(): void {
    while (this.index < this.lines.length) {
      const trimmed = this.lines[this.index].trim();
      if (trimmed !== "" && !trimmed.startsWith("#")) return;
      this.index++;
    }
  }

  private nextSignificant(): number {
    let next = this.index;
    while (next < this.lines.length) {
      const trimmed = this.lines[next].trim();
      if (trimmed !== "" && !trimmed.startsWith("#")) return next;
      next++;
    }
    return -1;
  }

  private indentation(line: string, lineIndex: number): number {
    let spaces = 0;
    while (line[spaces] === " " || line[spaces] === "\t") {
      if (line[spaces] === "\t") this.fail("tab indentation is not supported", lineIndex);
      spaces++;
    }
    return spaces;
  }

  private fail(reason: string, line: number): never {
    throw new Error(`Malformed frontmatter in ${this.path}: ${reason} at line ${this.baseLine + line}`);
  }
}

function isSequenceItem(line: string, indent: number): boolean {
  return line[indent] === "-" && (line[indent + 1] === " " || line[indent + 1] === "\t" || line[indent + 1] === undefined);
}

function setFrontEntry(target: FrontMapping, key: string, value: FrontValue): void {
  Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
}

function foldBlockLines(lines: readonly string[]): string {
  let out = "";
  for (const line of lines) {
    if (line === "") {
      out += "\n";
      continue;
    }
    if (out.length > 0 && !out.endsWith("\n")) out += " ";
    out += line;
  }
  return out;
}

function chompBlockScalar(text: string, chomp: string): string {
  const stripped = text.replace(/\n+$/, "");
  if (chomp === "-") return stripped;
  if (chomp === "+") return text === "" ? "" : `${text}\n`;
  return stripped === "" ? "" : `${stripped}\n`;
}

function decodeEscape(char: string): string {
  switch (char) {
    case "n":
      return "\n";
    case "r":
      return "\r";
    case "t":
      return "\t";
    case "b":
      return "\b";
    case "f":
      return "\f";
    case "0":
      return "\0";
    default:
      return char;
  }
}

function findFlowClose(text: string): number {
  let quote: string | undefined;
  for (let at = 1; at < text.length; at++) {
    const char = text[at];
    if (quote) {
      if (quote === "'" && char === "'" && text[at + 1] === "'") {
        at++;
        continue;
      }
      if (char === "\\" && quote === '"') {
        at++;
        continue;
      }
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    else if (char === "]") return at;
  }
  return -1;
}

function splitFlowItems(text: string, fail: (reason: string) => never): string[] {
  const items: string[] = [];
  let start = 0;
  let quote: string | undefined;
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (quote) {
      if (quote === "'" && char === "'" && text[at + 1] === "'") {
        at++;
        continue;
      }
      if (char === "\\" && quote === '"') {
        at++;
        continue;
      }
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    else if (char === ",") {
      items.push(text.slice(start, at).trim());
      start = at + 1;
    }
  }
  if (quote) fail("unterminated quoted scalar in flow sequence");
  items.push(text.slice(start).trim());
  if (items.length === 1 && items[0] === "") return [];
  return items;
}

// ponytail: core is fs-free — derive the fallback skill name from the path via a
// plain string split instead of `node:path`. Expects `.../<name>/SKILL.md`.
function parentDirName(path: string): string {
  const parts = path.split(/[/\\]+/).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : (parts[parts.length - 1] ?? "");
}

const NAME_RE = /^[A-Za-z0-9 _-]+$/;
const REQUIRES_TOOLS_KEY = "prism-requires-tools";
const MAX_REQUIRED_TOOLS = 32;
/** A tool name as `requiresTools` accepts it: letters, digits, `_`, `-`, `.` and `:` (`memory.recall`, MCP names). */
const REQUIRED_TOOL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

/** `metadata.prism-requires-tools`: a space-separated string. Anything else fails the parse, so a typo never silently un-gates a skill. */
function parseRequiresTools(front: Map<string, unknown>, path: string): readonly string[] | undefined {
  const metadata = front.get("metadata");
  if (metadata === undefined) return undefined;
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    throw new Error(`Invalid skill metadata in ${path}: expected a mapping`);
  }
  const value = (metadata as Record<string, unknown>)[REQUIRES_TOOLS_KEY];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`Invalid ${REQUIRES_TOOLS_KEY} in ${path}: expected a space-separated string`);
  const names = [...new Set(value.split(/\s+/).filter(Boolean))];
  if (names.length === 0) throw new Error(`Invalid ${REQUIRES_TOOLS_KEY} in ${path}: no tool names`);
  if (names.length > MAX_REQUIRED_TOOLS) throw new Error(`Invalid ${REQUIRES_TOOLS_KEY} in ${path}: more than ${MAX_REQUIRED_TOOLS} tools`);
  for (const name of names) {
    if (!REQUIRED_TOOL_NAME_RE.test(name))
      throw new Error(`Invalid ${REQUIRES_TOOLS_KEY} in ${path}: ${JSON.stringify(name)} is not a tool name`);
  }
  return names;
}

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
  const requiresTools = parseRequiresTools(front, path);
  const metadata: Record<string, JsonValue> = {};
  // ponytail: `context` from a file SKILL.md lands here as metadata only; a host wires it to a `context.build` handler.
  for (const [key, value] of front) {
    if (key !== "name" && key !== "description" && key !== "toolNames" && key !== "tools") {
      metadata[key] = value as JsonValue;
    }
  }
  const skill: Skill = {
    name: name.replace(/\s+/g, "-"),
    description,
    instructions: body.replace(/^\n+/, ""),
    ...(path ? { path } : {}),
    ...(toolNames ? { toolNames } : {}),
    ...(requiresTools ? { requiresTools } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
  return skill;
}

export interface AgentFileDeclaration {
  readonly kind: "agent";
  readonly name: string;
  readonly resource: string;
  readonly description?: string;
  readonly instructions: string;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
}

/** Parse a per-agent `AGENT.md` bundle frontmatter file. `name`, `description`
 *  and the body (`instructions`) surface here, plus every other key as metadata.
 *  The resolver left with the agent-definition module. */
export function parseAgentFile(text: string, path: string): AgentFileDeclaration {
  const { front, body } = splitFrontmatter(text, path);
  const name = String(front.get("name") ?? "").trim() || parentDirName(path);
  if (!NAME_RE.test(name)) {
    throw new Error(`Invalid agent name in ${path}: ${JSON.stringify(name)}`);
  }
  const description = front.has("description") ? String(front.get("description")) : undefined;
  const metadata: Record<string, JsonValue> = {};
  for (const [key, value] of front) {
    if (key !== "name" && key !== "description") metadata[key] = value as JsonValue;
  }
  const declaration: AgentFileDeclaration = {
    kind: "agent",
    name: name.replace(/\s+/g, "-"),
    resource: path,
    instructions: body.replace(/^\n+/, ""),
    ...(description !== undefined ? { description } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
  return declaration;
}

// Self-check: the smallest thing that fails if parsing breaks.
// Run with: node -e "import('./dist/contribution-parsing.js').then(m=>console.log(m.parseSkillFile('---\nname: x\ntoolNames:\n  - a\n---\nhi', '/s/x/SKILL.md').name))"
