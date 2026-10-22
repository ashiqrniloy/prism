import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** Executable stand-in for the obscura CLI. `fetch <url> --dump markdown` prints a page and exits 0. */
export function writeObscuraFixture(dir: string): string {
  const path = join(dir, "obscura");
  writeFileSync(path, "#!/bin/sh\nprintf '%s\\n' 'fixture page'\n", { mode: 0o755 });
  return path;
}
