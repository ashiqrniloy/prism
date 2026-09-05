import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { createCodingTools, createEditTool, createReadTool, createWriteTool } from "../agent/index.js";
import { createCavemanExtension } from "../caveman/index.js";
import { createComputerUseLinuxTools } from "../computer-use-linux/index.js";
import { createPrismDevInspector } from "../dev/index.js";
import { createDocumentReader } from "../document-reader/index.js";
import { createImpeccableExtension } from "../impeccable/index.js";
import { createOpenApiTools } from "../openapi/index.js";
import { createPonytailExtension } from "../ponytail/index.js";
import { createCodingApprovalPolicy, createDockerSandbox } from "../security/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, "../..");
const manifest = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"));

describe("@arnilo/prism-coding-tools conformance", () => {
  it("exports all 9 subpaths with valid types and default entrypoints", () => {
    const expectedSubpaths = [
      "./agent",
      "./security",
      "./document-reader",
      "./openapi",
      "./computer-use-linux",
      "./dev",
      "./dev/cli",
      "./caveman",
      "./ponytail",
      "./impeccable",
    ];
    for (const subpath of expectedSubpaths) {
      assert.ok(manifest.exports[subpath], `Missing subpath export: ${subpath}`);
      assert.ok(manifest.exports[subpath].types, `Missing types for: ${subpath}`);
      assert.ok(manifest.exports[subpath].default, `Missing default entry for: ${subpath}`);
    }
  });

  it("subpath functions are callable factories", () => {
    assert.equal(typeof createCodingTools, "function");
    assert.equal(typeof createReadTool, "function");
    assert.equal(typeof createWriteTool, "function");
    assert.equal(typeof createEditTool, "function");
    assert.equal(typeof createCodingApprovalPolicy, "function");
    assert.equal(typeof createDockerSandbox, "function");
    assert.equal(typeof createDocumentReader, "function");
    assert.equal(typeof createOpenApiTools, "function");
    assert.equal(typeof createComputerUseLinuxTools, "function");
    assert.equal(typeof createPrismDevInspector, "function");
    assert.equal(typeof createCavemanExtension, "function");
    assert.equal(typeof createPonytailExtension, "function");
    assert.equal(typeof createImpeccableExtension, "function");
  });

  it("retains prism-dev binary", () => {
    assert.ok(manifest.bin["prism-dev"]);
    assert.equal(manifest.bin["prism-dev"], "dist/dev/cli.js");
  });

  it("has zero runtime imports of retired package names in src/", () => {
    const retiredNames = [
      "@arnilo/prism-coding-agent",
      "@arnilo/prism-coding-security",
      "@arnilo/prism-document-reader",
      "@arnilo/prism-openapi-tools",
      "@arnilo/prism-computer-use-linux",
      "@arnilo/prism-dev",
      "@arnilo/prism-caveman",
      "@arnilo/prism-ponytail",
      "@arnilo/prism-impeccable",
      "@arnilo/prism-personas",
    ];

    function scanDir(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "__tests__") scanDir(fullPath);
        } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
          const text = readFileSync(fullPath, "utf8");
          for (const retired of retiredNames) {
            assert.ok(
              !text.includes(`"${retired}`) && !text.includes(`'${retired}'`),
              `${fullPath} imports retired package name: ${retired}`,
            );
          }
        }
      }
    }

    scanDir(join(pkgRoot, "src"));
  });

  it("document-reader fails closed when parser peers are absent", async () => {
    // npm >= 7 auto-installs optional peers (hoisted to the root node_modules),
    // so absence is environment-dependent. The fail-closed contract is asserted
    // unconditionally by the packed-consumer journeys (no peers installed);
    // here it is only provable when the peers are genuinely missing.
    const peersAbsent = await Promise.all(
      ["pdf-parse", "mammoth"].map(async (name) =>
        import(name).then(
          () => false,
          () => true,
        ),
      ),
    );
    if (!peersAbsent.every(Boolean)) return; // peers installed: rejection path unreachable
    await assert.rejects(async () => await createDocumentReader(), /optional peer parser/);
  });
});
