#!/usr/bin/env bun
// SPDX 2.3 SBOM from bun.lock plus each installed package.json (plan 164 Task 8.4).
// Replaces `npm sbom` so the release host runs no npm: the lockfile already lists every
// installed package, and verify-sbom.mjs reads only `spdxVersion`, `packages[].name`,
// `.versionInfo`, and `.licenseDeclared`.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readBunLock } from "./bun-lock.mjs";

/**
 * bun.lock `packages` keys are node_modules-relative logical paths. A conflicting nested
 * version is `<parent>/<child>`, and a segment may itself be scoped (`@scope/name`), so
 * consume two segments when one starts with `@`.
 */
export function packageChain(key) {
  const parts = key.split("/");
  const chain = [];
  for (let i = 0; i < parts.length; ) {
    if (parts[i].startsWith("@")) {
      chain.push(`${parts[i]}/${parts[i + 1]}`);
      i += 2;
    } else {
      chain.push(parts[i]);
      i += 1;
    }
  }
  return chain;
}

function packageDir(key, resolution) {
  if (resolution.includes("@workspace:")) return resolution.slice(resolution.indexOf("@workspace:") + 11);
  if (resolution.includes("@root:")) return ".";
  const chain = packageChain(key);
  let dir = join("node_modules", chain[0]);
  for (const segment of chain.slice(1)) dir = join(dir, "node_modules", segment);
  return dir;
}

function declaredLicense(manifest) {
  if (typeof manifest.license === "string" && manifest.license) return manifest.license;
  if (Array.isArray(manifest.licenses))
    return manifest.licenses
      .map((entry) => entry?.type)
      .filter(Boolean)
      .join(" OR ");
  return undefined;
}

function spdxId(manifest, used) {
  const base = `SPDXRef-Package-${String(manifest.name).replace(/[^A-Za-z0-9.-]/g, "-")}-${manifest.version}`;
  let id = base;
  for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`;
  used.add(id);
  return id;
}

export function buildSbom(root = process.cwd()) {
  const lock = readBunLock(root);
  const used = new Set();
  const packages = [];
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    const resolution = Array.isArray(entry) ? String(entry[0] ?? "") : "";
    const manifestPath = join(root, packageDir(key, resolution), "package.json");
    if (!existsSync(manifestPath)) continue; // optional dependency for another platform
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    packages.push({
      SPDXID: spdxId(manifest, used),
      name: manifest.name,
      versionInfo: manifest.version,
      licenseDeclared: declaredLicense(manifest) ?? "NOASSERTION",
      downloadLocation: "NOASSERTION",
      filesAnalyzed: false,
      externalRefs: [
        {
          referenceCategory: "PACKAGE-MANAGER",
          referenceType: "purl",
          referenceLocator: `pkg:npm/${manifest.name}@${manifest.version}`,
        },
      ],
    });
  }
  packages.sort((a, b) => (a.name === b.name ? a.versionInfo.localeCompare(b.versionInfo) : a.name.localeCompare(b.name)));
  const rootManifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `${rootManifest.name} SBOM`,
    documentNamespace: `https://spdx.org/spdxdocs/${String(rootManifest.name).replace(/[^A-Za-z0-9.-]/g, "-")}-${rootManifest.version}`,
    creationInfo: { created: new Date().toISOString(), creators: ["Tool: scripts/sbom.mjs"] },
    packages,
  };
}

if (import.meta.main) {
  process.stdout.write(`${JSON.stringify(buildSbom(), null, 2)}\n`);
}
