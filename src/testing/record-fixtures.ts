import { readFileSync, writeFileSync } from "node:fs";

export interface RecordedFixture {
  readonly version: 1;
  readonly turns: readonly { readonly input: readonly string[]; readonly output: readonly string[] }[];
}

export interface RecordFixtureOptions {
  readonly redact?: (line: string) => string;
  readonly secrets?: readonly string[];
}

/** Serialized into a Bun-only wrapper; taps bytes without changing their forwarding. */
async function tee(command: readonly string[], logPath: string): Promise<void> {
  const { spawn } = await import("node:child_process");
  const { appendFileSync } = await import("node:fs");
  const { Transform } = await import("node:stream");
  const { StringDecoder } = await import("node:string_decoder");
  const tap = (dir: "in" | "out") => {
    const decoder = new StringDecoder("utf8");
    let pending = "";
    const record = (line: string) => appendFileSync(logPath, `${JSON.stringify({ dir, line })}\n`, { mode: 0o600 });
    return new Transform({
      transform(chunk, _encoding, done) {
        try {
          pending += decoder.write(chunk);
          let at: number;
          while ((at = pending.indexOf("\n")) !== -1) {
            record(pending.slice(0, at).replace(/\r$/, ""));
            pending = pending.slice(at + 1);
          }
          done(null, chunk);
        } catch (error) {
          done(error as Error);
        }
      },
      flush(done) {
        try {
          pending += decoder.end();
          if (pending !== "") record(pending);
          done();
        } catch (error) {
          done(error as Error);
        }
      },
    });
  };
  const child = spawn(command[0]!, command.slice(1), { stdio: ["pipe", "pipe", "inherit"] });
  const input = tap("in"),
    output = tap("out");
  const fail = () => {
    child.kill("SIGKILL");
    process.stdin.destroy();
    process.exitCode = 1;
  };
  input.on("error", fail);
  output.on("error", fail);
  child.on("error", fail);
  child.stdin.on("error", () => process.stdin.unpipe(input));
  process.stdin.pipe(input).pipe(child.stdin);
  child.stdout.pipe(output).pipe(process.stdout);
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
  child.on("close", (code, signal) => {
    process.stdin.destroy();
    process.exitCode = code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1);
  });
}

/** External recording wrapper. The raw log is sensitive; only finish() redacts it. */
export const recordFixtures = {
  command(command: readonly string[], logPath: string): readonly string[] {
    if (command.length === 0 || command.some((arg) => typeof arg !== "string") || !command[0])
      throw new TypeError("fixture command needs argv");
    return [process.execPath, "-e", `(${tee.toString()})(${JSON.stringify(command)}, ${JSON.stringify(logPath)})`];
  },

  async finish(logPath: string, outPath: string, options: RecordFixtureOptions = {}): Promise<void> {
    const secrets = [...(options.secrets ?? [])];
    if (secrets.some((secret) => typeof secret !== "string" || secret === ""))
      throw new TypeError("fixture_secret: secrets must be non-empty strings");
    secrets.sort((a, b) => b.length - a.length);
    const clean = (line: string): string => {
      let value = options.redact ? options.redact(line) : line;
      if (typeof value !== "string") throw new TypeError("fixture redactor must return a string");
      value = value.replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]");
      for (const secret of secrets) value = value.split(secret).join("[redacted]");
      return value;
    };
    const turns: { input: string[]; output: string[] }[] = [];
    let turn: { input: string[]; output: string[] } | undefined;
    for (const line of readFileSync(logPath, "utf8").split("\n")) {
      if (line === "") continue;
      const entry = JSON.parse(line);
      if (!entry || (entry.dir !== "in" && entry.dir !== "out") || typeof entry.line !== "string")
        throw new TypeError("invalid fixture record");
      if (entry.dir === "in" || !turn) {
        turn = { input: [], output: [] };
        turns.push(turn);
      }
      turn[entry.dir === "in" ? "input" : "output"].push(clean(entry.line));
    }
    const fixture = `${JSON.stringify({ version: 1, turns }, null, 2)}\n`;
    if (
      secrets.some(
        (secret) => fixture.includes(secret) || turns.some((t) => [...t.input, ...t.output].some((line) => line.includes(secret))),
      )
    ) {
      throw new Error("fixture_secret: supplied secret survived redaction");
    }
    writeFileSync(outPath, fixture, { mode: 0o600 });
  },

  load(path: string): RecordedFixture {
    const fixture = JSON.parse(readFileSync(path, "utf8"));
    if (fixture?.version !== 1) throw new TypeError("unsupported fixture version");
    if (
      !Array.isArray(fixture.turns) ||
      fixture.turns.some(
        (turn: RecordedFixture["turns"][number]) =>
          !turn ||
          !Array.isArray(turn.input) ||
          !Array.isArray(turn.output) ||
          [...turn.input, ...turn.output].some((line) => typeof line !== "string"),
      )
    ) {
      throw new TypeError("invalid fixture turns");
    }
    return fixture;
  },
};
