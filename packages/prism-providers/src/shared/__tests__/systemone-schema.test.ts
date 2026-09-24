import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { JsonObject, JsonValue, Message } from "@arnilo/prism";
import {
  compileSystemOneQuestions,
  compileSystemOneState,
  DEFAULT_SYSTEMONE_BOOLEAN_THRESHOLD,
  renderSystemOneOutput,
  SystemOneSchemaError,
} from "../systemone-schema.js";

function objectSchema(properties: JsonObject): JsonObject {
  return { type: "object", properties };
}

function message(role: Message["role"], content: Message["content"]): Message {
  return { role, content };
}

function assertSchemaError(fn: () => unknown, code: SystemOneSchemaError["code"], fieldPath: string): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof SystemOneSchemaError);
    assert.equal(error.code, code);
    assert.equal(error.fieldPath, fieldPath);
    return true;
  });
}

describe("@arnilo/prism-providers/shared (systemone-schema)", () => {
  it("compiles_enum_fields_to_choice_with_option_descriptions", () => {
    const questions = compileSystemOneQuestions(
      objectSchema({
        verdict: {
          type: "string",
          description: "How should this shell command be handled?",
          enum: ["run", "reject", "ask"],
          "x-systemone": { options: { run: "safe", reject: "destructive or secret-leaking" } },
        },
      }),
    );
    assert.deepEqual(questions.verdict, {
      type: "choice",
      instructions: "How should this shell command be handled?",
      criteria: { run: "safe", reject: "destructive or secret-leaking", ask: "ask" },
    });
  });

  it("compiles_boolean_fields_to_noul_with_instructions_and_criteria", () => {
    const questions = compileSystemOneQuestions(
      objectSchema({
        irreversible: { type: "boolean", description: "Would running this destroy data?" },
        settled: {
          type: "boolean",
          description: "Was a refund issued?",
          "x-systemone": { criteria: { true: "Money was returned.", false: "No refund was issued." } },
        },
        bare: { type: "boolean" },
      }),
    );
    assert.deepEqual(questions.irreversible, { type: "noul", instructions: "Would running this destroy data?" });
    assert.deepEqual(questions.settled, {
      type: "noul",
      instructions: "Was a refund issued?",
      criteria: { true: "Money was returned.", false: "No refund was issued." },
    });
    assert.deepEqual(questions.bare, { type: "noul", instructions: "bare" }, "field name is enough to ask about");
  });

  it("accepts_the_x_typesafe_extension_alias", () => {
    const questions = compileSystemOneQuestions(
      objectSchema({ settled: { type: "boolean", "x-typesafe": { criteria: { true: "yes", false: "no" } } } }),
    );
    assert.deepEqual(questions.settled, { type: "noul", instructions: "settled", criteria: { true: "yes", false: "no" } });
  });

  it("compiles_described_contiguous_integer_enums_to_scores_ordered_by_level", () => {
    const questions = compileSystemOneQuestions(
      objectSchema({
        clarity: {
          type: "integer",
          description: "How clearly does this explain the change?",
          enum: [2, 0, 1],
          "x-systemone": { levels: ["actionable", "opaque", "partial"] },
        },
      }),
    );
    assert.deepEqual(questions.clarity, {
      type: "score",
      instructions: "How clearly does this explain the change?",
      criteria: ["opaque", "partial", "actionable"],
    });
  });

  it("rejects_described_rubrics_beyond_ten_levels_and_keeps_undescribed_enums_as_choices", () => {
    const levels = Array.from({ length: 11 }, (_, index) => `level ${index}`);
    const described = levels.map((_, index) => index);
    assertSchemaError(
      () => compileSystemOneQuestions(objectSchema({ rating: { type: "integer", enum: described, "x-systemone": { levels } } })),
      "too_many_levels",
      "rating",
    );
    const questions = compileSystemOneQuestions(objectSchema({ rating: { type: "integer", enum: described } }));
    assert.equal(questions.rating.type, "choice", "undescribed whole numbers are labels, not rubric levels");
  });

  it("flattens_nested_objects_with_dotted_ids_and_reassembles_on_render", () => {
    const schema = objectSchema({
      ticket: {
        type: "object",
        description: "not sent as instructions",
        properties: {
          urgent: { type: "boolean", description: "Does this need a reply within the hour?" },
          area: { type: "string", enum: ["billing", "bug"], "x-systemone": { options: { billing: "Money issues." } } },
        },
      },
    });
    const questions = compileSystemOneQuestions(schema);
    assert.deepEqual(questions["ticket.urgent"], { type: "noul", instructions: "Does this need a reply within the hour?" });
    assert.deepEqual(questions["ticket.area"], {
      type: "choice",
      instructions: "ticket.area",
      criteria: { billing: "Money issues.", bug: "bug" },
    });
    const text = renderSystemOneOutput(
      { "ticket.urgent": { type: "noul", noul: 0.8 }, "ticket.area": { type: "choice", choice: "billing" } },
      schema,
    );
    assert.deepEqual(JSON.parse(text), { ticket: { urgent: true, area: "billing" } });
  });

  it("rejects_unsupported_field_shapes_naming_the_field_path", () => {
    const cases: readonly (readonly [string, JsonObject])[] = [
      ["note", { type: "string" }],
      ["probability", { type: "number", minimum: 0, maximum: 1 }],
      ["tags", { type: "array", items: { type: "string" } }],
      ["either", { anyOf: [{ type: "boolean" }] }],
      ["free", { type: "integer" }],
      ["one", { type: "string", enum: ["only"] }],
    ];
    for (const [id, field] of cases) {
      assert.throws(
        () => compileSystemOneQuestions(objectSchema({ [id]: field })),
        (error: unknown) => {
          assert.ok(error instanceof SystemOneSchemaError, `${id} rejected`);
          assert.equal(error.code, "unsupported_field");
          assert.equal(error.fieldPath, id);
          assert.match(error.message, /supported shapes/);
          return true;
        },
        `rejects ${id}`,
      );
    }
    assertSchemaError(
      () =>
        compileSystemOneQuestions(
          objectSchema({ outer: { type: "object", properties: { inner: { type: "array", items: { type: "string" } } } } }),
        ),
      "unsupported_field",
      "outer.inner",
    );
  });

  it("rejects_empty_schemas_and_oversized_question_sets", () => {
    assertSchemaError(() => compileSystemOneQuestions(objectSchema({})), "empty_questions", "");
    const properties: Record<string, JsonValue> = {};
    for (let index = 0; index < 257; index += 1) properties[`q${index}`] = { type: "boolean", description: `question ${index}` };
    assertSchemaError(() => compileSystemOneQuestions(objectSchema(properties)), "too_many_questions", "");
  });

  it("rejects_choice_fields_beyond_255_options", () => {
    const options = Array.from({ length: 256 }, (_, index) => `option ${index}`);
    assertSchemaError(
      () => compileSystemOneQuestions(objectSchema({ pick: { type: "string", enum: options } })),
      "too_many_options",
      "pick",
    );
  });

  it("renders_booleans_against_the_threshold", () => {
    const schema = objectSchema({ flag: { type: "boolean", description: "Is it?" } });
    const render = (noul: number, booleanThreshold?: number) =>
      JSON.parse(renderSystemOneOutput({ flag: { type: "noul", noul } }, schema, { booleanThreshold })).flag as boolean;
    assert.equal(DEFAULT_SYSTEMONE_BOOLEAN_THRESHOLD, 0.5);
    assert.equal(render(0.49), false);
    assert.equal(render(0.5), false, "the threshold itself stays false");
    assert.equal(render(0.51), true);
    assert.equal(render(0.9, 0.9), false);
    assert.equal(render(0.91, 0.9), true);
    assertSchemaError(() => render(0.5, 1.5), "invalid_threshold", "booleanThreshold");
  });

  it("renders_scores_rounded_half_up_and_clamped_into_the_rubric", () => {
    const schema = objectSchema({
      clarity: { type: "integer", enum: [0, 1, 2], "x-systemone": { levels: ["opaque", "partial", "actionable"] } },
    });
    const render = (score: number) => JSON.parse(renderSystemOneOutput({ clarity: { type: "score", score } }, schema)).clarity as number;
    assert.equal(render(1.5), 2, "a half rounds up");
    assert.equal(render(-0.4), 0);
    assert.equal(render(2.6), 2);
  });

  it("renders_choice_answers_as_the_schemas_own_option_values", () => {
    const schema = objectSchema({ status: { type: "integer", enum: [200, 404, 500] } });
    const parsed = JSON.parse(renderSystemOneOutput({ status: { type: "choice", choice: "404" } }, schema));
    assert.equal(parsed.status, 404);
    assert.equal(typeof parsed.status, "number", "whole-number options stay numbers");
    assertSchemaError(() => renderSystemOneOutput({ status: { type: "choice", choice: "418" } }, schema), "invalid_answer", "status");
    assertSchemaError(() => renderSystemOneOutput({ status: { type: "noul", noul: 0.9 } }, schema), "invalid_answer", "status");
  });

  it("renders_output_that_validates_against_the_input_schema", () => {
    const schema = objectSchema({
      verdict: { type: "string", enum: ["run", "reject", "ask"] },
      irreversible: { type: "boolean", description: "Would running this destroy data?" },
      ticket: {
        type: "object",
        properties: {
          urgent: { type: "boolean", description: "Does this need a reply within the hour?" },
          code: { type: "integer", enum: [200, 404, 500] },
        },
      },
    });
    const parsed = JSON.parse(
      renderSystemOneOutput(
        {
          verdict: { type: "choice", choice: "ask" },
          irreversible: { type: "noul", noul: 0.91 },
          "ticket.urgent": { type: "noul", noul: 0.2 },
          "ticket.code": { type: "choice", choice: "404" },
        },
        schema,
      ),
    );
    assert.ok(["run", "reject", "ask"].includes(parsed.verdict), "enum membership");
    assert.equal(typeof parsed.irreversible, "boolean");
    assert.equal(typeof parsed.ticket, "object");
    assert.equal(typeof parsed.ticket.urgent, "boolean");
    assert.ok([200, 404, 500].includes(parsed.ticket.code), "integer enum membership");
    assert.equal(typeof parsed.ticket.code, "number");
  });

  it("rejects_rendering_when_an_answer_is_missing", () => {
    const schema = objectSchema({
      flag: { type: "boolean", description: "Is it?" },
      verdict: { type: "string", enum: ["run", "reject"] },
    });
    assertSchemaError(() => renderSystemOneOutput({ flag: { type: "noul", noul: 0.9 } }, schema), "missing_answer", "verdict");
  });

  it("compiles_state_from_text_content_only", () => {
    assert.equal(compileSystemOneState([message("user", [{ type: "text", text: "rm -rf ./build" }])]), "rm -rf ./build");
    assert.equal(compileSystemOneState([]), "");
    assert.deepEqual(
      compileSystemOneState([
        message("system", [{ type: "text", text: "You judge shell commands." }]),
        message("user", [{ type: "text", text: "rm -rf ./build" }]),
        message("assistant", [{ type: "image" }, { type: "text", text: "seen" }]),
        message("tool", [{ type: "image" }]),
      ]),
      [
        { role: "system", text: "You judge shell commands." },
        { role: "user", text: "rm -rf ./build" },
        { role: "assistant", text: "seen" },
      ],
      "non-text parts are dropped, not sent as state",
    );
  });
});
