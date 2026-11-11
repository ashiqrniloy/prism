import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { PackageDefinition } from "../packages/api.js";
import { definePackage, MODULE_SPECIFIER, splitSpecifier } from "../packages/define.js";
import { PackageLoadError } from "../packages/errors.js";
import { ManifestError } from "./errors.js";
import type { ManifestScope } from "./format.js";
import { installedPackageDir } from "./integrity.js";

function field(source: unknown, key: string): unknown {
  return (source as Record<string, unknown>)[key];
}

/**
 * Rebuilds an imported default export with this kernel's `definePackage`. An installed package may carry
 * its own copy of `@arnilo/prism` (a peer dependency installed beside it), whose definitions this
 * kernel's loader would not recognise; reading the fields and defining them again accepts both, and
 * validates the definition eagerly. Anything that is not definition-shaped fails as `not_a_package`.
 */
export function toPackageDefinition(
  exported: unknown,
  context: { readonly name: string; readonly scope: ManifestScope },
): PackageDefinition<any> {
  const { name, scope } = context;
  const bad = (reason: string): never => {
    throw new ManifestError("not_a_package", `Package ${name} (${scope}) default export is not a package definition: ${reason}.`, {
      scope,
      package: name,
    });
  };
  if ((typeof exported !== "object" && typeof exported !== "function") || exported === null) bad("no default export object");
  if (field(exported, "name") !== name) bad("its name differs from the specifier it was installed as");
  let definition: PackageDefinition<any>;
  try {
    definition = definePackage({
      name,
      version: field(exported, "version") as string,
      ...(field(exported, "description") !== undefined ? { description: field(exported, "description") as string } : {}),
      ...(field(exported, "requires") !== undefined ? { requires: field(exported, "requires") as never } : {}),
      ...(field(exported, "capabilities") !== undefined ? { capabilities: field(exported, "capabilities") as never } : {}),
      ...(field(exported, "config") !== undefined ? { config: field(exported, "config") as never } : {}),
      setup: field(exported, "setup") as never,
    });
  } catch (error) {
    if (error instanceof PackageLoadError) return bad(error.message.slice(0, 200));
    throw error;
  }
  return definition;
}

/**
 * Imports an installed package's definition. The caller has already verified the tree hash; this is the
 * only place a managed package's code runs. The hash is part of the URL, so a reinstalled package is
 * never served from the module cache.
 */
export async function importDefinition(
  packagesDir: string,
  entry: { readonly name: string; readonly integrity: string },
  scope: ManifestScope,
): Promise<PackageDefinition<any>> {
  const { root, subpath } = splitSpecifier(entry.name);
  const rootDir = installedPackageDir(packagesDir, root);
  try {
    const metadata = JSON.parse(await readFile(join(rootDir, "package.json"), "utf8")) as {
      exports?: unknown;
    };
    const exports = metadata.exports;
    const candidates =
      exports && typeof exports === "object" && !Array.isArray(exports)
        ? Object.entries(exports)
            .filter(([key, target]) => key.startsWith("./") && target !== null && MODULE_SPECIFIER.test(`${root}/${key.slice(2)}`))
            .map(([key]) => `${root}/${key.slice(2)}`)
            .sort()
        : [];
    const notPackage = (reason: string): never => {
      throw new ManifestError(
        "not_a_package",
        `${reason}${candidates.length ? ` Exported subpaths (choose one whose default export is a package definition): ${candidates.join(", ")}.` : ""}`,
        { scope, package: entry.name },
      );
    };
    if (
      subpath === undefined &&
      exports &&
      typeof exports === "object" &&
      !Array.isArray(exports) &&
      Object.keys(exports).some((key) => key.startsWith(".")) &&
      !("." in exports && (exports as Record<string, unknown>)["."] !== null)
    ) {
      notPackage(`Package ${entry.name} (${scope}) has no root package export.`);
    }
    // Bun's require.resolve can fall back to a private file even with exports present.
    let target: unknown = exports;
    let wildcard: string | undefined;
    if (exports && typeof exports === "object" && !Array.isArray(exports) && Object.keys(exports).some((key) => key.startsWith("."))) {
      const key = subpath === undefined ? "." : `./${subpath}`;
      const map = exports as Record<string, unknown>;
      const pattern = Object.keys(map)
        .filter((candidate) => {
          const star = candidate.indexOf("*");
          return (
            star >= 0 &&
            key.startsWith(candidate.slice(0, star)) &&
            key.endsWith(candidate.slice(star + 1)) &&
            key.length >= candidate.length - 1
          );
        })
        .sort((a, b) => b.indexOf("*") - a.indexOf("*") || b.length - a.length)[0];
      target = Object.hasOwn(map, key) ? map[key] : pattern !== undefined ? map[pattern] : undefined;
      if (!Object.hasOwn(map, key) && pattern !== undefined) {
        wildcard = key.slice(pattern.indexOf("*"), key.length - (pattern.length - pattern.indexOf("*") - 1));
      }
    } else if (subpath !== undefined) target = undefined;
    const targets = (value: unknown): string[] | undefined => {
      if (typeof value === "string") return [wildcard === undefined ? value : value.replaceAll("*", wildcard)];
      if (Array.isArray(value)) return value.flatMap((branch) => targets(branch) ?? []);
      if (value && typeof value === "object") {
        for (const [condition, branch] of Object.entries(value)) {
          if (["bun", "node", "require", "default", "node-addons"].includes(condition)) {
            const selected = targets(branch);
            if (selected !== undefined) return selected;
          }
        }
      }
      return value === null ? [] : undefined;
    };
    const allowed = targets(target) ?? [];
    if ((subpath !== undefined || exports !== undefined) && allowed.length === 0) throw new Error("The requested subpath is not exported.");
    const resolved = createRequire(join(packagesDir, "package.json")).resolve(entry.name);
    if (
      exports !== undefined &&
      !allowed.some((path) => path.startsWith("./") && resolve(rootDir, path) === resolved && resolved.startsWith(`${rootDir}${sep}`))
    ) {
      throw new Error("The resolved module is not an exports target.");
    }
    const module = (await import(`${pathToFileURL(resolved).href}?integrity=${encodeURIComponent(entry.integrity.slice(-24))}`)) as {
      default?: unknown;
    };
    try {
      return toPackageDefinition(module.default, { name: entry.name, scope });
    } catch (error) {
      if (error instanceof ManifestError && error.code === "not_a_package") return notPackage(error.message);
      throw error;
    }
  } catch (error) {
    if (error instanceof ManifestError) throw error;
    const reason = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 200) : "unknown error";
    throw new ManifestError("import_failed", `Package ${entry.name} (${scope}) could not be imported: ${reason}.`, {
      scope,
      package: entry.name,
    });
  }
}
