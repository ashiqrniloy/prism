/**
 * Claim lint (plan 207 Task 7): a read-only health report over the ontology, per scope. It reads the `memory.fabric`
 * port only and makes no model call. Every rule is one entry in {@link LINT_RULES}; a rule is a pure function of the
 * facts gathered for a scope, so the report is as cheap as one concept read per 32 concepts plus one note read per 32
 * distinct citations.
 *
 * Only an unresolved citation and an alias collision fail the report (`ok: false`); everything else is maintainer work.
 */
import {
  type ConceptDoc,
  type ConceptItem,
  type FabricOntologyPort,
  type FabricScopeLevel,
  type OntologyNoteView,
  type OntologySubject,
  parseConceptBody,
} from "@arnilo/prism-memory-fabric";

export type WikiLintRuleId =
  | "unresolved-citation"
  | "alias-collision"
  | "stale-claim"
  | "uncited-human-claim"
  | "candidate-only-claim"
  | "relation-missing-subject"
  | "over-claim-cap"
  | "shared-without-evidence"
  | "unbound-note"
  | "human-edited"
  | "invalid-body";

export interface WikiLintFinding {
  readonly rule: WikiLintRuleId;
  readonly scope: FabricScopeLevel;
  readonly subject?: string;
  /** The concept, claim or note the finding is about. */
  readonly id?: string;
  readonly detail: string;
}

export interface WikiLintScopeReport {
  readonly scope: FabricScopeLevel;
  readonly concepts: number;
  readonly findings: readonly WikiLintFinding[];
}

export interface WikiLintReport {
  /** False only for an unresolved citation or an alias collision. */
  readonly ok: boolean;
  readonly scopes: readonly WikiLintScopeReport[];
  readonly findings: readonly WikiLintFinding[];
  readonly counts: Readonly<Partial<Record<WikiLintRuleId, number>>>;
  /** Why the unbound-note rule did not run, when it did not. */
  readonly skipped?: string;
}

export interface WikiLintOptions {
  /** Scopes to lint; default every readable scope. */
  readonly scopes?: readonly FabricScopeLevel[];
  /** The consolidate cap; a concept over it is reported. */
  readonly maxClaimsPerConcept: number;
  /** Start times of this process's concept passes, newest first. */
  readonly passStarts?: readonly string[];
  /** An unbound note that outlived this many passes is an ontology gap. Default {@link UNBOUND_AFTER_PASSES}. */
  readonly unboundAfterPasses?: number;
  readonly signal?: AbortSignal;
}

/** Passes an unbound note may outlive before lint calls it a gap. */
export const UNBOUND_AFTER_PASSES = 3;
const MAX_UNBOUND_PAGES = 3;
const UNBOUND_PAGE = 64;
const MAX_FINDINGS_PER_RULE_AND_SCOPE = 50;

interface ConceptFacts {
  readonly subject: OntologySubject;
  readonly view: OntologyNoteView;
  /** `undefined` when the stored body no longer parses. */
  readonly doc: ConceptDoc | undefined;
}

interface ScopeFacts {
  readonly scope: FabricScopeLevel;
  readonly options: WikiLintOptions;
  readonly subjects: readonly OntologySubject[];
  readonly concepts: readonly ConceptFacts[];
  /** Every distinct cited note: its view, or `undefined` when it cannot be read in this scope. Empty for `team`. */
  readonly cited: ReadonlyMap<string, OntologyNoteView | undefined>;
  /** Unbound notes created before the gap threshold, oldest first; `undefined` when the rule cannot run. */
  readonly unbound: readonly OntologyNoteView[] | undefined;
}

type Finding = Omit<WikiLintFinding, "scope">;

interface LintRule {
  readonly id: WikiLintRuleId;
  /** Only a failing rule turns `ok` false. */
  readonly fails: boolean;
  readonly check: (facts: ScopeFacts) => readonly Finding[];
}

const allItems = (doc: ConceptDoc): readonly ConceptItem[] => [...doc.claims, ...doc.questions, ...doc.contradictions];
const isStaleStatus = (status: string | undefined): boolean => status === "archived" || status === "retired";
const normalize = (name: string): string => name.trim().toLowerCase();

