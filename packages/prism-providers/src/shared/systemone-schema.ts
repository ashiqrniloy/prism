/**
 * Structured-output schema compiler and answer renderer for System One providers.
 *
 * Prism structured-output requests carry a JSON Schema; System One decision models answer
 * typed questions instead of text. This module translates in both directions: a schema into
 * `noul`/`choice`/`score` questions, and the model's answers back into a schema-valid JSON
 * object. Everything here is pure — no `fetch`, no provider constants — so both the TypeSafe
 * and Laya providers share it unchanged.
 *
 * Supported schema shapes (anything else is rejected before a request is sent):
 * - `{ "type": "boolean" }` → `noul`; instructions from `description`/`title`, falling back
 *   to the dotted field name; optional answer meanings via
 *   `"x-systemone": { "criteria": { "true": "...", "false": "..." } }`.
 * - `{ "enum": [...] }` of 2–255 strings or whole numbers → `choice`; per-option meanings via
 *   `"x-systemone": { "options": { "<option>": "<description> | null" } }`, otherwise the
 *   option itself.
 * - An integer enum of the contiguous levels `0..N` (2–10 levels) where every level has a
 *   description in `"x-systemone": { "levels": ["...", ...] }` (aligned with the declared
 *   `enum` order) → `score`; the rubric is ordered by level number, not declaration order.
 * - `{ "type": "object", "properties": { ... } }` → nested questions with dotted ids.
 *
 * The `x-typesafe` key is accepted as an alias for `x-systemone` so schemas written for
 * TypeSafe's own tooling compile unchanged.
 */

import type { JsonObject, JsonValue, Message } from "@arnilo/prism";
import { isJsonObject } from "@arnilo/prism";
import type { SystemOneAnswer, SystemOneChoiceQuestion, SystemOneNoulQuestion, SystemOneQuestion, SystemOneState } from "./systemone.js";

/** Choice questions accept at most this many options (System One API limit). */
export const MAX_SYSTEMONE_CHOICE_OPTIONS = 255;
/** Score rubrics accept at most this many levels (System One API limit). */
export const MAX_SYSTEMONE_SCORE_LEVELS = 10;
/** One request may carry at most this many questions. */
export const MAX_SYSTEMONE_QUESTIONS = 256;
/** Noul probabilities above this render as `true`. */
export const DEFAULT_SYSTEMONE_BOOLEAN_THRESHOLD = 0.5;

export type SystemOneSchemaErrorCode =
  | "invalid_schema"
  | "unsupported_field"
  | "empty_questions"
  | "too_many_questions"
  | "too_many_options"
  | "too_many_levels"
  | "invalid_threshold"
  | "missing_answer"
  | "invalid_answer";

/** A schema this compiler cannot express as System One questions, or an answer it cannot render. */
export class SystemOneSchemaError extends Error {
  readonly code: SystemOneSchemaErrorCode;
  readonly fieldPath: string;

  constructor(code: SystemOneSchemaErrorCode, fieldPath: string, message: string) {
    super(fieldPath ? `${message} [field: ${fieldPath}]` : message);
    this.name = "SystemOneSchemaError";
    this.code = code;
    this.fieldPath = fieldPath;
  }
}

const SUPPORTED_SHAPES =
  "supported shapes: boolean, enum of 2-255 strings or whole numbers, integer rubric 0..N with 2-10 described levels, nested object of these";

/**
 * Compiles a structured-output JSON Schema into System One questions keyed by dotted field
 * id. Throws {@link SystemOneSchemaError} naming the offending field for unsupported shapes,
 * empty schemas, and question sets beyond the API limits.
 */
export function compileSystemOneQuestions(schema: JsonObject): Readonly<Record<string, SystemOneQuestion>> {
  const questions: Record<string, SystemOneQuestion> = {};
  for (const field of compileSystemOneFields(schema)) questions[field.id] = field.question;
  return questions;
}

export interface SystemOneRenderOptions {
  /** Noul probability strictly above which the rendered boolean is `true`. Default 0.5. */
  readonly booleanThreshold?: number;
}

/**
 * Renders System One answers back into schema-valid JSON text. Every compiled question must
 * be answered; booleans round on `booleanThreshold`, choices map to the schema's own option
 * value (numbers stay numbers), scores round half up and clamp into the rubric.
 */
