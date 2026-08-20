import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AntigravityStreamError,
  NdjsonParser,
  NdjsonStreamValidator,
  parseSingleRecord,
  resolveRunnerLimits,
  safeUsage,
} from "../index.js";

test("safeUsage: normalizes snake_case and camelCase token counters", () => {
  assert.equal(safeUsage(null), undefined);
  assert.equal(safeUsage("string"), undefined);
  assert.equal(safeUsage([]), undefined);
  assert.equal(safeUsage({}), undefined);

  const usage1 = safeUsage({
    input_tokens: 100,
    output_tokens: 25,
    thinking_tokens: 10,
    cache_read_tokens: 5,
    cache_write_tokens: 2,
    total_tokens: 142,
  });

  assert.deepEqual(usage1, {
    inputTokens: 100,
    outputTokens: 25,
    thinkingTokens: 10,
    cacheReadTokens: 5,
    cacheWriteTokens: 2,
    totalTokens: 142,
  });

  const usage2 = safeUsage({
    inputTokens: 50,
    outputTokens: 10,
    totalTokens: 60,
    invalidKey: -5,
  });

  assert.deepEqual(usage2, {
    inputTokens: 50,
    outputTokens: 10,
    totalTokens: 60,
  });
});

test("parseSingleRecord: parses direct and wrapped event shapes", () => {
  // Direct shape
  const directInit = parseSingleRecord('{"type":"init","cwd":"/workspace","tools":["prism_echo"]}');
  assert.equal(directInit.type, "init");
  assert.equal(directInit.cwd, "/workspace");
  assert.deepEqual((directInit as { tools?: string[] }).tools, ["prism_echo"]);

  // Wrapped shape
  const wrappedStep = parseSingleRecord(
    '{"event":"step_update","step_update":{"conversation_id":"c1","step_index":0,"state":"DONE","step_type":"tool","tool_info":{"name":"prism_echo"}}}',
  );
  assert.equal(wrappedStep.type, "step_update");
  assert.equal(wrappedStep.conversation_id, "c1");
  assert.equal((wrappedStep as { step_index?: number }).step_index, 0);

  // Result shape
  const result = parseSingleRecord(
    '{"type":"result","status":"SUCCESS","conversation_id":"c1","response":"Task completed","usage":{"input_tokens":10,"output_tokens":5}}',
  );
  assert.equal(result.type, "result");
  assert.equal(result.conversation_id, "c1");
  assert.equal((result as { response?: string }).response, "Task completed");
  assert.deepEqual((result as { usage?: { inputTokens?: number } }).usage?.inputTokens, 10);
});

test("parseSingleRecord: rejects malformed JSON and missing type", () => {
  assert.throws(() => parseSingleRecord("{ bad json"), AntigravityStreamError);
  assert.throws(() => parseSingleRecord("12345"), AntigravityStreamError);
  assert.throws(() => parseSingleRecord("null"), AntigravityStreamError);
  assert.throws(() => parseSingleRecord('{"foo":"bar"}'), AntigravityStreamError);
});

test("NdjsonParser: handles chunk-split, multi-line, and trailing data", () => {
  const parser = new NdjsonParser({ maxLineBytes: 1024, maxTotalBytes: 10240 });

  // Feed partial chunk
  const chunk1 = '{"type":"init","cwd":"/ws"}\n{"type":"step_up';
  const records1 = parser.push(chunk1);
  assert.equal(records1.length, 1);
  assert.equal(records1[0].type, "init");

  // Feed rest of line + complete second line
  const chunk2 = 'date","step_index":0,"state":"ACTIVE"}\n{"type":"result","conversation_id":"c1","status":"SUCCESS"}';
  const records2 = parser.push(chunk2);
  assert.equal(records2.length, 1);
  assert.equal(records2[0].type, "step_update");

  // Flush remaining result line
  const flushed = parser.flush();
  assert.equal(flushed.length, 1);
  assert.equal(flushed[0].type, "result");
  assert.equal(flushed[0].conversation_id, "c1");
});

test("NdjsonParser: enforces maxLineBytes and maxTotalBytes limits", () => {
  const parser1 = new NdjsonParser({ maxLineBytes: 20 });
  assert.throws(() => {
    parser1.push('{"type":"init","cwd":"/this-is-a-very-long-line-exceeding-cap"}');
  }, AntigravityStreamError);

  const parser2 = new NdjsonParser({ maxLineBytes: 1024, maxTotalBytes: 30 });
  parser2.push('{"type":"init"}\n');
  assert.throws(() => {
    parser2.push('{"type":"step_update","long":"payload exceeding total bytes"}\n');
  }, AntigravityStreamError);
});

test("NdjsonStreamValidator: enforces strict lifecycle state machine and limits", () => {
  const limits = resolveRunnerLimits({
    maxEvents: 20,
    maxSteps: 2,
    maxToolCalls: 1,
    maxSubagents: 1,
  });

  const validator = new NdjsonStreamValidator(limits);

  // Event before init fails
  assert.throws(() => {
    validator.processRecord({ type: "step_update", step_index: 0 });
  }, /before initial 'init' event/);

  // Normal flow
  validator.processRecord({ type: "init", cwd: "/ws" });

  // Duplicate init fails
  assert.throws(() => {
    validator.processRecord({ type: "init", cwd: "/ws" });
  }, /duplicate or unexpected init event/);

  validator.processRecord({
    type: "step_update",
    step_index: 0,
    state: "DONE",
    tool_info: { name: "prism_echo" },
  });

  validator.processRecord({
    type: "step_update",
    step_index: 1,
    state: "DONE",
    subagent_info: { type: "reviewer" },
  });

  // Exceeding maxSteps
  assert.throws(() => {
    validator.processRecord({ type: "step_update", step_index: 2, state: "DONE" });
  }, /maximum step limit/);

  validator.processRecord({
    type: "result",
    status: "SUCCESS",
    conversation_id: "c1",
    response: "all done",
  });

  // Event after result fails
  assert.throws(() => {
    validator.processRecord({ type: "step_update", step_index: 3 });
  }, /after terminal result/);

  const completed = validator.assertCompleted();
  assert.equal(completed.init.type, "init");
  assert.equal(completed.steps.length, 2);
  assert.equal(completed.result.type, "result");
  assert.equal(completed.result.conversation_id, "c1");
});

test("NdjsonStreamValidator: assertCompleted fails when stream ended without result", () => {
  const limits = resolveRunnerLimits();
  const validator = new NdjsonStreamValidator(limits);
  assert.throws(() => validator.assertCompleted(), /ended without emitting an init event/);

  validator.processRecord({ type: "init", cwd: "/ws" });
  assert.throws(() => validator.assertCompleted(), /ended without a terminal result event/);
});
