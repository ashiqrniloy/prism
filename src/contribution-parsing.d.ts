import type { JsonValue, Skill } from "./contracts.js";
/** Split a markdown file with `---` frontmatter into a parsed map and body.
 *  Exported so Node-side loaders (e.g. agent bundle resolution) can reuse the
 *  same frontmatter parser without duplicating it. */
export declare function splitFrontmatter(text: string, path: string): {
    front: Map<string, unknown>;
    body: string;
};
/** Parse a `SKILL.md` into a {@link Skill}. Frontmatter keys map to `name`
 *  (required), `description`, `toolNames` (comma- or YAML-list); the markdown
 *  body becomes `instructions`. `context` declared in a file is surfaced as
 *  metadata only — file-declared context providers need a `module`; Phase 30
 *  owns instruction injection and context wiring. */
export declare function parseSkillFile(text: string, path: string): Skill;
export interface AgentFileDeclaration {
    readonly kind: "agent";
    readonly name: string;
    readonly resource: string;
    readonly description?: string;
    readonly instructions: string;
    readonly metadata?: Readonly<Record<string, JsonValue>>;
}
/** Parse a per-agent `AGENT.md` bundle frontmatter file. `name`, `description`
 *  and the body (`instructions`) surface here, plus every other key as metadata.
 *  The resolver left with the agent-definition module. */
export declare function parseAgentFile(text: string, path: string): AgentFileDeclaration;
