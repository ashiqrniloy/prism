import { HeadlessError } from "../errors.js";

export function nextCron(expression: string, now: number, tz = "UTC"): string {
  const { Bun } = globalThis as unknown as {
    Bun: { cron: { parse(expression: string, after: number, options: { tz: string }): Date | null } };
  };
  try {
    Bun.cron.parse("* * * * *", now, { tz });
  } catch {
    throw new HeadlessError("invalid_timezone");
  }
  try {
    const next = Bun.cron.parse(expression, now, { tz });
    if (!next || !Number.isFinite(next.getTime()) || next.getTime() <= now) throw new Error();
    return next.toISOString();
  } catch {
    throw new HeadlessError("invalid_cron");
  }
}
