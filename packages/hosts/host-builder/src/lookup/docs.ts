import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { tokens } from "./text.js";

/** Kernel pages that describe retired contracts or are templates; the generator leaves the same ones out. */
const EXCLUDED_DOCS = [/^api-page-template\.md$/, /^release-.*-evidence\.md$/, /^migrate-to-0\.(5|6|7|8|9|11)\.md$/, /^migration\.md$/];
const KERNEL = "@arnilo/prism";
const MAX_PAGE_BYTES = 1024 * 1024;
const MAX_HITS = 5;
const EXCERPT_CHARS = 1200;

/** One readable page: `package` is `@arnilo/prism`, `path` is relative to that package (`docs/agent.md`, `README.md`). */
export interface DocPage {
  readonly package: string;
  readonly path: string;
  /** Project-relative, as the indexes write it: `node_modules/@arnilo/prism/docs/agent.md`. */
  readonly display: string;
  /** The resource URI: `prism-docs://prism/docs/agent.md`. */
  readonly uri: string;
  readonly file: string;
}

export interface DocHit {
  readonly page: string;
  readonly heading: string;
  /** `prism-docs://prism/docs/agent.md#heading-slug` */
  readonly uri: string;
  readonly excerpt: string;
  readonly score: number;
}

export interface DocsResult {
  readonly found: boolean;
  readonly hits: readonly DocHit[];
  readonly note?: string;
}

export function docUri(pkg: string, path: string): string {
  return `prism-docs://${pkg.replace(/^@arnilo\//, "")}/${path}`;
}

/** The real path of `<root>/node_modules/@arnilo`'s parent: nothing outside `node_modules` may be read. */
function nodeModulesReal(root: string): string | undefined {
  try {
    return realpathSync(join(root, "node_modules"));
  } catch {
    return undefined;
  }
}

/**
 * Reads `file` only when its real path (symlinks resolved) is a regular file inside both the project's
 * `node_modules` and the real directory of the package it claims to belong to. A link that leaves either is refused.
 */
