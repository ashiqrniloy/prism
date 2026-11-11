import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { runManifestCommand } from "../cli-manifest.js";
import { runRelay } from "../cli-relay.js";

function sink(): { stream: Writable; text: () => string } {
  let text = "";
  const stream = new Writable({
    write(chunk, _enc, done) {
      text += chunk.toString();
      done();
    },
  });
  return { stream, text: () => text };
}

describe("prism bin", () => {
  it("prism_bin_runs_no_agent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "prism-no-agent-"));
    const cli = join(process.cwd(), "src/cli.ts");
    const result = spawnSync(process.execPath, [cli, "-p", "hi"], {
      cwd: dir,
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /prism add/);
    assert.match(`${result.stdout}${result.stderr}`, /prism relay/);
    assert.deepEqual(await readdir(dir), []);
  });

  it("prism_bin_dispatches_manifest_and_relay", async () => {
    const out = sink();
    const err = sink();
    const code = await runManifestCommand(["list"], {
      stdout: out.stream,
      stderr: err.stream,
      cwd: await mkdtemp(join(tmpdir(), "prism-list-")),
    });
    assert.equal(code, 0);
    assert.match(out.text(), /No packages are installed/);

    const relayErr = sink();
    const relay = await runRelay(["--help"], { stdin: new PassThrough(), stdout: sink().stream, stderr: relayErr.stream });
    assert.notEqual(relay, 1);
    assert.match(relayErr.text(), /prism relay/);
  });
});
