/** The named content-detector catalog (plan 237 Task 2). Config names detectors; it never supplies functions. */
import { INJECTION_DETECTORS, SECRET_DETECTORS } from "./injection.js";
import { PII_DETECTORS } from "./pii.js";
import type { ContentDetector } from "./types.js";

export { luhnValid } from "./pii.js";
export { SECRET_PATTERN } from "./secrets.js";
export type { ContentDetector } from "./types.js";

export const PII_DETECTOR_IDS = PII_DETECTORS.map((detector) => detector.id);
export const INJECTION_DETECTOR_IDS = INJECTION_DETECTORS.map((detector) => detector.id);

/** Every built-in detector by name. */
export const CONTENT_DETECTORS: ReadonlyMap<string, ContentDetector> = new Map(
  [...PII_DETECTORS, ...SECRET_DETECTORS, ...INJECTION_DETECTORS].map((detector) => [detector.id, detector]),
);

/** Detector names, in catalog order. */
export const CONTENT_DETECTOR_IDS: readonly string[] = [...CONTENT_DETECTORS.keys()];
