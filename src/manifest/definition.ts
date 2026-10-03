import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { PackageDefinition } from "../packages/api.js";
import { definePackage } from "../packages/define.js";
import { PackageLoadError } from "../packages/errors.js";
import { ManifestError } from "./errors.js";
import type { ManifestScope } from "./format.js";

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
  if (field(exported, "name") !== name) bad("its name differs from the installed package");
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
  let module: { default?: unknown };
  try {
    const resolved = createRequire(join(packagesDir, "package.json")).resolve(entry.name);
    module = (await import(`${pathToFileURL(resolved).href}?integrity=${encodeURIComponent(entry.integrity.slice(-24))}`)) as {
      default?: unknown;
    };
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 200) : "unknown error";
    throw new ManifestError("import_failed", `Package ${entry.name} (${scope}) could not be imported: ${reason}.`, {
      scope,
      package: entry.name,
    });
  }
  return toPackageDefinition(module.default, { name: entry.name, scope });
}
