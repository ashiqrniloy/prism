/** A named content detector: a global, quantifier-bounded pattern plus an optional check on each match. */
export interface ContentDetector {
  readonly id: string;
  /** Global (`g`) pattern; every quantifier is bounded. Callers copy it before use (`lastIndex` is shared state). */
  readonly pattern: RegExp;
  /** Further check on the matched text (for example a checksum); a match it refuses is not a hit. */
  readonly accept?: (match: string) => boolean;
}
