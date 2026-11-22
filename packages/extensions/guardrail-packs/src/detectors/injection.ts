/**
 * Prompt-injection marker detectors (plan 237 Task 2), for untrusted tool results. They look for the
 * phrasing of an attack, not its goal: instruction-override wording, spoofed roles or tool frames, and
 * requests to send private data to a link. Every gap is bounded; matching is case-insensitive.
 */
import { SECRET_PATTERN } from "./secrets.js";
import type { ContentDetector } from "./types.js";

/**
 * "Ignore the previous instructions", "disregard all prior rules", "new instructions for the
 * assistant", "this instruction outranks the user's task".
 */
const INSTRUCTION_OVERRIDE = new RegExp(
  [
    String.raw`\b(?:ignore|disregard|forget|override|bypass)\s+(?:(?:all|any|the|your|my|these|those|of)\s+){0,3}(?:previous|prior|above|earlier|preceding|original|initial|system|user(?:'s)?)\s+(?:(?:user|system)\s+)?(?:instructions?|prompts?|requests?|rules|directions|guidelines|tasks?|messages?|context)\b`,
    String.raw`\b(?:important|new|updated|additional|revised|urgent|hidden|secret)\s+instructions?\s+(?:for|to)\s+(?:the\s+)?(?:assistant|ai|agent|model|llm|chatbot|prism|you)\b`,
    String.raw`\b(?:this|these)\s+instructions?\s+(?:outranks?|overrides?|supersedes?|takes?\s+precedence\s+over|replaces?)\b`,
    String.raw`\byou\s+are\s+now\s+(?:in\s+)?(?:developer|dan|jailbreak|god|unrestricted)\s+mode\b`,
  ].join("|"),
  "gi",
);

/** Chat-template tokens, role prefixes at a line start, and fake tool or system frames. */
const ROLE_SPOOFING = new RegExp(
  [
    String.raw`<\|(?:im_start|im_end|system|user|assistant|endoftext|start_header_id|end_header_id|eot_id)\|>`,
    String.raw`\[\/?(?:INST|SYS)\]|<<\/?SYS>>`,
    String.raw`(?:^|\n)[ \t]{0,8}(?:#{1,3}[ \t]{0,4})?(?:system|assistant|developer)[ \t]{0,4}:[ \t]`,
    String.raw`<\/?[ \t]{0,4}(?:system|assistant|developer|tool_result|tool_output|tool_call|function_results?|function_calls?)\b[^<>\n]{0,256}>`,
  ].join("|"),
  "gi",
);

/**
 * A request to send private material to a URL, or a Markdown image whose URL carries a query string
 * (an image fetch is a silent exfiltration channel).
 */
const EXFILTRATION_LINK = new RegExp(
  [
    String.raw`\b(?:send|post|upload|forward|exfiltrate|transmit|leak|append|include|encode)(?:[^\n]{0,48}?\s)?(?:conversation|chat|history|transcript|messages|secrets?|credentials?|api[ _-]?keys?|tokens?|passwords?|system\s+prompt|private\s+data|context)\b(?:[^\n]{0,48}?\s)?https?:\/\/`,
    // The URL body excludes `?`, `&`, and `(`, so it cannot backtrack across a later query or image.
    String.raw`!\[[^\]\n]{0,256}\]\(\s{0,4}https?:\/\/[^\s()?&]{1,512}[?&][^\s()=&]{1,64}=`,
  ].join("|"),
  "gi",
);

export const INJECTION_DETECTORS: readonly ContentDetector[] = [
  { id: "instruction-override", pattern: INSTRUCTION_OVERRIDE },
  { id: "role-spoofing", pattern: ROLE_SPOOFING },
  { id: "exfiltration-link", pattern: EXFILTRATION_LINK },
];

/** The secret shapes as a content detector (`output-secrets`). */
export const SECRET_DETECTORS: readonly ContentDetector[] = [{ id: "secret", pattern: new RegExp(SECRET_PATTERN.source, "g") }];
