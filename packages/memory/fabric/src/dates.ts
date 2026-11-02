/**
 * Deterministic relative-date resolution (plan 202 Task 6). English first: a table of expressions
 * resolved against an exchange's reference time, with no model call and no locale bundle. A
 * resolution is a *reading* of the text, so an expression this table does not know is left out
 * rather than guessed.
 */
import type { MemoryNoteDate, MemoryNoteDatePrecision } from "./types.js";

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
};

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

const NUMBER =
  "\\d{1,3}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty";
const MONTH = MONTHS.join("|");
const WEEKDAY = WEEKDAYS.join("|");
const DAY_MS = 86_400_000;
const MAX_DATES = 16;

function numberValue(raw: string): number | undefined {
  const value = NUMBER_WORDS[raw.toLowerCase()] ?? Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function iso(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m, d)).toISOString();
}

function dayStart(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** Monday of the week holding `date`, UTC. */
function weekStart(date: Date): number {
  const start = dayStart(date);
  return start - ((date.getUTCDay() + 6) % 7) * DAY_MS;
}

function addDays(ms: number, days: number): number {
  return ms + days * DAY_MS;
}

function addMonths(ms: number, months: number): number {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1);
}

function addYears(ms: number, years: number): number {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear() + years, 0, 1);
}

function entry(text: string, resolved: number, precision: MemoryNoteDatePrecision): MemoryNoteDate {
  return { text: text.trim(), resolved: new Date(resolved).toISOString(), precision };
}

