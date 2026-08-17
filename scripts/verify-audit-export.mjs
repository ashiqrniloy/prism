#!/usr/bin/env node
/**
 * Independent verifier for signed, hash-chained audit batches (plan 027
 * Task 4). Validates canonical bytes, the record chain, the manifest
 * signature, cursor continuity, tenant, and expected first/last sequence.
 *
 * Usage:
 *   node scripts/verify-audit-export.mjs --batch ./batch.json \
 *     --public-key ./audit.pem --tenant acme \
 *     [--previous-digest <hex>] [--first <n>] [--last <n>]
 *
 * The batch file is the exact artifact bytes the WORM sink acknowledged
 * (the signed JSON document produced by createAuditExporter). Run this on a
 * copy fetched from WORM; it never needs the ledger, the sink, or any key
 * beyond the public verification key.
 */
import { existsSync, readFileSync } from "node:fs";
import { verifyAuditBatch } from "@arnilo/prism-policy";

function usage() {
  console.error(
    [
      "usage: node verify-audit-export.mjs --batch <file> --public-key <pem> --tenant <id> [--previous-digest <hex>] [--first <n>] [--last <n>]",
      "",
      "  --batch           path to the signed audit batch artifact (JSON bytes)",
      "  --public-key      path to the PEM public key that verifies the manifest signature",
      "  --tenant          tenant id the batch must belong to",
      "  --previous-digest previous chain-tail digest (hex); genesis zeros on first export",
      "  --first           expected first record sequence (optional)",
      "  --last            expected last record sequence (optional)",
    ].join("\n"),
  );
}

const args = process.argv.slice(2);
const value = (flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};

const batchFile = value("--batch");
const keyFile = value("--public-key");
const tenant = value("--tenant");
if (!batchFile || !keyFile || !tenant) {
  usage();
  process.exit(2);
}

if (!existsSync(batchFile)) {
  console.error(`no such batch file: ${batchFile}`);
  process.exit(2);
}
if (!existsSync(keyFile)) {
  console.error(`no such public key file: ${keyFile}`);
  process.exit(2);
}

const result = verifyAuditBatch({
  artifactBytes: new Uint8Array(readFileSync(batchFile)),
  publicKey: readFileSync(keyFile, "utf8"),
  expectedTenantId: tenant,
  previousDigest: value("--previous-digest"),
  expectedFirstSequence: value("--first") === undefined ? undefined : Number(value("--first")),
  expectedLastSequence: value("--last") === undefined ? undefined : Number(value("--last")),
});

if (!result.ok) {
  console.error(`audit batch FAILED verification: ${result.errors.join("; ")}`);
  process.exit(1);
}
const batch = result.batch;
console.log(
  [
    `audit batch OK`,
    `  tenant        ${batch.tenantId}`,
    `  batchId       ${batch.batchId}`,
    `  sequences     ${batch.firstSequence}..${batch.lastSequence} (${batch.recordCount} records)`,
    `  nextDigest    ${batch.nextDigest}`,
  ].join("\n"),
);
process.exit(0);
