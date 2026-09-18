import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const enabled = process.env.PRISM_TEST_WORK_SANDBOX === "1";
const docker = process.env.PRISM_TEST_DOCKER_BIN ?? "/usr/bin/docker";
const context = join(dirname(fileURLToPath(import.meta.url)), "../packages/prism-work");

describe("work sandbox image", { skip: !enabled }, () => {
  it("installs python office libs, soffice, and pdftoppm", () => {
    const build = spawnSync(docker, ["build", "-f", join(context, "sandbox/Dockerfile"), "-t", "prism-work-sandbox:test", context], {
      encoding: "utf8",
    });
    assert.equal(build.status, 0, build.stderr || build.stdout);
    const run = (...args) =>
      spawnSync(docker, ["run", "--rm", "--network", "none", "--user", "65532:65532", "prism-work-sandbox:test", ...args], {
        encoding: "utf8",
      });
    const python = run("python3", "-c", "import docx, openpyxl, pptx");
    assert.equal(python.status, 0, python.stderr);
    const soffice = run("soffice", "--version");
    assert.equal(soffice.status, 0, soffice.stderr);
    assert.match(`${soffice.stdout}${soffice.stderr}`, /LibreOffice/i);
    const pdf = run("pdftoppm", "-h");
    assert.ok(pdf.status === 0 || pdf.status === 1, pdf.stderr);
    assert.match(`${pdf.stdout}${pdf.stderr}`, /pdftoppm/i);
  });
});
