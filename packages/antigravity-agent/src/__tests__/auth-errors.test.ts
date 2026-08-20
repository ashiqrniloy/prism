import assert from "node:assert/strict";
import { test } from "node:test";
import { createSecretRedactor } from "@arnilo/prism";
import {
  AntigravityAuthenticationError,
  AntigravityQuotaExhaustedError,
  AntigravityRunnerError,
  diagnoseCliError,
  isAuthenticationErrorText,
  isInvalidModelErrorText,
  isQuotaExhaustedErrorText,
  isUnsupportedCliOptionText,
} from "../index.js";

test("isAuthenticationErrorText: detects unauthenticated patterns", () => {
  assert.equal(isAuthenticationErrorText("Error: authentication required"), true);
  assert.equal(isAuthenticationErrorText("Please run agy login to continue"), true);
  assert.equal(isAuthenticationErrorText("User is not authenticated with Google Antigravity"), true);
  assert.equal(isAuthenticationErrorText("No valid credentials found in cache"), true);
  assert.equal(isAuthenticationErrorText("normal output"), false);
});

test("isQuotaExhaustedErrorText: detects quota and rate limit patterns", () => {
  assert.equal(isQuotaExhaustedErrorText("429 Too Many Requests: quota exceeded"), true);
  assert.equal(isQuotaExhaustedErrorText("Antigravity AI Pro quota exhausted for this 5-hour window"), true);
  assert.equal(isQuotaExhaustedErrorText("Resource exhausted: rate limit reached"), true);
  assert.equal(isQuotaExhaustedErrorText("everything ok"), false);
});

test("isInvalidModelErrorText: detects unknown/invalid model patterns", () => {
  assert.equal(isInvalidModelErrorText("Error: unknown model 'gemini-9-ultra'"), true);
  assert.equal(isInvalidModelErrorText("Invalid model specified: foo-bar"), true);
  assert.equal(isInvalidModelErrorText("Model not supported"), true);
  assert.equal(isInvalidModelErrorText("model loaded"), false);
});

test("isUnsupportedCliOptionText: detects unsupported CLI flags or options", () => {
  assert.equal(isUnsupportedCliOptionText("error: unknown option '--invalid-flag'"), true);
  assert.equal(isUnsupportedCliOptionText("unrecognized option: --foo"), true);
  assert.equal(isUnsupportedCliOptionText("valid options"), false);
});

test("diagnoseCliError: returns AntigravityAuthenticationError without handling credentials", () => {
  const err = diagnoseCliError({
    exitCode: 1,
    stderr: "Error: authentication required. Please run agy login.",
  });

  assert.ok(err instanceof AntigravityAuthenticationError);
  assert.equal(err.code, "ERR_PRISM_ANTIGRAVITY_AUTH_REQUIRED");
  assert.match(err.message, /run interactive 'agy' once/i);
  assert.match(err.message, /Prism never handles or copies/i);
});

test("diagnoseCliError: returns AntigravityQuotaExhaustedError", () => {
  const err = diagnoseCliError({
    exitCode: 1,
    stderr: "Error: 429 quota exhausted for current tier",
  });

  assert.ok(err instanceof AntigravityQuotaExhaustedError);
  assert.equal(err.code, "ERR_PRISM_ANTIGRAVITY_QUOTA_EXHAUSTED");
  assert.match(err.message, /quota exhausted/i);
});

test("diagnoseCliError: returns AntigravityRunnerError for invalid model", () => {
  const err = diagnoseCliError({
    exitCode: 2,
    stderr: "error: unknown model 'unknown-model-123'",
  });

  assert.ok(err instanceof AntigravityRunnerError);
  assert.equal((err as AntigravityRunnerError).code, "ERR_PRISM_ANTIGRAVITY_MODEL_ERROR");
  assert.equal((err as AntigravityRunnerError).exitCode, 2);
});

test("diagnoseCliError: redacts secrets from error messages and attached stderr", () => {
  const secret = "SECRET_API_TOKEN_XYZ_999";
  const redactor = createSecretRedactor([secret]);

  const err = diagnoseCliError({
    exitCode: 1,
    stderr: `Failed with token leak: ${secret}`,
    redactor,
  });

  assert.ok(err instanceof AntigravityRunnerError);
  assert.doesNotMatch(err.message, new RegExp(secret));
  assert.match(err.message, /\[REDACTED\]/);
  assert.doesNotMatch((err as AntigravityRunnerError).stderr ?? "", new RegExp(secret));
});
