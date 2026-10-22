import { nextCron } from "./cron.js";
import type { ScheduleState } from "./state.js";

export function missedOccurrences(state: ScheduleState, now: number) {
  let count = 0;
  let nextRunAt = state.nextRunAt;
  while (nextRunAt !== null && Date.parse(nextRunAt) <= now) {
    count++;
    nextRunAt = state.cron ? nextCron(state.cron, Date.parse(nextRunAt), state.tz) : null;
  }
  return { count, nextRunAt };
}
