/**
 * The one text normaliser short-term memory shares: event descriptions are stored in this form, and
 * de-duplication and habituation (plan 217 Task 3) compare in it.
 */
export function normalizeEventText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