/** Locale gap: month and weekday names are English; other languages leave no resolution. */
export function resolveDates(text: string, tRef: string): readonly MemoryNoteDate[] {
  const reference = new Date(tRef);
  if (!Number.isFinite(reference.getTime())) return [];
  const referenceDay = dayStart(reference);
  const found: MemoryNoteDate[] = [];
  const add = (item: MemoryNoteDate | undefined) => {
    if (item !== undefined) found.push(item);
  };
  const matchFirst = (pattern: RegExp, resolve: (match: RegExpExecArray) => MemoryNoteDate | undefined) => {
    for (const match of text.matchAll(pattern)) add(resolve(match));
  };

  // Explicit ISO dates win over a relative reading of the same text.
  matchFirst(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (match) => {
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const ms = Date.UTC(year, month - 1, day);
    const date = new Date(ms);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
    return entry(match[0], ms, "day");
  });
  // A bare weekday is not a date; only an explicitly anchored one is.
  matchFirst(new RegExp(`\\b(last|next) (${WEEKDAY})\\b`, "gi"), (match) => {
    const target = WEEKDAYS.indexOf(match[2]!.toLowerCase() as (typeof WEEKDAYS)[number]);
    const forward = match[1]!.toLowerCase() === "next";
    const from = forward ? reference.getUTCDay() : target;
    const to = forward ? target : reference.getUTCDay();
    let delta = (to - from + 7) % 7;
    if (delta === 0) delta = 7;
    return entry(match[0], addDays(referenceDay, forward ? delta : -delta), "day");
  });
  matchFirst(/\b(?:the )?day before yesterday\b/gi, (match) => entry(match[0], addDays(referenceDay, -2), "day"));
  matchFirst(/\b(?:the )?day after tomorrow\b/gi, (match) => entry(match[0], addDays(referenceDay, 2), "day"));
  matchFirst(/\b(?<!day before )(?<!day after )(today|yesterday|tomorrow)\b/gi, (match) => {
    const word = match[1]!.toLowerCase();
    return entry(match[0], addDays(referenceDay, word === "yesterday" ? -1 : word === "tomorrow" ? 1 : 0), "day");
  });
  matchFirst(new RegExp(`\\b(${NUMBER})\\s+(day|week)s?\\s+ago\\b`, "gi"), (match) => {
    const count = numberValue(match[1]!);
    if (count === undefined) return undefined;
    return entry(match[0], addDays(referenceDay, -count * (match[2]!.toLowerCase() === "week" ? 7 : 1)), "day");
  });
  matchFirst(new RegExp(`\\b(${NUMBER})\\s+months?\\s+ago\\b`, "gi"), (match) => {
    const count = numberValue(match[1]!);
    return count === undefined ? undefined : entry(match[0], addMonths(referenceDay, -count), "month");
  });
  matchFirst(new RegExp(`\\b(${NUMBER})\\s+years?\\s+ago\\b`, "gi"), (match) => {
    const count = numberValue(match[1]!);
    return count === undefined ? undefined : entry(match[0], addYears(referenceDay, -count), "year");
  });
  matchFirst(/\b(last|this|next) week\b/gi, (match) => {
    const shift = match[1]!.toLowerCase() === "last" ? -7 : match[1]!.toLowerCase() === "next" ? 7 : 0;
    return entry(match[0], addDays(weekStart(reference), shift), "week");
  });
  matchFirst(/\b(last|this|next) month\b/gi, (match) => {
    const shift = match[1]!.toLowerCase() === "last" ? -1 : match[1]!.toLowerCase() === "next" ? 1 : 0;
    return entry(match[0], addMonths(dayStart(reference), shift), "month");
  });
  matchFirst(/\b(last|this|next) year\b/gi, (match) => {
    const shift = match[1]!.toLowerCase() === "last" ? -1 : match[1]!.toLowerCase() === "next" ? 1 : 0;
    return entry(match[0], addYears(dayStart(reference), shift), "year");
  });
  // "March 3", "March 3, 2026", "on the 3rd of March": a day inside a named month.
  matchFirst(new RegExp(`\\b(?:on )?(?:the )?(${MONTH})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?\\b`, "gi"), (match) => {
    const month = MONTHS.indexOf(match[1]!.toLowerCase() as (typeof MONTHS)[number]);
    const day = Number(match[2]);
    const explicitYear = match[3] === undefined ? undefined : Number(match[3]);
    const year = explicitYear ?? nearestYear(month, day, reference);
    const ms = Date.UTC(year, month, day);
    const date = new Date(ms);
    if (date.getUTCMonth() !== month || date.getUTCDate() !== day) return undefined;
    return entry(match[0], ms, "day");
  });
  matchFirst(new RegExp(`\\b(?:the )?(\\d{1,2})(?:st|nd|rd|th)? of (${MONTH})(?:,?\\s*(\\d{4}))?\\b`, "gi"), (match) => {
    const month = MONTHS.indexOf(match[2]!.toLowerCase() as (typeof MONTHS)[number]);
    const day = Number(match[1]);
    const year = match[3] === undefined ? nearestYear(month, day, reference) : Number(match[3]);
    const ms = Date.UTC(year, month, day);
    const date = new Date(ms);
    if (date.getUTCMonth() !== month || date.getUTCDate() !== day) return undefined;
    return entry(match[0], ms, "day");
  });
  // "in March", "last March 2026": the month itself.
  matchFirst(new RegExp(`\\b(?:in|last|this|next) (${MONTH})(?:\\s+(\\d{4}))?\\b`, "gi"), (match) => {
    const month = MONTHS.indexOf(match[1]!.toLowerCase() as (typeof MONTHS)[number]);
    const anchor = match[0].toLowerCase().startsWith("next") ? 1 : match[0].toLowerCase().startsWith("last") ? -1 : 0;
    const year =
      match[2] === undefined
        ? reference.getUTCFullYear() + (anchor === 0 && month > reference.getUTCMonth() ? -1 : anchor)
        : Number(match[2]);
    return entry(match[0], Date.UTC(year, month, 1), "month");
  });

  const unique = new Map<string, MemoryNoteDate>();
  for (const item of found) unique.set(`${item.text.toLowerCase()}|${item.resolved}`, item);
  return [...unique.values()].sort((a, b) => a.resolved.localeCompare(b.resolved)).slice(0, MAX_DATES);
}

/** The year a bare month/day refers to: the latest one not after the reference day. */
function nearestYear(month: number, day: number, reference: Date): number {
  const candidate = Date.UTC(reference.getUTCFullYear(), month, day);
  const referenceDay = dayStart(reference);
  return new Date(candidate > referenceDay ? Date.UTC(reference.getUTCFullYear() - 1, month, day) : candidate).getUTCFullYear();
}
