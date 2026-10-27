import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "bun:test";
import { scanSecrets } from "./scan-secrets.mjs";

test("secret scan examines gitignored files but excludes the graft cache", async () => {
  const root = mkdtempSync(join(tmpdir(), "prism-secret-scan-"));
  const credential = `AK${"IA"}${"A".repeat(16)}`;
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    writeFileSync(join(root, ".gitignore"), "ignored.env\n");
    writeFileSync(join(root, "ignored.env"), credential);
    assert.equal(execFileSync("git", ["check-ignore", "ignored.env"], { cwd: root, encoding: "utf8" }).trim(), "ignored.env");
    await assert.rejects(
      () => scanSecrets([root]),
      (error) => error.message.includes("aws-access-key") && !error.message.includes(credential),
    );

    rmSync(join(root, "ignored.env"));
    mkdirSync(join(root, "graft"));
    writeFileSync(join(root, "graft", "ignored.env"), credential);
    assert.equal((await scanSecrets([root])).findings, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("secret scan skips local credential files by name and still rejects every other ignored file", async () => {
  const root = mkdtempSync(join(tmpdir(), "prism-secret-scan-local-"));
  const credential = `AK${"IA"}${"B".repeat(16)}`;
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    writeFileSync(join(root, ".gitignore"), "scripts/live.env\nscripts/other.env\n*.local.env\n");
    mkdirSync(join(root, "scripts"));
    writeFileSync(join(root, "scripts", "live.env"), credential);
    writeFileSync(join(root, "scripts", "m365.local.env"), credential);
    writeFileSync(join(root, "scripts", "other.env"), credential);
    await assert.rejects(
      () => scanSecrets([root]),
      (error) => error.message.includes("scripts/other.env") && !error.message.includes(credential),
    );

    rmSync(join(root, "scripts", "other.env"));
    assert.equal((await scanSecrets([root])).findings, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("secret scan rejects a Sign in with ChatGPT client ID and a compact JWS", async () => {
  const root = mkdtempSync(join(tmpdir(), "prism-secret-scan-siwc-"));
  try {
    const clientId = `oaiapp${"_"}${"a".repeat(32)}`;
    const jws = ["eyJhbGciOiJSUzI1NiJ9", "eyJzdWIiOiJ1c2VyLTEyMyJ9", "c2lnbmF0dXJlLXBsYWNlaG9sZGVy"].join(".");
    writeFileSync(join(root, "record.json"), JSON.stringify({ clientId }));
    await assert.rejects(
      () => scanSecrets([root]),
      (error) => error.message.includes("openai-client-id") && !error.message.includes(clientId),
    );

    writeFileSync(join(root, "record.json"), JSON.stringify({ clientId: "dynamic_agent_client", idToken: jws }));
    await assert.rejects(
      () => scanSecrets([root]),
      (error) => error.message.includes("jwt") && !error.message.includes(jws),
    );

    writeFileSync(join(root, "record.json"), JSON.stringify({ clientId: "dynamic_agent_client", note: "no token here" }));
    assert.equal((await scanSecrets([root])).findings, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("every skipped local credential name is gitignored in this repo", () => {
  const repoRoot = join(import.meta.dirname, "..");
  for (const name of ["scripts/live.env", "scripts/example.local.env"])
    assert.equal(
      execFileSync("git", ["check-ignore", "--no-index", name], { cwd: repoRoot, encoding: "utf8" }).trim(),
      name,
      `${name} must stay gitignored while the secret scan skips it`,
    );
});
