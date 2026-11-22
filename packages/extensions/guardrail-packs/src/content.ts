/**
 * Content-stage rules (plan 237 Task 2): `input` on `run.input`, `output` on `model.response`, and
 * `tool_result` on `tool.result`. A rule matches a pattern or a named detector across the item's text
 * and can `deny`, `redact`, or `flag`. Every stage shares one routine (`applyContentRules`); records
 * carry rule ids and counts, never the matched text.
 */
import {
  type ContentBlock,
  type GuardrailRecord,
  type GuardrailRecordStage,
  guardrailRefusalText,
  type HookContext,
  type JsonValue,
  type Message,
  type PackageAPI,
  type ToolResult,
  UNTRUSTED_EXTERNAL_TRUST,
} from "@arnilo/prism";
import type { GuardrailRule, GuardrailRuleStage } from "./contracts.js";
import { CONTENT_DETECTOR_IDS, CONTENT_DETECTORS, type ContentDetector } from "./detectors/index.js";
import { type JudgeRunner, type JudgeVerdict, type ResolvedJudge, resolveJudge } from "./judge.js";
import { GuardrailPackError } from "./packs/errors.js";

/** Content transforms run before every priority-0 handler on the same hook, whatever the load order. */
export const GUARDRAIL_CONTENT_PRIORITY = 10_000;
/** Default characters scanned per item (one run input, one assistant message, or one tool result). */
export const DEFAULT_MAX_SCAN_CHARS = 256 * 1024;

export type ContentStage = Exclude<GuardrailRuleStage, "tool_call">;
export type ContentAction = "deny" | "redact" | "flag";

const MAX_DETECTORS_PER_RULE = 16;
const MAX_ALSO_SCAN_TOOLS = 16;
const MAX_PATTERN_BYTES = 4 * 1024;
const MAX_VALUE_SCAN_DEPTH = 8;
const MAX_VALUE_SCAN_STRINGS = 4096;
const MAX_TRACKED_RUNS = 1024;

const RECORD_STAGE: Readonly<Record<ContentStage, GuardrailRecordStage>> = {
  input: "input",
  output: "output",
  tool_result: "tool_output",
};

/** A compiled content rule. Matchers are global regexes, used synchronously, so a shared `lastIndex` is safe. */
export interface ContentRule {
  readonly packId: string;
  readonly ruleId: string;
  readonly name: string;
  readonly stage: ContentStage;
  readonly action: ContentAction;
  readonly reason: string;
  readonly marker: string;
  readonly matchers: readonly ContentDetector[];
  readonly tools?: readonly string[];
  readonly untrustedOnly: boolean;
  readonly alsoScanTools?: readonly string[];
  /** A model-judged rule (plan 237 Task 3): no matchers, one judge call per item. */
  readonly judge?: ResolvedJudge;
}

export function isContentStage(stage: unknown): stage is ContentStage {
  return stage === "input" || stage === "output" || stage === "tool_result";
}

