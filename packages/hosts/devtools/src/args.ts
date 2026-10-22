/**
 * Argument parsing for the `prism-devtools` binary. No agent construction here: `bin/prism-devtools.ts`
 * owns `createAgent` and `serveDevtools`, so the host-surface gate sees the one construction site.
 */
import { parseArgs } from "node:util";

export interface DevtoolsModel {
  readonly provider: string;
  readonly model: string;
}

export interface DevtoolsArgs {
  /** Manifest root; defaults to the current directory. */
  readonly root?: string;
  readonly model: DevtoolsModel;
  /** Without this, the project scope never loads (roadmap §2.7). */
  readonly trustProject: boolean;
  /** Loopback port. `0` picks a free one. */
  readonly port: number;
}

export class DevtoolsArgsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DevtoolsArgsError";
  }
}

/** `provider/model`; the model may contain slashes, the provider may not. */
function parseModel(value: string | undefined): DevtoolsModel {
  if (value === undefined) throw new DevtoolsArgsError("--model is required (provider/model, e.g. anthropic/claude-sonnet-4-5)");
  const slash = value.indexOf("/");
  const provider = slash === -1 ? "" : value.slice(0, slash);
  const model = slash === -1 ? "" : value.slice(slash + 1);
  if (!provider || !model) throw new DevtoolsArgsError(`--model must be provider/model, got "${value}"`);
  return { provider, model };
}

const DEFAULT_PORT = 4311;

function parsePort(value: string | undefined): number {
  if (value === undefined) return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new DevtoolsArgsError(`--port must be an integer from 0 to 65535, got "${value}"`);
  return port;
}

export function parseDevtoolsArgs(argv: readonly string[]): DevtoolsArgs {
  let values: { root?: string; model?: string; "trust-project"?: boolean; port?: string };
  try {
    values = parseArgs({
      args: [...argv],
      options: {
        root: { type: "string" },
        model: { type: "string" },
        "trust-project": { type: "boolean" },
        port: { type: "string" },
      },
      allowPositionals: false,
    }).values as typeof values;
  } catch (error) {
    throw new DevtoolsArgsError(error instanceof Error ? error.message : String(error));
  }
  return {
    ...(values.root === undefined ? {} : { root: values.root }),
    model: parseModel(values.model),
    trustProject: values["trust-project"] === true,
    port: parsePort(values.port),
  };
}
