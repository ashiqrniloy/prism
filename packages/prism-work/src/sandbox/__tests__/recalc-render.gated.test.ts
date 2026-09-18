import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { generateDocument, parseDocument, type DeckModel, type SheetModel } from "../../documents/index.js";

const enabled = process.env.PRISM_TEST_WORK_SANDBOX === "1";
const docker = process.env.PRISM_TEST_DOCKER_BIN ?? "/usr/bin/docker";
const image = "prism-work-sandbox:test";
const context = resolve(import.meta.dirname, "../../..");
const XLSX_RECALC = "/opt/prism-work/skills/skills/productivity/xlsx/scripts/xlsx_recalc.py";
const PPTX_RENDER = "/opt/prism-work/skills/skills/productivity/powerpoint/scripts/pptx_render.py";
const SOFFICE_MS = 60_000;

const formulaSheet: SheetModel = {
  kind: "sheet",
  modelVersion: 1,
  sheets: [{ name: "s", cells: [[{ formula: "=SUM(1,2)" }]] }],
};

const oneSlide: DeckModel = {
  kind: "deck",
  modelVersion: 1,
  slides: [{ layout: "title", title: "QA" }],
};

describe("in-process SheetModel does not evaluate formulas", () => {
  it("preserves =SUM(1,2) without a cached 3", async () => {
    const { bytes } = await generateDocument(formulaSheet, { format: "xlsx" });
    const parsed = (await parseDocument(bytes, { kind: "sheet" })) as SheetModel;
    const cell = parsed.sheets[0]?.cells[0]?.[0];
    assert.ok(cell && typeof cell === "object" && "formula" in cell);
    assert.match(cell.formula, /SUM\(1,2\)/);
    assert.notEqual(cell.cachedValue, 3);
  });
});

describe("work sandbox recalc and render", { skip: !enabled || !existsSync(docker) }, () => {
  it("recalculates =SUM(1,2) to cached 3", async () => {
    ensureImage();
    const dir = workspace();
    try {
      const { bytes } = await generateDocument(formulaSheet, { format: "xlsx" });
      writeFileSync(join(dir, "out.xlsx"), bytes);
      const run = sandbox(dir, ["python3", XLSX_RECALC, "/workspace/out.xlsx", "--out", "/workspace/recalced.xlsx", "--timeout", "60"]);
      assert.equal(run.status, 0, run.stderr || run.stdout);
      const parsed = (await parseDocument(new Uint8Array(readFileSync(join(dir, "recalced.xlsx"))), { kind: "sheet" })) as SheetModel;
      const cell = parsed.sheets[0]?.cells[0]?.[0];
      assert.ok(cell && typeof cell === "object" && "formula" in cell);
      assert.notEqual(cell.formula, "#REF!");
      assert.equal(Number(cell.cachedValue), 3);
    } finally {
      cleanup(dir);
    }
  });

  it("renders one pptx slide to a PNG", async () => {
    ensureImage();
    const dir = workspace();
    try {
      const { bytes } = await generateDocument(oneSlide, { format: "pptx" });
      writeFileSync(join(dir, "deck.pptx"), bytes);
      const run = sandbox(dir, ["python3", PPTX_RENDER, "/workspace/deck.pptx", "--outdir", "/workspace/render"]);
      assert.equal(run.status, 0, run.stderr || run.stdout);
      const pngs = readdirSync(join(dir, "render")).filter((name) => name.endsWith(".png"));
      assert.ok(pngs.length >= 1, run.stdout);
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
  const dir = mkdtempSync(join(tmpdir(), "prism-work-qa-"));
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
