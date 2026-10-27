/** A parsed `major.minor.patch[-prerelease]` version. Build metadata is accepted and ignored. */
export interface SemVer {
    readonly major: number;
    readonly minor: number;
    readonly patch: number;
    readonly pre: readonly (string | number)[];
}
type Operator = "=" | ">" | ">=" | "<" | "<=";
interface Comparator {
    readonly op: Operator;
    readonly version: SemVer;
}
/** One AND-set of comparators. A range is an OR of these. */
type ComparatorSet = readonly Comparator[];
export type SemVerRange = readonly ComparatorSet[];
/** Parses a full version, or returns `undefined`. */
export declare function parseVersion(text: string): SemVer | undefined;
export declare function isValidVersion(text: string): boolean;
export declare function compareVersions(a: SemVer, b: SemVer): number;
/**
 * Parses a range. Supported: `^`, `~`, exact (`1.2.3`, `=1.2.3`), `>=`, `>`, `<=`, `<`, space-joined
 * comparators (AND), `||` (OR), and `*`. Rejected with `definition_invalid`: hyphen ranges, `x`
 * ranges, bare partials (`1.2`), and dist-tags.
 */
export declare function parseRange(range: string): SemVerRange;
/**
 * Whether `version` satisfies `range`, with the node-semver prerelease rule: a prerelease version
 * matches a set only when one comparator in it names the same `major.minor.patch` with a prerelease.
 * So `^0.13.0-0` admits `0.13.0-rc.1`, and `^0.12.1` does not admit `0.13.0-rc.1`.
 */
export declare function satisfies(version: SemVer, range: SemVerRange): boolean;
export {};
