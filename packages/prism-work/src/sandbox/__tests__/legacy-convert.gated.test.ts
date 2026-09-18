import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { DocumentsParseError, generateDocument, isZipContainer, parseDocument, type DocModel } from "../../documents/index.js";

const enabled = process.env.PRISM_TEST_WORK_SANDBOX === "1";
const docker = process.env.PRISM_TEST_DOCKER_BIN ?? "/usr/bin/docker";
const image = "prism-work-sandbox:test";
const context = resolve(import.meta.dirname, "../../..");
const SOFFICE_MS = 60_000;
const OLE = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

const tinyDoc: DocModel = {
  kind: "doc",
  modelVersion: 1,
  blocks: [{ type: "paragraph", text: "legacy" }],
};

describe("in-process parseDocument refuses OLE binaries", () => {
  it("rejects .doc magic bytes", async () => {
    assert.equal(isZipContainer(OLE), false);
    await assert.rejects(() => parseDocument(OLE, { kind: "doc" }), DocumentsParseError);
  });
});

describe("work sandbox legacy convert", { skip: !enabled || !existsSync(docker) }, () => {
  it("converts .doc to zip-PK docx that parseDocument accepts", async () => {
    ensureImage();
    const dir = workspace();
    try {
      const { bytes } = await generateDocument(tinyDoc, { format: "docx" });
      writeFileSync(join(dir, "src.docx"), bytes);
      mkdirSync(join(dir, "out"), { recursive: true });
      const toDoc = sandbox(dir, ["soffice", "--convert-to", "doc", "--outdir", "/workspace", "/workspace/src.docx"]);
      assert.equal(toDoc.status, 0, toDoc.stderr || toDoc.stdout);
      assert.equal(isZipContainer(new Uint8Array(readFileSync(join(dir, "src.doc")))), false);
      const toDocx = sandbox(dir, ["soffice", "--convert-to", "docx", "--outdir", "/workspace/out", "/workspace/src.doc"]);
      assert.equal(toDocx.status, 0, toDocx.stderr || toDocx.stdout);
      const converted = new Uint8Array(readFileSync(join(dir, "out", "src.docx")));
      assert.equal(isZipContainer(converted), true);
      const parsed = (await parseDocument(converted, { kind: "doc" })) as DocModel;
      assert.equal(parsed.kind, "doc");
    } finally {
      cleanup(dir);
    }
  });
});

function ensureImage(): void {
  if (spawnSync(docker, ["image", "inspect", image], { encoding: "utf8" }).status === 0) return;
  const build = spawnSync(docker, ["build", "-f", join(context, "sandbox/Dockerfile"), "-t", image, context], {
    encoding: "utf8",
    timeout: 600_000,
  });
  assert.equal(build.status, 0, build.stderr || build.stdout);
}

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "prism-work-legacy-"));
  chmodSync(dir, 0o777);
  return dir;
}

function sandbox(dir: string, args: readonly string[]) {
  return spawnSync(docker, ["run", "--rm", "--network", "none", "--user", "65532:65532", "--volume", `${dir}:/workspace`, image, ...args], {
    encoding: "utf8",
    timeout: SOFFICE_MS + 10_000,
  });
}

function cleanup(dir: string): void {
  spawnSync(docker, ["run", "--rm", "--user", "0:0", "--volume", `${dir}:/workspace`, image, "chmod", "-R", "777", "/workspace"], {
    encoding: "utf8",
  });
  rmSync(dir, { recursive: true, force: true });
}
