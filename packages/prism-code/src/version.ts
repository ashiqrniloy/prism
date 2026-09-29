import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Injected by the plan 140 binary build (`--define PRISM_CODE_VERSION='"x.y.z"'`). */
declare const PRISM_CODE_VERSION: string | undefined;

/** Manifest version, or the binary-build define when compiled. */
export function resolvePrismCodeVersion(): string {
  if (typeof PRISM_CODE_VERSION === "string" && PRISM_CODE_VERSION.length > 0) return PRISM_CODE_VERSION;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 4; depth++) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      const manifest: unknown = JSON.parse(readFileSync(candidate, "utf8"));
      if (typeof manifest === "object" && manifest !== null && "name" in manifest && manifest.name === "@arnilo/prism-code") {
        return "version" in manifest && typeof manifest.version === "string" ? manifest.version : "0.0.0";
      }
    }
    dir = dirname(dir);
  }
  return "0.0.0";
}

/** Install channel for support diagnostics: `binary` for a compiled executable, `bun` for the package. */
export function resolvePrismCodeChannel(): "binary" | "bun" {
  return typeof PRISM_CODE_VERSION === "string" && PRISM_CODE_VERSION.length > 0 ? "binary" : "bun";
}