export function readInside(root: string, packageDir: string, file: string): string | undefined {
  const modules = nodeModulesReal(root);
  if (modules === undefined) return undefined;
  try {
    const realPackage = realpathSync(packageDir);
    const realFile = realpathSync(file);
    if (!realFile.startsWith(modules + sep) || !realPackage.startsWith(modules + sep)) return undefined;
    if (!realFile.startsWith(realPackage + sep)) return undefined;
    const stat = statSync(realFile);
    if (!stat.isFile() || stat.size > MAX_PAGE_BYTES) return undefined;
    return readFileSync(realFile, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * The pages installed under `<root>/node_modules/@arnilo/`: each package's `README.md` and, for the kernel, the
 * top-level `docs/*.md` pages that describe the current contract. Lists names only; it reads no file.
 */
export function listDocPages(root: string): DocPage[] {
  const scope = join(root, "node_modules", "@arnilo");
  if (!existsSync(scope)) return [];
  const pages: DocPage[] = [];
  const names = readdirSync(scope).sort();
  for (const name of names) {
    const pkg = `@arnilo/${name}`;
    const dir = join(scope, name);
    const add = (path: string) => {
      const file = join(dir, ...path.split("/"));
      if (existsSync(file)) pages.push({ package: pkg, path, display: `node_modules/${pkg}/${path}`, uri: docUri(pkg, path), file });
    };
    add("README.md");
    try {
      const manifest = JSON.parse(readInside(root, dir, join(dir, "package.json")) ?? "{}");
      for (const path of manifest.files ?? []) {
        if (typeof path === "string" && /^[a-zA-Z0-9_-]+\/README\.md$/.test(path)) add(path);
      }
    } catch {
      // An unreadable or malformed manifest contributes no bundle pages.
    }
    if (pkg === KERNEL) {
      const docsDir = join(dir, "docs");
      if (!existsSync(docsDir)) continue;
      for (const entry of readdirSync(docsDir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        if (!entry.isFile() && !entry.isSymbolicLink()) continue;
        if (!entry.name.endsWith(".md") || EXCLUDED_DOCS.some((pattern) => pattern.test(entry.name))) continue;
        add(`docs/${entry.name}`);
      }
    }
  }
  return pages;
}

/** The text of a listed page by resource URI, or `undefined` for a page that is not listed or leaves `node_modules`. */
export function readDocPage(
  root: string,
  pages: readonly DocPage[],
  uri: string,
): { readonly page: DocPage; readonly text: string } | undefined {
  const page = pages.find((candidate) => candidate.uri === uri);
  if (page === undefined) return undefined;
  const text = readInside(root, join(root, "node_modules", page.package), page.file);
  return text === undefined ? undefined : { page, text };
}

interface Section {
  readonly page: DocPage;
  readonly heading: string;
  readonly anchor: string;
  readonly body: string;
  readonly headingTokens: ReadonlySet<string>;
  readonly lower: string;
}

/** GitHub-style anchor for a heading. */
export function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9 _-]/g, "")
    .trim()
    .replace(/ /g, "-");
}

function sectionsOf(page: DocPage, markdown: string): Section[] {
  const sections: Section[] = [];
  let heading = page.path;
  let lines: string[] = [];
  let fence = false;
  const flush = () => {
    const body = lines.join("\n").trim();
    if (body !== "") {
      sections.push({
        page,
        heading,
        anchor: slug(heading),
        body,
        headingTokens: new Set(tokens(heading)),
        lower: `${heading}\n${body}`.toLowerCase(),
      });
    }
    lines = [];
  };
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const match = fence ? null : /^(#{1,4})\s+(.+?)\s*#*$/.exec(line);
    if (match) {
      flush();
      heading = (match[2] ?? "").trim();
    } else lines.push(line);
  }
  flush();
  return sections;
}

/** The excerpt window of a section: from the first matching line, capped. */
function excerptOf(section: Section, words: readonly string[]): string {
  const lines = section.body.split("\n");
  const first = Math.max(
    0,
    lines.findIndex((line) => words.some((word) => line.toLowerCase().includes(word))),
  );
  const text = lines.slice(first).join("\n");
  return text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS)} …` : text;
}

/** A lexical docs search over the pages under one project root. The index builds on the first `search` and is kept. */
export class DocsIndex {
  private sections: Section[] | undefined;
  private pages: DocPage[] | undefined;

  constructor(private readonly root: string) {}

  listPages(): readonly DocPage[] {
    this.pages ??= listDocPages(this.root);
    return this.pages;
  }

  read(uri: string): { readonly page: DocPage; readonly text: string } | undefined {
    return readDocPage(this.root, this.listPages(), uri);
  }

  private build(): Section[] {
    if (this.sections) return this.sections;
    const built: Section[] = [];
    for (const page of this.listPages()) {
      const text = readInside(this.root, join(this.root, "node_modules", page.package), page.file);
      if (text !== undefined) built.push(...sectionsOf(page, text));
    }
    this.sections = built;
    return built;
  }

  /** Ranked, heading-anchored excerpts. A heading hit outranks a body hit; every query word must appear somewhere in the section. */
  search(query: string): DocsResult {
    const words = [...new Set(tokens(query))];
    if (words.length === 0) return { found: false, hits: [], note: "pass a query of at least one word" };
    const sections = this.build();
    if (sections.length === 0) {
      return { found: false, hits: [], note: `no @arnilo packages are installed under ${this.root}/node_modules` };
    }
    const hits: Array<DocHit & { order: number }> = [];
    sections.forEach((section, order) => {
      let score = 0;
      for (const word of words) {
        if (!section.lower.includes(word)) return;
        score += section.headingTokens.has(word) ? 8 : 0;
        score += Math.min(5, section.lower.split(word).length - 1);
      }
      hits.push({
        page: section.page.display,
        heading: section.heading,
        uri: `${section.page.uri}#${section.anchor}`,
        excerpt: excerptOf(section, words),
        score,
        order,
      });
    });
    hits.sort((a, b) => b.score - a.score || a.order - b.order);
    if (hits.length === 0) return { found: false, hits: [], note: "no section contains every word of the query" };
    return { found: true, hits: hits.slice(0, MAX_HITS).map(({ order: _order, ...hit }) => hit) };
  }
}
