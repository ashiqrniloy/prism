/**
 * Linux libc selection for OpenTUI's native library.
 *
 * `@opentui/core` loads its musl build only when `OPENTUI_LIBC=musl`; otherwise it loads the glibc
 * build, which cannot load on Alpine. Both the Bun install and the plan 140 musl binaries run this
 * before the app graph loads so Prism Code starts on musl hosts with no extra setup. An explicit
 * `OPENTUI_LIBC` always wins.
 */

/** The `header.glibcVersionRuntime` slice of `process.report.getReport()`; absent on musl. */
export interface LibcReport {
  readonly header?: { readonly glibcVersionRuntime?: string };
}

export function detectLinuxLibc(report: LibcReport | undefined): "glibc" | "musl" {
  return typeof report?.header?.glibcVersionRuntime === "string" ? "glibc" : "musl";
}

/** Sets `OPENTUI_LIBC=musl` on a musl Linux host unless the variable is already set. Returns the value in effect. */
export function applyOpenTuiLibc(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  readReport: () => LibcReport | undefined = () => process.report?.getReport() as LibcReport | undefined,
): string | undefined {
  if (platform !== "linux" || env.OPENTUI_LIBC) return env.OPENTUI_LIBC;
  if (detectLinuxLibc(readReport()) === "musl") env.OPENTUI_LIBC = "musl";
  return env.OPENTUI_LIBC;
}
