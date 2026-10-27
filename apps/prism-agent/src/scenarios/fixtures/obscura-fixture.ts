import { writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Executable stand-in for the obscura CLI. `fetch <url> --dump markdown` prints a page and exits 0.
 * `--version` reports a guarded release (0.1.8+), because tools-web probes it before registering the
 * Obscura page path and falls back to the native backend — which would reach the network in a scenario.
 */
export function writeObscuraFixture(dir: string): string {
  const path = join(dir, "obscura");
  writeFileSync(
    path,
    "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then\n  printf '%s\\n' 'obscura 0.2.5'\n  exit 0\nfi\nprintf '%s\\n' 'fixture page'\n",
    { mode: 0o755 },
  );
  return path;
}