/** Validates a content-stage rule (fail closed). `name` is the `pack:<pack>/<rule>` identity. */
export function resolveContentRule(
  packId: string,
  rule: GuardrailRule,
  stage: ContentStage,
  name: string,
  reason: string,
  tools: readonly string[] | undefined,
): ContentRule {
  const where = `guardrail pack "${packId}" rule "${rule.id}"`;
  const action = rule.action ?? "deny";
  if (action !== "deny" && action !== "redact" && action !== "flag") {
    throw new GuardrailPackError(`${where} on stage "${stage}" action must be "deny", "redact", or "flag" ("${action}" is tool_call only)`);
  }
  if (rule.deny !== undefined) throw new GuardrailPackError(`${where} on stage "${stage}" cannot use a "deny" predicate`);
  if (rule.argPath !== undefined) throw new GuardrailPackError(`${where} on stage "${stage}" cannot use "argPath"`);
  if (tools !== undefined && stage !== "tool_result")
    throw new GuardrailPackError(`${where} "tool" applies to tool_call and tool_result only`);
  const hasPattern = rule.pattern !== undefined;
  const hasDetector = rule.detector !== undefined;
  const hasJudge = rule.judge !== undefined;
  if (Number(hasPattern) + Number(hasDetector) + Number(hasJudge) !== 1) {
    throw new GuardrailPackError(`${where} requires exactly one of "pattern", "detector", or "judge"`);
  }
  if (hasJudge && action === "redact") {
    throw new GuardrailPackError(`${where} judge rule action must be "deny" or "flag": a judge finds no span to redact`);
  }
  const judge = hasJudge ? resolveJudge(where, rule.judge) : undefined;
  const matchers = hasJudge
    ? []
    : hasPattern
      ? [patternMatcher(where, rule.pattern as string | RegExp)]
      : detectorMatchers(where, rule.detector);
  if (rule.untrustedOnly !== undefined && typeof rule.untrustedOnly !== "boolean") {
    throw new GuardrailPackError(`${where} untrustedOnly must be a boolean`);
  }
  const untrustedOnly = rule.untrustedOnly === true;
  if (untrustedOnly && stage !== "tool_result") throw new GuardrailPackError(`${where} "untrustedOnly" applies to tool_result only`);
  let alsoScanTools: readonly string[] | undefined;
  if (rule.alsoScanTools !== undefined) {
    if (!untrustedOnly) throw new GuardrailPackError(`${where} "alsoScanTools" requires "untrustedOnly"`);
    const list = rule.alsoScanTools;
    if (
      !Array.isArray(list) ||
      list.length > MAX_ALSO_SCAN_TOOLS ||
      list.some((tool: unknown) => typeof tool !== "string" || !tool.trim())
    ) {
      throw new GuardrailPackError(`${where} alsoScanTools must be an array of at most ${MAX_ALSO_SCAN_TOOLS} tool names`);
    }
    alsoScanTools = [...list];
  }
  return {
    packId,
    ruleId: rule.id,
    name,
    stage,
    action,
    reason,
    marker: `[redacted:${rule.id}]`,
    matchers,
    untrustedOnly,
    ...(tools ? { tools } : {}),
    ...(alsoScanTools ? { alsoScanTools } : {}),
    ...(judge ? { judge } : {}),
  };
}

function patternMatcher(where: string, pattern: string | RegExp): ContentDetector {
  if (pattern instanceof RegExp) return { id: "pattern", pattern: new RegExp(pattern.source, `${pattern.flags.replace(/[gy]/g, "")}g`) };
  if (typeof pattern !== "string" || !pattern) throw new GuardrailPackError(`${where} pattern must be a non-empty string or RegExp`);
  if (new TextEncoder().encode(pattern).length > MAX_PATTERN_BYTES) {
    throw new GuardrailPackError(`${where} pattern exceeds ${MAX_PATTERN_BYTES} bytes`);
  }
  try {
    // `redact` needs a global copy; `compileRulePattern` strips `g` for tool-call rules.
    return { id: "pattern", pattern: new RegExp(pattern, "g") };
  } catch (error) {
    throw new GuardrailPackError(`${where} has an invalid pattern`, { cause: error });
  }
}

function detectorMatchers(where: string, detector: unknown): readonly ContentDetector[] {
  const names = typeof detector === "string" ? [detector] : detector;
  if (!Array.isArray(names) || names.length === 0 || names.length > MAX_DETECTORS_PER_RULE) {
    throw new GuardrailPackError(`${where} detector must be a detector name or a non-empty array of at most ${MAX_DETECTORS_PER_RULE}`);
  }
  return names.map((name: unknown) => {
    const found = typeof name === "string" ? CONTENT_DETECTORS.get(name) : undefined;
    if (!found) {
      throw new GuardrailPackError(
        `${where} names unknown detector "${String(name)}"; known detectors: ${CONTENT_DETECTOR_IDS.join(", ")}`,
      );
    }
    // A private copy per rule: `lastIndex` is per-RegExp state.
    return { ...found, pattern: new RegExp(found.pattern.source, found.pattern.flags) };
  });
}