/** The one table of rules. Add a rule here and nowhere else. */
export const LINT_RULES: readonly LintRule[] = [
  {
    id: "unresolved-citation",
    fails: true,
    check: ({ concepts, cited, scope }) =>
      scope === "team"
        ? []
        : concepts.flatMap(({ subject, doc }) =>
            (doc === undefined ? [] : allItems(doc)).flatMap((item) => {
              const missing = item.cites.filter((cite) => cited.get(cite) === undefined);
              return missing.length === 0
                ? []
                : [
                    {
                      rule: "unresolved-citation" as const,
                      subject: subject.subject,
                      id: item.id,
                      detail: `${item.id} cites ${missing.join(", ")}, which can no longer be read here`,
                    },
                  ];
            }),
          ),
  },
  {
    id: "alias-collision",
    fails: true,
    check: ({ subjects }) => {
      const owners = new Map<string, Set<string>>();
      for (const subject of subjects) {
        for (const name of [subject.subject, subject.title, ...subject.aliases]) {
          const key = normalize(name);
          if (key.length === 0) continue;
          const set = owners.get(key) ?? new Set<string>();
          set.add(subject.subject);
          owners.set(key, set);
        }
      }
      return [...owners]
        .filter(([, set]) => set.size > 1)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([name, set]) => {
          const owners = [...set].sort();
          return {
            rule: "alias-collision" as const,
            subject: owners.join(","),
            id: name,
            detail: `the name "${name}" belongs to ${owners.join(" and ")}`,
          };
        });
    },
  },
  {
    id: "stale-claim",
    fails: false,
    check: ({ concepts, cited }) =>
      concepts.flatMap(({ subject, view, doc }) => {
        const stale = new Set(view.stale ?? []);
        return (doc === undefined ? [] : allItems(doc)).flatMap((item) => {
          const archived = item.cites.filter((cite) => isStaleStatus(cited.get(cite)?.status));
          if (!stale.has(item.id) && archived.length === 0) return [];
          return [
            {
              rule: "stale-claim" as const,
              subject: subject.subject,
              id: item.id,
              detail: stale.has(item.id)
                ? `${item.id} rests on a note that changed or was superseded`
                : `${item.id} cites an archived note`,
            },
          ];
        });
      }),
  },
  {
    id: "uncited-human-claim",
    fails: false,
    check: ({ concepts }) =>
      concepts.flatMap(({ subject, doc }) =>
        (doc === undefined ? [] : allItems(doc))
          .filter((item) => item.cites.length === 0)
          .map((item) => ({
            rule: "uncited-human-claim" as const,
            subject: subject.subject,
            id: item.id,
            detail: `${item.id} has no citation; add one or confirm it is yours`,
          })),
      ),
  },
  {
    id: "candidate-only-claim",
    fails: false,
    check: ({ concepts, cited, scope }) =>
      scope === "team"
        ? []
        : concepts.flatMap(({ subject, doc }) =>
            (doc === undefined ? [] : doc.claims)
              .filter((item) => item.cites.length > 0 && item.cites.every((cite) => cited.get(cite)?.status === "candidate"))
              .map((item) => ({
                rule: "candidate-only-claim" as const,
                subject: subject.subject,
                id: item.id,
                detail: `${item.id} rests only on candidate notes that have not earned their keep`,
              })),
          ),
  },
  {
    id: "relation-missing-subject",
    fails: false,
    check: ({ concepts, subjects }) => {
      const live = new Set(subjects.map((subject) => subject.conceptId));
      return concepts.flatMap(({ subject, view }) =>
        (view.links ?? [])
          .filter((link) => !live.has(link.id))
          .map((link) => ({
            rule: "relation-missing-subject" as const,
            subject: subject.subject,
            id: link.id,
            detail: `${link.relation ?? "related"} points at ${link.id}, which is no longer a live concept`,
          })),
      );
    },
  },
  {
    id: "over-claim-cap",
    fails: false,
    check: ({ concepts, options }) =>
      concepts.flatMap(({ subject, doc }) =>
        doc === undefined || doc.claims.length <= options.maxClaimsPerConcept
          ? []
          : [
              {
                rule: "over-claim-cap" as const,
                subject: subject.subject,
                detail: `${doc.claims.length} claims, over the ${options.maxClaimsPerConcept} cap; merge or retire some`,
              },
            ],
      ),
  },
  {
    id: "shared-without-evidence",
    fails: false,
    check: ({ concepts, scope }) =>
      scope !== "team"
        ? []
        : concepts.flatMap(({ subject, doc }) => {
            const cites = new Set((doc === undefined ? [] : allItems(doc)).flatMap((item) => item.cites));
            return cites.size === 0
              ? []
              : [
                  {
                    rule: "shared-without-evidence" as const,
                    subject: subject.subject,
                    detail: `${cites.size} cited note(s) live in private memory and are not in the team store; the citations are provenance only`,
                  },
                ];
          }),
  },
  {
    id: "unbound-note",
    fails: false,
    check: ({ unbound, scope }) =>
      (unbound ?? []).map((note) => ({
        rule: "unbound-note" as const,
        id: note.id,
        detail: `${note.kind} note from ${note.createdAt.slice(0, 10)} is bound to no subject (${scope} ontology gap)`,
      })),
  },
  {
    id: "human-edited",
    fails: false,
    check: ({ subjects }) =>
      subjects
        .filter((subject) => subject.dirty.includes("edited"))
        .map((subject) => ({
          rule: "human-edited" as const,
          subject: subject.subject,
          detail: "edited by a person since the curator last wrote it; its human claims are read-only to the curator",
        })),
  },
  {
    id: "invalid-body",
    fails: false,
    check: ({ concepts }) =>
      concepts
        .filter(({ doc }) => doc === undefined)
        .map(({ subject }) => ({
          rule: "invalid-body" as const,
          subject: subject.subject,
          detail: "the stored body does not parse as a concept; fix the file or restore it from git",
        })),
  },
];

