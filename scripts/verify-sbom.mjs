#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const MAX_SBOM_BYTES = 16 * 1024 * 1024;
const MAX_PACKAGES = 10_000;

export function verifySbom(sbom, policy) {
  if (sbom?.spdxVersion !== "SPDX-2.3" || !Array.isArray(sbom.packages)) throw new Error("Expected an SPDX 2.3 package document");
  if (sbom.packages.length < 1 || sbom.packages.length > MAX_PACKAGES) throw new Error("SBOM package count is outside policy");
  const allowed = new Set(Array.isArray(policy?.allowed) ? policy.allowed : []);
  const denied = Array.isArray(policy?.deniedFragments) ? policy.deniedFragments : [];
  if (!allowed.size) throw new Error("License allow-list is empty");
  const violations = [];
  for (const pkg of sbom.packages) {
    const name = typeof pkg?.name === "string" ? pkg.name : "<unnamed>";
    const license = typeof pkg?.licenseDeclared === "string" ? pkg.licenseDeclared : "NOASSERTION";
    if (!allowed.has(license) || denied.some((fragment) => license.includes(fragment))) violations.push(`${name}: ${license}`);
  }
  if (violations.length) throw new Error(`SBOM license policy rejected ${violations.slice(0, 20).join(", ")}`);
  return { packages: sbom.packages.length, licenses: new Set(sbom.packages.map((pkg) => pkg.licenseDeclared)).size };
}

export async function verifySbomFiles(sbomPath, policyPath) {
  const [rawSbom, rawPolicy] = await Promise.all([readFile(sbomPath), readFile(policyPath)]);
  if (rawSbom.byteLength > MAX_SBOM_BYTES) throw new Error("SBOM exceeds 16 MiB");
  return verifySbom(JSON.parse(rawSbom.toString("utf8")), JSON.parse(rawPolicy.toString("utf8")));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await verifySbomFiles(process.argv[2] ?? "security-artifacts/sbom.spdx.json", process.argv[3] ?? "security/license-policy.json");
  console.log(JSON.stringify(result));
}