/** One fired rule on one item. */
export interface ContentHit {
  readonly rule: ContentRule;
  readonly count: number;
  readonly truncated: boolean;
  /** What was applied, when not the rule's action: a judge failure under `onError: "allow"` is `allow`. */
  readonly outcome?: ContentAction | "allow";
  /** A judge rule's answer: never the raw reply, never the content. */
  readonly judge?: Pick<JudgeVerdict, "path" | "probability" | "error">;
}

export interface ContentScanResult {
  /** The item's texts after redaction (same length and order as the input). */
  readonly texts: readonly string[];
  readonly changed: boolean;
  readonly hits: readonly ContentHit[];
  /** The first `deny` rule that matched; nothing else is applied when set. */
  readonly denied?: ContentHit;
}

/**
 * The shared "apply rules to text" routine. Scans at most `maxChars` characters across `texts` (the
 * rest passes through untouched, and every hit says `truncated`). `deny` rules run first on the
 * original text, then `flag` rules, then `redact` rules in order.
 */
export function applyContentRules(rules: readonly ContentRule[], texts: readonly string[], maxChars: number): ContentScanResult {
  const scanned: string[] = [];
  const tails: string[] = [];
  let remaining = maxChars;
  let truncated = false;
  for (const text of texts) {
    const take = Math.min(text.length, remaining);
    scanned.push(text.slice(0, take));
    tails.push(text.slice(take));
    if (take < text.length) truncated = true;
    remaining -= take;
  }
  const hits: ContentHit[] = [];
  for (const rule of rules) {
    if (rule.action !== "deny") continue;
    const count = countAll(rule, scanned);
    if (count > 0) return { texts, changed: false, hits: [{ rule, count, truncated }], denied: { rule, count, truncated } };
  }
  for (const rule of rules) {
    if (rule.action !== "flag") continue;
    const count = countAll(rule, scanned);
    if (count > 0) hits.push({ rule, count, truncated });
  }
  let changed = false;
  for (const rule of rules) {
    if (rule.action !== "redact") continue;
    let count = 0;
    for (let index = 0; index < scanned.length; index += 1) {
      let text = scanned[index] ?? "";
      for (const matcher of rule.matchers) {
        text = text.replace(matcher.pattern, (match) => {
          if (match.length === 0 || (matcher.accept && !matcher.accept(match))) return match;
          count += 1;
          return rule.marker;
        });
      }
      scanned[index] = text;
    }
    if (count > 0) {
      changed = true;
      hits.push({ rule, count, truncated });
    }
  }
  return { texts: changed ? scanned.map((text, index) => text + (tails[index] ?? "")) : texts, changed, hits };
}

function countAll(rule: ContentRule, texts: readonly string[]): number {
  let count = 0;
  for (const text of texts) {
    if (!text) continue;
    for (const matcher of rule.matchers) {
      const regex = matcher.pattern;
      regex.lastIndex = 0;
      for (let match = regex.exec(text); match !== null; match = regex.exec(text)) {
        if (match[0].length === 0) {
          regex.lastIndex += 1;
          continue;
        }
        if (!matcher.accept || matcher.accept(match[0])) count += 1;
      }
    }
  }
  return count;
}

function hitRecord(hit: ContentHit, version: number): GuardrailRecord {
  const { rule } = hit;
  const outcome = hit.outcome ?? rule.action;
  return {
    guardrail: rule.name,
    stage: RECORD_STAGE[rule.stage],
    // A `redact` or `flag` must not read as a denial in the timeline or the `guardrail_pack` scorer.
    action: outcome === "deny" ? "block" : "allow",
    reason: rule.reason,
    metadata: {
      pack: rule.packId,
      rule: rule.ruleId,
      version,
      outcome,
      count: hit.count,
      ...(hit.truncated ? { truncated: true } : {}),
      ...(hit.judge
        ? {
            judge: {
              path: hit.judge.path,
              ...(hit.judge.probability !== undefined ? { probability: hit.judge.probability } : {}),
              ...(hit.judge.error !== undefined ? { error: hit.judge.error } : {}),
            },
          }
        : {}),
    },
  };
}

