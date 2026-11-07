import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { HostBuilderError } from "../errors.js";

/** One configured check target: a file inside the host project and the name of the export to use. */
export interface CheckTarget {
  /** The name a tool call passes: the path relative to the project root, `#`, the export name. */
  readonly name: string;
  /** Real path of the file. */
  readonly file: string;
  readonly exportName: string;
}

export interface CheckTargets {
  readonly entries: readonly CheckTarget[];
  readonly packages: readonly CheckTarget[];
}

function entryError(message: string): HostBuilderError {
  return new HostBuilderError("ERR_PRISM_HOST_BUILDER_ENTRY", message);
}

/** `file#export` resolved under `root`; refuses a path that does not exist or whose real path leaves the real root. */
export function parseTarget(root: string, spec: string, flag: "--entry" | "--package"): CheckTarget {
  const hash = spec.lastIndexOf("#");
  const path = hash < 0 ? spec : spec.slice(0, hash);
  const exportName = hash < 0 ? "default" : spec.slice(hash + 1);
  if (path.length === 0 || exportName.length === 0) throw entryError(`${flag} "${spec}" must be <file>#<export>.`);
  let realRoot: string;
  let file: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    throw entryError(`${flag} "${spec}": the project root ${root} does not exist.`);
  }
  try {
    file = realpathSync(isAbsolute(path) ? path : resolve(root, path));
  } catch {
    throw entryError(`${flag} "${spec}": ${path} does not exist under ${root}.`);
  }
  const inside = relative(realRoot, file);
  if (inside === "" || inside.startsWith(`..${sep}`) || inside === ".." || isAbsolute(inside))
    throw entryError(`${flag} "${spec}": ${path} resolves outside the project root ${realRoot}.`);
  return { name: `${inside.split(sep).join("/")}#${exportName}`, file, exportName };
}

/** Parses every start flag at once so a bad one refuses the start, not the first tool call. */
export function resolveCheckTargets(root: string, entries: readonly string[] = [], packages: readonly string[] = []): CheckTargets {
  return {
    entries: entries.map((spec) => parseTarget(root, spec, "--entry")),
    packages: packages.map((spec) => parseTarget(root, spec, "--package")),
  };
}

/** The target a tool call named: by the configured text or its normalized name. `undefined` when none matches. */
export function findTarget(root: string, targets: readonly CheckTarget[], wanted: string): CheckTarget | undefined {
  const exact = targets.find((target) => target.name === wanted);
  if (exact) return exact;
  try {
    const normalized = parseTarget(root, wanted, "--entry").name;
    return targets.find((target) => target.name === normalized);
  } catch {
    return undefined;
  }
}
