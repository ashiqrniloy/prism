import { formatUsage, parseArgs, UsageError } from "../src/cli/args.js";
import type { LineIO } from "../src/cli/jsonl.js";

const io: LineIO = {
  write(line) {
    process.stdout.write(line);
  },
  writeError(text) {
    process.stderr.write(text.endsWith("\n") ? text : `${text}\n`);
  },
};

let code = 2;
try {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "run") code = await (await import("../src/cli/run.js")).runCommand(args, io);
  else if (args.command === "resume") code = await (await import("../src/cli/resume.js")).resumeCommand(args, io);
  else if (args.command === "schedule") code = await (await import("../src/cli/schedule.js")).scheduleCommand(args, io);
  else code = await (await import("../src/cli/acp.js")).acpCommand(args, io);
} catch (error) {
  if (error instanceof UsageError) {
    io.writeError(formatUsage());
    code = 2;
  } else {
    io.writeError(error instanceof Error ? error.message : String(error));
    code = 1;
  }
}
process.exit(code);
