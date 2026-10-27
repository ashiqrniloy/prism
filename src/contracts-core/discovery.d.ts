import type { Skill } from "./agent.js";
export type ContributionFileKind = "skill" | "tool" | "instructions";
/** Manifest fields a non-skill discovery entry still carries. Not a package manifest. */
export interface DiscoveredDeclaration {
    readonly name: string;
    readonly module?: string;
    readonly exportName?: string;
    readonly resource?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
}
/** Inert envelope from the discovery scanner. Skills carry a realized {@link Skill}.
 *  Other kinds carry a declaration; the host owns execution. No code, no credential. */
export interface DiscoveredContribution {
    readonly kind: ContributionFileKind;
    readonly name: string;
    readonly origin: "global" | "workspace";
    readonly path: string;
    /** Present when `kind === "skill"`. */
    readonly skill?: Skill;
    /** Present for non-skill kinds. */
    readonly declaration?: DiscoveredDeclaration;
    readonly metadata?: Readonly<Record<string, unknown>>;
}
