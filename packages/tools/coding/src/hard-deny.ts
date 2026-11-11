/**
 * Hard denies for this package's own tools, through one `tool.call` decide handler.
 *
 * The kernel's combination rule for `tool.call` is any-deny-wins, so these holds under
 * `approval` `auto`, under a host `allow` hook, and from a custom loop. Reasons name the root
 * and the tool, never file contents. Tools this package did not register are ignored. For
 * read-effect tools, `targets.roots` also carries each skill directory; mutating tools never do.
 */
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { ToolCallDecision, ToolCallHookPayload } from "@arnilo/prism";
import { type CommandRule, evaluateCommandRules } from "./security/command-rules.js";
import { realpathNearest } from "./security/path-containment.js";
import { CODING_TOOL_NAMES, type CodingTargetsFn } from "./targets.js";

/** Tools that change state; denied when `readOnly` is set. */
const MUTATING_TOOLS: ReadonlySet<string> = new Set(["write", "edit", "delete", "move", "shell"]);

export interface HardDenyOptions {
  readonly targets: CodingTargetsFn;
  readonly readOnly: boolean;
  readonly commandRules?: readonly CommandRule[];
}

function isPathInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * A containment check that realpaths the roots once and then costs one `realpath` per path
 * argument, with no directory walk. Fails closed when a root or the target cannot be resolved.
 */
function createContainmentChecker(roots: readonly string[]): (target: string) => Promise<boolean> {
  let realRoots: Promise<readonly string[]> | undefined;
  const loadRoots = () => {
    realRoots ??= Promise.all(
      roots.map(async (root) => {
        try {
          return await realpath(resolve(root));
        } catch {
          return undefined;
        }
      }),
    ).then((resolved) => resolved.filter((root): root is string => root !== undefined));
    return realRoots;
  };
  return async (target: string) => {
    const resolved = await loadRoots();
    if (resolved.length === 0) return false;
    const to = await realpathNearest(target);
    return to !== undefined && resolved.some((root) => isPathInside(root, to));
  };
}

/** The `tool.call` decide handler. Returns `{ deny }` or `undefined`; never throws. */
export function createHardDenyHook(options: HardDenyOptions) {
  return async (payload: ToolCallHookPayload): Promise<ToolCallDecision | undefined> => {
    if (!CODING_TOOL_NAMES.has(payload.name)) return undefined;
    const targets = options.targets(payload.name, payload.args, { sessionId: payload.sessionId });
    if (!targets) return undefined;

    if (options.readOnly && MUTATING_TOOLS.has(payload.name)) {
      return { deny: `${payload.name} denied: @arnilo/prism-tools/coding is read-only` };
    }

    if (targets.paths.length > 0) {
      const contained = createContainmentChecker(targets.roots);
      for (const path of targets.paths) {
        if (!(await contained(path))) {
          return { deny: `${payload.name} denied: path outside coding roots (${targets.roots.join(", ")}): ${path}` };
        }
      }
    }

    if (payload.name === "shell") {
      const command = typeof payload.args.command === "string" ? payload.args.command : "";
      const evaluation = evaluateCommandRules(command, options.commandRules, { denyMetacharacters: false });
      if (evaluation.action === "deny") {
        return { deny: `shell denied: ${evaluation.reason ?? "command matches a deny rule"}` };
      }
    }

    return undefined;
  };
}
