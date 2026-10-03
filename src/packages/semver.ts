import { PackageLoadError } from "./errors.js";

/** A parsed `major.minor.patch[-prerelease]` version. Build metadata is accepted and ignored. */
export interface SemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly pre: readonly (string | number)[];
}

type Operator = "=" | ">" | ">=" | "<" | "<=";
interface Comparator {
  readonly op: Operator;
  readonly version: SemVer;
}
/** One AND-set of comparators. A range is an OR of these. */
type ComparatorSet = readonly Comparator[];
export type SemVerRange = readonly ComparatorSet[];

const MAX_LENGTH = 128;
const VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const TOKEN = /^(\^|~|>=|<=|>|<|=)?(.+)$/;

/** Parses a full version, or returns `undefined`. */
export function parseVersion(text: string): SemVer | undefined {
  if (typeof text !== "string" || text.length > MAX_LENGTH) return undefined;
  const match = VERSION.exec(text);
  if (!match) return undefined;
  const pre = match[4]?.split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part)) ?? [];
  if (pre.some((part) => typeof part === "number" && !Number.isSafeInteger(part))) return undefined;
  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (![major, minor, patch].every(Number.isSafeInteger)) return undefined;
  return { major, minor, patch, pre };
}

export function isValidVersion(text: string): boolean {
  return parseVersion(text) !== undefined;
}

function comparePre(a: readonly (string | number)[], b: readonly (string | number)[]): number {
  // A version with a prerelease sorts before the same version without one.
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const x = a[index];
    const y = b[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x < y ? -1 : 1;
    if (typeof x === "number") return -1;
    if (typeof y === "number") return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

export function compareVersions(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return comparePre(a.pre, b.pre);
}

const v = (major: number, minor: number, patch: number, pre: readonly (string | number)[] = []): SemVer => ({ major, minor, patch, pre });
/** `-0` sorts below every prerelease of the version, so `<2.0.0-0` excludes `2.0.0-alpha` too. */
const floor = (major: number, minor: number, patch: number): SemVer => v(major, minor, patch, [0]);

function expand(op: string, version: SemVer): ComparatorSet {
  const { major, minor, patch } = version;
  switch (op) {
    case "^":
      if (major > 0)
        return [
          { op: ">=", version },
          { op: "<", version: floor(major + 1, 0, 0) },
        ];
      if (minor > 0)
        return [
          { op: ">=", version },
          { op: "<", version: floor(0, minor + 1, 0) },
        ];
      return [
        { op: ">=", version },
        { op: "<", version: floor(0, 0, patch + 1) },
      ];
    case "~":
      return [
        { op: ">=", version },
        { op: "<", version: floor(major, minor + 1, 0) },
      ];
    case "":
    case "=":
      return [{ op: "=", version }];
    default:
      return [{ op: op as Operator, version }];
  }
}

function invalid(range: string, why: string): never {
  throw new PackageLoadError("definition_invalid", `Invalid version range "${range.slice(0, 64)}": ${why}.`);
}

/**
 * Parses a range. Supported: `^`, `~`, exact (`1.2.3`, `=1.2.3`), `>=`, `>`, `<=`, `<`, space-joined
 * comparators (AND), `||` (OR), and `*`. Rejected with `definition_invalid`: hyphen ranges, `x`
 * ranges, bare partials (`1.2`), and dist-tags.
 */
export function parseRange(range: string): SemVerRange {
  if (typeof range !== "string" || range.length === 0 || range.length > MAX_LENGTH)
    invalid(String(range), "a non-empty range string is required");
  const sets: ComparatorSet[] = [];
  for (const part of range.split("||")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) invalid(range, "empty alternative");
    if (tokens.length === 1 && tokens[0] === "*") {
      sets.push([]);
      continue;
    }
    const set: Comparator[] = [];
    for (const token of tokens) {
      const match = TOKEN.exec(token);
      const version = match?.[2] === undefined ? undefined : parseVersion(match[2]);
      if (!match || !version)
        invalid(range, `"${token.slice(0, 32)}" is not a supported comparator (use full versions with ^ ~ >= > <= < =)`);
      set.push(...expand(match[1] ?? "", version));
    }
    sets.push(set);
  }
  return sets;
}

/**
 * Whether `version` satisfies `range`, with the node-semver prerelease rule: a prerelease version
 * matches a set only when one comparator in it names the same `major.minor.patch` with a prerelease.
 * So `^0.13.0-0` admits `0.13.0-rc.1`, and `^0.12.1` does not admit `0.13.0-rc.1`.
 */
export function satisfies(version: SemVer, range: SemVerRange): boolean {
  return range.some((set) => {
    for (const { op, version: bound } of set) {
      const order = compareVersions(version, bound);
      const ok = op === "=" ? order === 0 : op === ">" ? order > 0 : op === ">=" ? order >= 0 : op === "<" ? order < 0 : order <= 0;
      if (!ok) return false;
    }
    if (version.pre.length === 0) return true;
    return set.some(
      ({ version: bound }) =>
        bound.pre.length > 0 && bound.major === version.major && bound.minor === version.minor && bound.patch === version.patch,
    );
  });
}