/** Judge rules' hits on one item, all asked in parallel; the first `deny` (in rule order) wins. */
async function judgeItem(
  runner: JudgeRunner | undefined,
  rules: readonly ContentRule[],
  texts: readonly string[],
  context: HookContext,
): Promise<{ readonly hits: readonly ContentHit[]; readonly denied?: ContentHit }> {
  const judged = rules.flatMap((rule) => (rule.judge ? [{ rule, judge: rule.judge }] : []));
  if (!runner || judged.length === 0) return { hits: [] };
  const text = texts.filter(Boolean).join("\n");
  if (!text) return { hits: [] };
  const verdicts = await Promise.all(
    judged.map(({ rule, judge }) =>
      runner.judge({
        judge,
        ruleName: rule.name,
        stage: rule.stage,
        text,
        runId: context.runId,
        ...(context.session ? { session: context.session } : {}),
        signal: context.signal,
      }),
    ),
  );
  const hits: ContentHit[] = [];
  let denied: ContentHit | undefined;
  verdicts.forEach((verdict, index) => {
    const { rule, judge: config } = judged[index] ?? {};
    if (!rule || !config || verdict.answer === "no") return;
    const judge = {
      path: verdict.path,
      ...(verdict.probability !== undefined ? { probability: verdict.probability } : {}),
      ...(verdict.error !== undefined ? { error: verdict.error } : {}),
    };
    const outcome: ContentHit["outcome"] = verdict.answer === "yes" ? rule.action : config.onError === "deny" ? "deny" : "allow";
    const hit: ContentHit = { rule, count: 1, truncated: verdict.truncated, outcome, judge };
    hits.push(hit);
    if (outcome === "deny" && !denied) denied = hit;
  });
  return denied ? { hits, denied } : { hits };
}

function emitHits(
  context: HookContext,
  hits: readonly ContentHit[],
  versions: ReadonlyMap<string, number>,
  tool?: { readonly toolCallId: string; readonly toolName: string },
): void {
  for (const hit of hits) {
    const record = hitRecord(hit, versions.get(hit.rule.packId) ?? 1);
    context.emit("guardrail.decision", { ...(tool ?? {}), record } as unknown as JsonValue);
  }
}

function refusal(hit: ContentHit, versions: ReadonlyMap<string, number>): string {
  const record = hitRecord(hit, versions.get(hit.rule.packId) ?? 1);
  return guardrailRefusalText(record) ?? `Blocked by guardrail rule ${hit.rule.name}`;
}

// --- per-stage text extraction ---------------------------------------------------------------

function messageTexts(messages: readonly Message[]): string[] {
  const texts: string[] = [];
  for (const message of messages) for (const block of message.content) if (block.type === "text") texts.push(block.text);
  return texts;
}

function rebuildMessages(messages: readonly Message[], texts: readonly string[]): Message[] {
  let cursor = 0;
  return messages.map((message) => {
    if (!message.content.some((block) => block.type === "text")) return message;
    const content = message.content.map(
      (block): ContentBlock => (block.type === "text" ? { ...block, text: texts[cursor++] ?? "" } : block),
    );
    return { ...message, content };
  });
}

interface ValueWalk {
  readonly out: string[];
  truncated: boolean;
}

