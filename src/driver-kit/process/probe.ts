import { spawn } from "node:child_process";
import { buildChildEnv, type ChildEnvOptions } from "./env.js";

/**
 * Runs `<binary> <args>` once with a built environment and returns the first stdout line (trimmed), for a
 * version string. Undefined when the binary is missing, exits non-zero, or exceeds `timeoutMs` (default 5 s).
 */
export function probeBinary(
  binary: string,
  args: readonly string[] = ["--version"],
  options: { readonly timeoutMs?: number; readonly env?: ChildEnvOptions } = {},
): Promise<string | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | undefined): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const child = spawn(binary, [...args], { env: buildChildEnv(options.env), stdio: ["ignore", "pipe", "ignore"] });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(undefined);
    }, options.timeoutMs ?? 5000);
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => {
      if (out.length < 4096) out += chunk.toString();
    });
    child.on("error", () => finish(undefined));
    child.on("close", (code) => finish(code === 0 ? out.split("\n")[0]?.trim() || undefined : undefined));
  });
}
