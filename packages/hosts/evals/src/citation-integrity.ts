import {
  type ArtifactApproval,
  type ArtifactCitation,
  type ArtifactRevision,
  citationBindingDigest,
  HARD_CITATION_EXCERPT_BYTES,
} from "@arnilo/prism/artifacts";

export type CitationIntegrityReason =
  | "ok"
  | "missing_source"
  | "hash_mismatch"
  | "span_mismatch"
  | "revoked_acl"
  | "revision_changed"
  | "excerpt_too_large"
  | "cross_tenant";

export interface CitationLiveSource {
  readonly contentHash: string;
  readonly revision: string;
  readonly body?: string;
  readonly tenantId?: string;
  readonly authorized?: boolean;
}

export interface CitationIntegrityResult {
  readonly ok: boolean;
  readonly reason: CitationIntegrityReason;
}

function normalizeCitationHash(value: string): string {
  const raw = value.startsWith("sha256:") ? value.slice("sha256:".length) : value;
  return raw.trim().toLowerCase();
}

/** Deterministic source existence / hash / span / ACL check. Ignores `support`. */
export function checkCitationIntegrity(
  citation: ArtifactCitation,
  live?: CitationLiveSource,
  options?: { readonly boundRevision?: string; readonly maxExcerptBytes?: number },
): CitationIntegrityResult {
  const maxExcerpt = options?.maxExcerptBytes ?? HARD_CITATION_EXCERPT_BYTES;
  if (citation.excerpt !== undefined && Buffer.byteLength(citation.excerpt, "utf8") > maxExcerpt) {
    return { ok: false, reason: "excerpt_too_large" };
  }
  if (!live) return { ok: false, reason: "missing_source" };
  if (live.authorized === false) return { ok: false, reason: "revoked_acl" };
  if (citation.tenantId && live.tenantId && citation.tenantId !== live.tenantId) {
    return { ok: false, reason: "cross_tenant" };
  }
  if (!citation.contentHash) return { ok: false, reason: "missing_source" };
  if (normalizeCitationHash(citation.contentHash) !== normalizeCitationHash(live.contentHash)) {
    return { ok: false, reason: "hash_mismatch" };
  }
  if (citation.revision !== undefined && citation.revision !== live.revision) {
    return { ok: false, reason: "revision_changed" };
  }
  if (options?.boundRevision !== undefined && options.boundRevision !== live.revision) {
    return { ok: false, reason: "revision_changed" };
  }
  if (citation.span) {
    const { start, end } = citation.span;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start) {
      return { ok: false, reason: "span_mismatch" };
    }
    if (live.body !== undefined) {
      const sliced = live.body.slice(start, end);
      if (citation.excerpt !== undefined && sliced !== citation.excerpt) {
        return { ok: false, reason: "span_mismatch" };
      }
    }
  } else if (citation.excerpt !== undefined && live.body !== undefined && citation.excerpt !== live.body) {
    return { ok: false, reason: "span_mismatch" };
  }
  return { ok: true, reason: "ok" };
}

/** True when the approval digest still matches the revision and (if given) live sources pass integrity. */
export function approvalEvidenceIntact(
  approval: ArtifactApproval,
  revision: ArtifactRevision,
  liveSources?: Readonly<Record<string, CitationLiveSource>>,
): CitationIntegrityResult {
  if (approval.evidenceDigest !== undefined && approval.evidenceDigest !== citationBindingDigest(revision.citations)) {
    return { ok: false, reason: "revision_changed" };
  }
  if (liveSources === undefined) return { ok: true, reason: "ok" };
  for (const citation of revision.citations ?? []) {
    if (!citation.sourceId && !citation.contentHash) continue;
    const live = citation.sourceId ? liveSources[citation.sourceId] : undefined;
    const result = checkCitationIntegrity(citation, live, {
      ...(citation.revision === undefined ? {} : { boundRevision: citation.revision }),
    });
    if (!result.ok) return result;
  }
  return { ok: true, reason: "ok" };
}
