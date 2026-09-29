/**
 * Test-only isolation for the durable session store default.
 *
 * Prism Code sessions live in `PRISM_HOME`/`~/.prism` by default, so a test that
 * assembles Prism Code without an explicit store would otherwise write to the
 * developer's real home. Each test process gets its own `PRISM_HOME` unless the
 * runner already set one.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.PRISM_HOME) {
  const home = mkdtempSync(join(tmpdir(), "prism-code-test-home-"));
  process.env.PRISM_HOME = home;
  process.on("exit", () => {
    try {
      rmSync(home, { recursive: true, force: true });
    } catch {
      // Best effort: a leftover temp dir must not fail the test process.
    }
  });
}
