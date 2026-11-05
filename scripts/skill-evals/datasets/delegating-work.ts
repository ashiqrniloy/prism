// @ts-nocheck — evaluation script fixtures, not shipped; run by bun.
import { gradeAnswer } from "../lib.mjs";

export const skill = "delegating-work";
export const packageName = "@arnilo/prism-delegate";
export const version = "1";

const ANALYST = {
  description: "Works through data pasted into the brief and returns a short answer. It has no tools and sees nothing else.",
  instructions:
    "You answer strictly from the brief you were given. If the brief does not contain the data you need to answer, reply with exactly: MISSING DATA. Otherwise reply with a short answer.",
  inherit: [],
};

const ask = (task: string, data: string) => `Use the analyst child for this job; I want its answer. Task: ${task}\n\nData:\n${data}`;

const T = (id, task, data, mustContain, childAnswer, brief, extra = {}) => ({
  id,
  input: ask(task, data),
  kind: "trigger",
  grade: { answer: { mustContain, ...(extra.answer ?? {}) }, childOutput: { mustContain } },
  offline: { brief: `${task}\n\nData:\n${data}`, childAnswer, answer: childAnswer },
});
const N = (id, input, grade, answer) => ({ id, input, kind: "non_trigger", grade: { answer: grade }, offline: { answer } });

const LOG = ["10:01 INFO start", "10:02 ERROR disk full", "10:03 INFO retry", "10:04 ERROR timeout", "10:05 WARN slow", "10:06 ERROR timeout", "10:07 INFO ok", "10:08 ERROR auth failed", "10:09 INFO ok", "10:10 ERROR disk full"].join("\n");

export const items = [
  T("delegate-count-errors", "Count the ERROR lines in this log and reply with the number.", LOG, ["5"], "5"),
  T("delegate-sum-invoice", "Add up these invoice line amounts and reply with the total.", "120, 45, 310, 78, 22, 205, 64, 19", ["863"], "863"),
  T(
    "delegate-extract-emails",
    "List every email address in this text.",
    "Contact ana.lopez@corp.test for billing, devops@corp.test for outages, or pr-team@corp.test for press. Do not write to the noreply mailbox.",
    ["ana.lopez@corp.test", "devops@corp.test", "pr-team@corp.test"],
    "ana.lopez@corp.test, devops@corp.test, pr-team@corp.test",
  ),
  T(
    "delegate-diff-config",
    "Which keys have different values between config A and config B?",
    "A: timeout=30 retries=3 region=eu mode=fast\nB: timeout=30 retries=5 region=us mode=fast",
    ["retries", "region"],
    "retries and region",
  ),
  T("delegate-longest-word", "Which is the longest word in this sentence?", "The photosynthesizing botanist quietly catalogued unremarkable ferns", ["photosynthesizing"], "photosynthesizing"),
  T(
    "delegate-iso-dates",
    "Rewrite these dates in ISO 8601 (YYYY-MM-DD).",
    "3 March 2031, 14 July 2030, 29 December 2029",
    ["2031-03-03", "2030-07-14", "2029-12-29"],
    "2031-03-03, 2030-07-14, 2029-12-29",
  ),
  T(
    "delegate-classify-reviews",
    "Classify each review as positive or negative and reply with the number of positive ones.",
    "1. Loved it, works perfectly\n2. Broke after a week\n3. Fantastic value\n4. Would not recommend\n5. Exceeded my expectations\n6. Arrived late and damaged",
    ["3"],
    "3",
  ),
  T("delegate-average", "Compute the average of these test scores.", "72, 88, 95, 61, 84", ["80"], "80"),
  T(
    "delegate-find-bug",
    "Review these three functions and say which one returns a wrong result for the input [-3, -1, -2].",
    "function sum(a) { return a.reduce((s, x) => s + x, 0); }\nfunction mean(a) { return sum(a) / a.length; }\nfunction maxOf(a) { let m = 0; for (const x of a) if (x > m) m = x; return m; }",
    ["maxOf"],
    "maxOf",
  ),
  T(
    "delegate-cheapest-quote",
    "Which vendor is cheapest once shipping is included? Reply with the vendor name.",
    "Acme: $4,200 plus $300 shipping\nBirch: $3,900 plus $450 shipping\nCobalt: $4,050 plus $0 shipping",
    ["Cobalt"],
    "Cobalt",
  ),
  N("delegate-none-capital", "What is the capital of Japan?", { mustContain: ["Tokyo"] }, "Tokyo."),
  N("delegate-none-leap", "How many days does a leap year have?", { mustContain: ["366"] }, "366."),
  N("delegate-none-synonym", "Give me one synonym for the word quick.", { anyOf: ["fast", "rapid", "swift", "speedy", "brisk", "prompt"] }, "Fast."),
].map(({ id, input, kind, grade, offline }) => ({ id, input, tags: [kind], expected: { kind, grade, offline } }));

export function grade(expectedGrade, snapshot) {
  const checks = [];
  if (expectedGrade.answer) checks.push(...gradeAnswer(snapshot.answer, expectedGrade.answer).checks.map((check) => `answer: ${check}`));
  if (expectedGrade.childOutput) {
    const outputs = snapshot.delegateOutputs ?? [];
    if (outputs.length === 0) checks.push("the analyst child was never used");
    else if (!outputs.some((output) => gradeAnswer(output, expectedGrade.childOutput).pass)) checks.push("no child answer carried the result (the brief probably lacked the data)");
  }
  return { pass: checks.length === 0, reason: checks.length === 0 ? "state matches" : checks.join("; "), checks };
}

export async function createEnvironment({ item }) {
  const { default: delegate } = await import("@arnilo/prism-delegate");
  const { offline, kind } = item.expected;
  return {
    packages: [delegate({ children: { analyst: ANALYST } })],
    tools: [],
    skillDirs: [],
    offlineCalls: kind === "trigger" ? [{ tool: "delegate", args: { child: "analyst", input: offline.brief } }] : [],
    offlineChild: () => offline.childAnswer,
    snapshot: async (result, timeline) => ({
      answer: result?.text ?? "",
      delegateOutputs: (timeline?.steps ?? [])
        .filter((step) => step.kind === "tool" && (step.name === "delegate" || step.name === "delegate_wait") && step.status === "succeeded")
        .map((step) => (typeof step.output === "string" ? step.output : JSON.stringify(step.output ?? ""))),
    }),
    applyOffline: async () => offline.answer,
    dispose: async () => {},
  };
}