export function renderSystemOneOutput(
  answers: Readonly<Record<string, SystemOneAnswer>>,
  schema: JsonObject,
  options: SystemOneRenderOptions = {},
): string {
  const threshold = options.booleanThreshold ?? DEFAULT_SYSTEMONE_BOOLEAN_THRESHOLD;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new SystemOneSchemaError(
      "invalid_threshold",
      "booleanThreshold",
      `booleanThreshold must be between 0 and 1; received ${String(options.booleanThreshold)}`,
    );
  }
  const output: Record<string, JsonValue> = {};
  for (const field of compileSystemOneFields(schema)) {
    const answer = answers[field.id];
    if (!answer) throw new SystemOneSchemaError("missing_answer", field.id, `no answer for question "${field.id}"`);
    setFieldValue(output, field.id, renderAnswer(field, answer, threshold));
  }
  return JSON.stringify(output);
}

/**
 * Messages → System One `state`. Questions are never written here (a question in the state
 * is judged, not answered); only text content travels. A lone user text message becomes a
 * plain string, anything else a `{ role, text }` array with non-text parts dropped.
 */
export function compileSystemOneState(messages: readonly Message[]): SystemOneState {
  const entries: { role: Message["role"]; text: string }[] = [];
  for (const message of messages) {
    const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
    if (text) entries.push({ role: message.role, text });
  }
  if (entries.length === 0) return "";
  if (entries.length === 1 && entries[0].role === "user") return entries[0].text;
  return entries;
}

/** A compiled field keeps the wire question plus the schema details rendering needs. */
interface CompiledSystemOneField {
  readonly id: string;
  readonly question: SystemOneQuestion;
  /** `choice`: the schema's own option values; `score`: the ordered level numbers. */
  readonly enumValues?: readonly JsonValue[];
}

function compileSystemOneFields(schema: JsonObject): readonly CompiledSystemOneField[] {
  const fields: CompiledSystemOneField[] = [];
  collectFields(readProperties(schema, ""), "", fields);
  if (fields.length === 0) {
    throw new SystemOneSchemaError("empty_questions", "", "structured output schema has no fields a System One decision model can answer");
  }
  if (fields.length > MAX_SYSTEMONE_QUESTIONS) {
    throw new SystemOneSchemaError(
      "too_many_questions",
      "",
      `schema compiled to ${fields.length} questions; System One accepts at most ${MAX_SYSTEMONE_QUESTIONS}`,
    );
  }
  return fields;
}

function collectFields(properties: JsonObject, prefix: string, fields: CompiledSystemOneField[]): void {
  for (const [name, raw] of Object.entries(properties)) {
    const id = prefix ? `${prefix}.${name}` : name;
    if (name.includes(".")) throw unsupported(id, 'field names cannot contain "."');
    if (!isJsonObject(raw)) throw unsupported(id, "field schema is not a JSON object");
    if (raw.type === "boolean") {
      fields.push({ id, question: compileNoul(raw, id) });
      continue;
    }
    if (Array.isArray(raw.enum)) {
      fields.push(compileEnum(raw, id));
      continue;
    }
    if (raw.type === "object") {
      collectFields(readProperties(raw, id), id, fields);
      continue;
    }
    throw unsupported(id, `schema type ${JSON.stringify(raw.type)} is not a decision-model question`);
  }
}

function compileNoul(property: JsonObject, id: string): SystemOneNoulQuestion {
  const criteria = readBoolCriteria(property);
  return { type: "noul", instructions: readInstructions(property, id), ...(criteria ? { criteria } : {}) };
}

function compileEnum(property: JsonObject, id: string): CompiledSystemOneField {
  const values = property.enum as readonly JsonValue[];
  if (values.length < 2) throw unsupported(id, "enum needs at least 2 options");
  if (values.length > MAX_SYSTEMONE_CHOICE_OPTIONS) {
    throw new SystemOneSchemaError(
      "too_many_options",
      id,
      `choice field has ${values.length} options; System One accepts at most ${MAX_SYSTEMONE_CHOICE_OPTIONS}`,
    );
  }
  const extension = readExtension(property);
  const rubric = compileRubric(values, extension, property, id);
  if (rubric) return rubric;

  const options = readExtensionObject(extension, "options");
  const criteria: Record<string, string> = {};
  for (const value of values) {
    const key = String(value);
    const described = options?.[key];
    criteria[key] = typeof described === "string" ? described : key;
  }
  const question: SystemOneChoiceQuestion = { type: "choice", instructions: readInstructions(property, id), criteria };
  return { id, question, enumValues: values };
}

