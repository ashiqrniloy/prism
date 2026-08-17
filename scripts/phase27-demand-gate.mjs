#!/usr/bin/env node
/**
 * Plan 027 Task 5 demand gate (machine-enforced).
 *
 * Task 5 implements secret-manager adapters ONLY on demand. This gate fails
 * when anything is implemented, scaffolded, or ambiently wired before a
 * demand record names a consumer, secret shape, auth bootstrap, owner, and
 * protected test path.
 *
 * 1. Every provider in the demand registry must be an explicit deferral
 *    (status "deferred", consumer null).
 * 2. No demanded-provider adapter module or resolver factory may exist in
 *    @arnilo/prism-credentials-node (including the public index).
 * 3. The credentials-node source tree may not contain ambient discovery:
 *    metadata-service IPs/hosts, home-directory/CLI credential paths, or
 *    subprocess credential-helper CLI invocations.
 *
 * Exit 0 = gate holds (nothing demanded, nothing implemented). Exit 1 with
 * a named violation otherwise. Read by scripts/phase27-freeze.test.mjs.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PROVIDERS = {
  vault: "packages/credentials-node/src/vault-adapter.ts", // vault.ts is the encrypted local vault, not a Vault API adapter
  "aws-secrets-manager": "packages/credentials-node/src/aws-secrets-manager.ts",
  "azure-key-vault": "packages/credentials-node/src/azure-key-vault.ts",
  "gcp-secret-manager": "packages/credentials-node/src/gcp-secret-manager.ts",
};

const RESOLVER_FACTORIES = new Set([
  "createVaultCredentialResolver",
  "createAwsSecretsManagerCredentialResolver",
  "createAzureKeyVaultCredentialResolver",
  "createGcpSecretManagerCredentialResolver",
]);

const AMBIENT_PATTERNS = [
  { label: "metadata-service IP/host", re: /169\.254\.(169\.254|170\.2)|100\.100\.100\.200|metadata\.google\.internal/ },
  { label: "home-directory/CLI credential path", re: /["'`](?:~|\.aws|\.azure|\.config\/gcloud)(?:[/\\"'`]|\.)/ },
  { label: "subprocess credential-helper CLI", re: /\b(?:spawn|exec(?:File|Sync)?)\([^)]*\b(?:aws|gcloud|az|vault)\b/ },
];

const violations = [];
const manifest = JSON.parse(readFileSync(new URL("./phase27-freeze-manifest.json", import.meta.url), "utf8"));

for (const id of Object.keys(PROVIDERS)) {
  const demand = manifest.demand?.[id];
  if (!demand) violations.push(`demand registry missing entry for ${id}`);
  else {
    if (demand.status !== "deferred") violations.push(`${id} demand status is "${demand.status}", expected "deferred"`);
    if (demand.consumer !== null) violations.push(`${id} demand consumer is "${demand.consumer}", expected null`);
  }
  const adapter = new URL(`../${PROVIDERS[id]}`, import.meta.url);
  if (existsSync(adapter)) violations.push(`${PROVIDERS[id]} exists — adapter must not be scaffolded without a demand record`);
}

const srcFiles = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.ts$/.test(name)) srcFiles.push(full);
  }
})(fileURLToPath(new URL("../packages/credentials-node/src/", import.meta.url)));

for (const file of srcFiles) {
  const text = readFileSync(file, "utf8");
  for (const factory of RESOLVER_FACTORIES) {
    if (new RegExp(`export\\s+(?:async\\s+)?(?:const|function|class)\\s+${factory}\\b`).test(text)) {
      violations.push(`${factory} exported from ${file} — demanded adapter factory must not exist without a demand record`);
    }
  }
  for (const { label, re } of AMBIENT_PATTERNS) {
    if (re.test(text)) violations.push(`${label} pattern in ${file}`);
  }
}

if (violations.length > 0) {
  console.error(`phase27 demand gate FAILED:\n${violations.map((v) => `  - ${v}`).join("\n")}`);
  process.exit(1);
}
console.log(
  "phase27 demand gate OK: vault, aws-secrets-manager, azure-key-vault, gcp-secret-manager all deferred with no consumer; zero adapter modules, zero resolver factories, zero ambient-discovery patterns in @arnilo/prism-credentials-node.",
);
process.exit(0);
