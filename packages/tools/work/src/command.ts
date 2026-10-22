import { statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

/**
 * Resolve a host-owned connector CLI the same way a shell would: an absolute path must be an
 * executable file; a bare name is searched on the absolute `PATH` entries only. No shell, no
 * relative directory entries. Returns `undefined` when the command cannot be resolved.
 */
export function resolveCommand(name: string): string | undefined {
  if (name.length === 0 || name.includes("\0") || name.length > 4096) return undefined;
  const executable = (path: string): boolean => {
    try {
      const stat = statSync(path);
      if (!stat.isFile()) return false;
      return process.platform === "win32" || (stat.mode & 0o111) !== 0;
    } catch {
      return false;
    }
  };
  if (isAbsolute(name)) return executable(name) ? name : undefined;
  if (name.includes("/") || name.includes("\\")) return undefined;
  const pathExt = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir || !isAbsolute(dir)) continue;
    const candidates = pathExt.length > 0 ? pathExt.map((ext) => join(dir, `${name}${ext.toLowerCase()}`)) : [join(dir, name)];
    for (const candidate of candidates) if (executable(candidate)) return candidate;
  }
  return undefined;
}