function collectValueStrings(value: unknown, walk: ValueWalk, depth: number): void {
  if (depth > MAX_VALUE_SCAN_DEPTH) {
    if (value !== null && typeof value === "object") walk.truncated = true;
    else if (typeof value === "string") walk.truncated = true;
    return;
  }
  if (typeof value === "string") {
    if (walk.out.length >= MAX_VALUE_SCAN_STRINGS) {
      walk.truncated = true;
      return;
    }
    walk.out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectValueStrings(item, walk, depth + 1);
    return;
  }
  if (value && typeof value === "object") for (const item of Object.values(value)) collectValueStrings(item, walk, depth + 1);
}

/** Rebuilds `value` in the same traversal order as `collectValueStrings`, swapping in `texts`. */
function rebuildValue(value: unknown, texts: readonly string[], cursor: { index: number }, depth: number): unknown {
  if (depth > MAX_VALUE_SCAN_DEPTH) return value;
  if (typeof value === "string") {
    if (cursor.index >= texts.length) return value;
    return texts[cursor.index++];
  }
  if (Array.isArray(value)) return value.map((item) => rebuildValue(item, texts, cursor, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = rebuildValue(item, texts, cursor, depth + 1);
    return out;
  }
  return value;
}

function ruleAppliesToResult(rule: ContentRule, result: ToolResult): boolean {
  if (rule.tools && !rule.tools.includes(result.name)) return false;
  if (!rule.untrustedOnly) return true;
  return result.metadata?.trust === UNTRUSTED_EXTERNAL_TRUST || (rule.alsoScanTools?.includes(result.name) ?? false);
}

// --- hook installation -----------------------------------------------------------------------

export interface ContentInstallOptions {
  readonly rules: readonly ContentRule[];
  /** Required when a rule has `judge`. */
  readonly judge?: JudgeRunner;
  /** Pack id → pack version, for records. */
  readonly versions: ReadonlyMap<string, number>;
  readonly maxScanChars: number;
}

/** Registers one transform per content stage a configured rule uses; nothing for unused stages. */
export function installContentStages(prism: PackageAPI<unknown>, options: ContentInstallOptions): void {
  const { versions, maxScanChars, judge } = options;
  const byStage = (stage: ContentStage) => options.rules.filter((rule) => rule.stage === stage);
  const patternRules = (rules: readonly ContentRule[]) => rules.filter((rule) => rule.judge === undefined);
  const judgeRules = (rules: readonly ContentRule[]) => rules.filter((rule) => rule.judge !== undefined);
  const priority = { priority: GUARDRAIL_CONTENT_PRIORITY };
  if (judge && options.rules.some((rule) => rule.judge)) {
    const forgetJudged = (_event: unknown, context: HookContext) => judge.forgetRun(context.runId);
    prism.hooks.on("run.completed", forgetJudged);
    prism.hooks.on("run.failed", forgetJudged);
    prism.hooks.on("run.suspended", forgetJudged);
  }

  const inputRules = byStage("input");
  if (inputRules.length > 0) {
    // The first `run.input` call for a run is its run-start input; later calls are steers. A reject at
    // run start fails the run; a reject on a steer would also fail it, so a denied steer is dropped (`[]`).
    const started = new Set<string>();
    const forget = (_event: unknown, context: HookContext) => void started.delete(context.runId);
    prism.hooks.on(
      "run.input",
      async (messages: readonly Message[], context: HookContext) => {
        const steer = started.has(context.runId);
        if (!steer) {
          if (started.size >= MAX_TRACKED_RUNS) {
            const oldest = started.values().next().value;
            if (oldest !== undefined) started.delete(oldest);
          }
          started.add(context.runId);
        }
        const texts = messageTexts(messages);
        if (texts.length === 0) return undefined;
        const scan = applyContentRules(patternRules(inputRules), texts, maxScanChars);
        if (scan.denied) {
          emitHits(context, [scan.denied], versions);
          return steer ? [] : context.reject(refusal(scan.denied, versions));
        }
        // The judge sees the item after redaction, so a redacted span never reaches the judge model.
        const judged = await judgeItem(judge, judgeRules(inputRules), scan.texts, context);
        emitHits(context, [...scan.hits, ...judged.hits], versions);
        if (judged.denied) return steer ? [] : context.reject(refusal(judged.denied, versions));
        return scan.changed ? rebuildMessages(messages, scan.texts) : undefined;
      },
      priority,
    );
    prism.hooks.on("run.completed", forget);
    prism.hooks.on("run.failed", forget);
    prism.hooks.on("run.suspended", forget);
  }

  const outputRules = byStage("output");
  if (outputRules.length > 0) {
    prism.hooks.on(
      "model.response",
      async (message: Message, context: HookContext) => {
        // Text blocks only: tool dispatch reads the provider's calls, not this message, so a rewritten
        // `tool_call` block would only make the transcript disagree with what ran.
        const texts = messageTexts([message]);
        if (texts.length === 0) return undefined;
        const scan = applyContentRules(patternRules(outputRules), texts, maxScanChars);
        if (scan.denied) {
          emitHits(context, [scan.denied], versions);
          return context.reject(refusal(scan.denied, versions));
        }
        const judged = await judgeItem(judge, judgeRules(outputRules), scan.texts, context);
        emitHits(context, [...scan.hits, ...judged.hits], versions);
        if (judged.denied) return context.reject(refusal(judged.denied, versions));
        return scan.changed ? rebuildMessages([message], scan.texts)[0] : undefined;
      },
      priority,
    );
  }

  const resultRules = byStage("tool_result");
  if (resultRules.length > 0) {
    prism.hooks.on(
      "tool.result",
      async (result: ToolResult & { readonly sessionId?: string; readonly runId?: string }, context: HookContext) => {
        const rules = resultRules.filter((rule) => ruleAppliesToResult(rule, result));
        if (rules.length === 0) return undefined;
        // The same body the untrusted envelope is built from: text content blocks and `value` strings.
        const blockTexts: string[] = [];
        for (const block of result.content ?? []) if (block.type === "text") blockTexts.push(block.text);
        const walk: ValueWalk = { out: [], truncated: false };
        collectValueStrings(result.value, walk, 0);
        const texts = [...blockTexts, ...walk.out];
        if (texts.length === 0) return undefined;
        const scan = applyContentRules(patternRules(rules), texts, maxScanChars);
        const markTruncated = (hit: ContentHit): ContentHit => (walk.truncated && !hit.truncated ? { ...hit, truncated: true } : hit);
        const tool = { toolCallId: result.toolCallId, toolName: result.name };
        const judged = scan.denied ? { hits: [] } : await judgeItem(judge, judgeRules(rules), scan.texts, context);
        const denied = scan.denied ?? ("denied" in judged ? judged.denied : undefined);
        if (denied) {
          const hit = markTruncated(denied);
          if (!scan.denied)
            emitHits(context, [...scan.hits, ...judged.hits.filter((entry) => entry !== denied)].map(markTruncated), versions, tool);
          emitHits(context, [hit], versions, tool);
          // Never reject: a `tool.result` reject fails the whole run. The call becomes an error result.
          return {
            toolCallId: result.toolCallId,
            name: result.name,
            ...(result.metadata !== undefined ? { metadata: result.metadata } : {}),
            error: { code: "guardrail_denied", message: refusal(hit, versions) },
          } satisfies ToolResult;
        }
        emitHits(context, [...scan.hits, ...judged.hits].map(markTruncated), versions, tool);
        if (!scan.changed) return undefined;
        let cursor = 0;
        const content = result.content?.map(
          (block): ContentBlock => (block.type === "text" ? { ...block, text: scan.texts[cursor++] ?? "" } : block),
        );
        const value = rebuildValue(result.value, scan.texts.slice(blockTexts.length), { index: 0 }, 0);
        return {
          ...result,
          ...(result.content !== undefined ? { content } : {}),
          ...(result.value !== undefined ? { value } : {}),
        };
      },
      priority,
    );
  }
}
