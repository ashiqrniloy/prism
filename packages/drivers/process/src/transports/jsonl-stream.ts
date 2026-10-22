import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createStdinWriter, readJsonl } from "@arnilo/prism/driver-kit";
import type { Transport } from "./types.js";

export function jsonlStream(child: ChildProcessWithoutNullStreams, redact: (text: string) => string): Transport {
  const writer = createStdinWriter(child.stdin);
  return {
    send: (frame) => writer.write(JSON.stringify(frame)),
    frames: readJsonl(child.stdout, { maxLineBytes: 1024 * 1024, redact }),
    close: () => writer.close(),
  };
}