function parse(text: string): ConceptDoc | undefined {
  try {
    return parseConceptBody(text, { allowUncited: true });
  } catch {
    return undefined;
  }
}

async function readAll(
  port: FabricOntologyPort,
  scope: FabricScopeLevel,
  ids: readonly string[],
  signal: AbortSignal | undefined,
): Promise<readonly OntologyNoteView[]> {
  const out: OntologyNoteView[] = [];
  for (let offset = 0; offset < ids.length; offset += 32) {
    out.push(...(await port.read(scope, ids.slice(offset, offset + 32), signal === undefined ? {} : { signal })));
  }
  return out;
}

async function gather(port: FabricOntologyPort, scope: FabricScopeLevel, options: WikiLintOptions, threshold: string | undefined) {
  const signal = options.signal;
  const subjects = await port.subjects(scope, signal === undefined ? {} : { signal });
  const views = new Map(
    (
      await readAll(
        port,
        scope,
        subjects.map((subject) => subject.conceptId),
        signal,
      )
    ).map((view) => [view.id, view]),
  );
  const concepts: ConceptFacts[] = subjects.flatMap((subject) => {
    const view = views.get(subject.conceptId);
    return view === undefined ? [] : [{ subject, view, doc: parse(view.text) }];
  });
  const cited = new Map<string, OntologyNoteView | undefined>();
  if (scope !== "team") {
    const ids = [...new Set(concepts.flatMap(({ doc }) => (doc === undefined ? [] : allItems(doc).flatMap((item) => item.cites))))];
    for (const note of await readAll(port, scope, ids, signal)) cited.set(note.id, note);
    for (const id of ids) if (!cited.has(id)) cited.set(id, undefined);
  }
  let unbound: OntologyNoteView[] | undefined;
  if (scope !== "team" && threshold !== undefined) {
    unbound = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_UNBOUND_PAGES; page += 1) {
      const result = await port.pending(scope, {
        unbound: true,
        limit: UNBOUND_PAGE,
        ...(cursor === undefined ? {} : { cursor }),
        ...(signal === undefined ? {} : { signal }),
      });
      for (const note of result.notes) if (note.createdAt < threshold) unbound.push(note);
      cursor = result.cursor;
      // `pending` is oldest first: once a page ends past the threshold, the rest are newer.
      if (cursor === undefined || (result.notes.at(-1)?.createdAt ?? "") >= threshold) break;
    }
  }
  return { subjects, concepts, cited, unbound };
}

/** Lint the readable scopes. Reads only; never throws for a finding, only for an aborted or failing port. */
export async function lintOntology(port: FabricOntologyPort, options: WikiLintOptions): Promise<WikiLintReport> {
  const readable = new Set(port.scopes());
  const scopes = (options.scopes ?? port.scopes()).filter((scope) => readable.has(scope));
  const needed = options.unboundAfterPasses ?? UNBOUND_AFTER_PASSES;
  const threshold = options.passStarts?.[needed - 1];
  const reports: WikiLintScopeReport[] = [];
  for (const scope of scopes) {
    options.signal?.throwIfAborted();
    const gathered = await gather(port, scope, options, threshold);
    const facts: ScopeFacts = { scope, options, ...gathered };
    const findings: WikiLintFinding[] = [];
    for (const rule of LINT_RULES) {
      const found = rule.check(facts);
      for (const finding of found.slice(0, MAX_FINDINGS_PER_RULE_AND_SCOPE)) findings.push({ ...finding, scope });
      if (found.length > MAX_FINDINGS_PER_RULE_AND_SCOPE) {
        findings.push({
          rule: rule.id,
          scope,
          detail: `${found.length - MAX_FINDINGS_PER_RULE_AND_SCOPE} more ${rule.id} finding(s) not listed`,
        });
      }
    }
    reports.push({ scope, concepts: gathered.concepts.length, findings });
  }
  const findings = reports.flatMap((report) => report.findings);
  const counts: Partial<Record<WikiLintRuleId, number>> = {};
  for (const finding of findings) counts[finding.rule] = (counts[finding.rule] ?? 0) + 1;
  const failing = new Set(LINT_RULES.filter((rule) => rule.fails).map((rule) => rule.id));
  return {
    ok: !findings.some((finding) => failing.has(finding.rule)),
    scopes: reports,
    findings,
    counts,
    ...(threshold === undefined
      ? { skipped: `unbound-note needs ${needed} concept pass(es) in this process; ${options.passStarts?.length ?? 0} so far` }
      : {}),
  };
}
