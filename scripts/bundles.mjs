import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The target map stays present while groups transition one at a time. */
export function readBundles(root = process.cwd()) {
  const file = join(root, "scripts/bundles.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).bundles : [];
}

export function activeBundles(root = process.cwd()) {
  return readBundles(root).filter((bundle) => {
    const file = join(root, bundle.dir, "package.json");
    return existsSync(file) && JSON.parse(readFileSync(file, "utf8")).name === bundle.name;
  });
}

export function validateBundles(root = process.cwd()) {
  for (const bundle of readBundles(root).filter((bundle) => existsSync(join(root, bundle.dir, "package.json")))) {
    const manifest = JSON.parse(readFileSync(join(root, bundle.dir, "package.json"), "utf8"));
    if (manifest.name !== bundle.name) throw new Error(`${bundle.dir}: name must be ${bundle.name}`);
    const folders = readdirSync(join(root, bundle.dir))
      .filter((dir) => existsSync(join(root, bundle.dir, dir, "src/index.ts")))
      .sort();
    const mapped = [...new Set(bundle.subpaths.map((row) => row.dir))].sort();
    if (JSON.stringify(folders) !== JSON.stringify(mapped))
      throw new Error(`${bundle.name}: source folders disagree with scripts/bundles.json`);
    const expected = bundle.subpaths.map((row) => row.path).sort();
    if (JSON.stringify(Object.keys(manifest.exports ?? {}).sort()) !== JSON.stringify(expected)) {
      throw new Error(`${bundle.name}: exports disagree with scripts/bundles.json`);
    }
    for (const row of bundle.subpaths) {
      const target = manifest.exports[row.path];
      if (typeof target !== "string" || !target.startsWith(`./${row.dir}/`) || !existsSync(join(root, bundle.dir, target))) {
        throw new Error(`${bundle.name}${row.path.slice(1)}: invalid export target`);
      }
      for (const asset of [
        "src",
        "README.md",
        "skills",
        "data",
        "bin",
        "vendor",
        "docling",
        "sandbox",
        "vendor-lock.json",
        "THIRD_PARTY_NOTICES",
      ]) {
        const path = `${row.dir}/${asset}`;
        if (existsSync(join(root, bundle.dir, path)) && !manifest.files?.includes(path)) {
          throw new Error(`${bundle.name}: files must ship ${path}`);
        }
      }
    }
  }
}

/** Source/README owners, including each subpath of an activated bundle. */
export function packagePages(root, packages) {
  const bundles = activeBundles(root);
  return packages.flatMap((pkg) => {
    const bundle = bundles.find((bundle) => bundle.name === pkg.manifest.name);
    if (!bundle) return [pkg];
    return bundle.subpaths
      .filter((row, index) => bundle.subpaths.findIndex((candidate) => candidate.dir === row.dir) === index)
      .map((row) => ({
        ...pkg,
        path: join(bundle.dir, row.dir),
        bundlePath: bundle.dir,
        manifest: { ...pkg.manifest, name: bundle.name + (row.path === "." ? "" : row.path.slice(1)) },
      }));
  });
}