/** Integer enum of contiguous levels `0..N` with a description per level → score rubric. */
function compileRubric(
  values: readonly JsonValue[],
  extension: JsonObject | undefined,
  property: JsonObject,
  id: string,
): CompiledSystemOneField | undefined {
  const levels = readScoreLevels(extension, values.length);
  if (!levels || !isContiguousLevels(values)) return undefined;
  if (values.length > MAX_SYSTEMONE_SCORE_LEVELS) {
    throw new SystemOneSchemaError(
      "too_many_levels",
      id,
      `score field has ${values.length} described levels; System One accepts at most ${MAX_SYSTEMONE_SCORE_LEVELS}`,
    );
  }
  const descriptionByLevel = new Map<number, string>();
  values.forEach((value, index) => {
    descriptionByLevel.set(value as number, levels[index]);
  });
  const orderedLevels = (values as readonly number[]).slice().sort((a, b) => a - b);
  const question: SystemOneQuestion = {
    type: "score",
    instructions: readInstructions(property, id),
    criteria: orderedLevels.map((level) => descriptionByLevel.get(level) as string),
  };
  return { id, question, enumValues: orderedLevels };
}

function renderAnswer(field: CompiledSystemOneField, answer: SystemOneAnswer, threshold: number): JsonValue {
  const { question } = field;
  switch (question.type) {
    case "noul":
      if (answer.type !== "noul") throw answerTypeMismatch(field.id, question.type, answer.type);
      return answer.noul > threshold;
    case "choice": {
      if (answer.type !== "choice") throw answerTypeMismatch(field.id, question.type, answer.type);
      const match = field.enumValues?.find((value) => String(value) === answer.choice);
      if (match === undefined) {
        throw new SystemOneSchemaError("invalid_answer", field.id, `answer "${answer.choice}" is not an option of question "${field.id}"`);
      }
      return match;
    }
    case "score": {
      if (answer.type !== "score") throw answerTypeMismatch(field.id, question.type, answer.type);
      const maxLevel = (field.enumValues?.length ?? 1) - 1;
      return Math.min(maxLevel, Math.max(0, Math.round(answer.score)));
    }
  }
}

function setFieldValue(output: Record<string, JsonValue>, id: string, value: JsonValue): void {
  const segments = id.split(".");
  let node = output;
  for (const segment of segments.slice(0, -1)) {
    const existing = node[segment];
    if (isJsonObject(existing)) {
      node = existing as Record<string, JsonValue>;
    } else {
      const nested: Record<string, JsonValue> = {};
      node[segment] = nested;
      node = nested;
    }
  }
  node[segments[segments.length - 1]] = value;
}

function readProperties(schema: JsonObject, id: string): JsonObject {
  const properties = schema.properties;
  if (!isJsonObject(properties)) throw unsupported(id, 'object field has no "properties" object');
  return properties;
}

function readInstructions(property: JsonObject, id: string): string {
  if (typeof property.description === "string" && property.description.trim()) return property.description;
  if (typeof property.title === "string" && property.title.trim()) return property.title;
  return id;
}

function readExtension(property: JsonObject): JsonObject | undefined {
  for (const key of ["x-systemone", "x-typesafe"]) {
    const extension = property[key];
    if (isJsonObject(extension)) return extension;
  }
  return undefined;
}

function readExtensionObject(extension: JsonObject | undefined, key: string): JsonObject | undefined {
  if (!extension) return undefined;
  const value = extension[key];
  return isJsonObject(value) ? value : undefined;
}

function readBoolCriteria(property: JsonObject): { readonly true?: string; readonly false?: string } | undefined {
  const criteria = readExtensionObject(readExtension(property), "criteria");
  if (!criteria) return undefined;
  const result: { true?: string; false?: string } = {};
  if (typeof criteria.true === "string") result.true = criteria.true;
  if (typeof criteria.false === "string") result.false = criteria.false;
  return result.true || result.false ? result : undefined;
}

function readScoreLevels(extension: JsonObject | undefined, count: number): readonly string[] | undefined {
  if (!extension) return undefined;
  const levels = extension.levels;
  if (!Array.isArray(levels) || levels.length !== count) return undefined;
  return levels.every((level) => typeof level === "string") ? (levels as readonly string[]) : undefined;
}

function isContiguousLevels(values: readonly JsonValue[]): boolean {
  if (!values.every((value) => typeof value === "number" && Number.isInteger(value))) return false;
  const sorted = (values as readonly number[]).slice().sort((a, b) => a - b);
  return sorted.every((value, index) => value === index);
}

function unsupported(id: string, detail: string): SystemOneSchemaError {
  return new SystemOneSchemaError("unsupported_field", id, `unsupported schema field: ${detail} (${SUPPORTED_SHAPES})`);
}

function answerTypeMismatch(id: string, questionType: string, answerType: string): SystemOneSchemaError {
  return new SystemOneSchemaError("invalid_answer", id, `answer type "${answerType}" does not match question type "${questionType}"`);
}
