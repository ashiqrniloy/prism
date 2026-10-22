#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { createSecretRedactor, redactSessionEntry } from "@arnilo/prism";
import { createJsonlSessionStore } from "@arnilo/prism-store-jsonl";
import { args, hash, writeLedger } from "./io.mjs";

export async function recordLedger({
  store,
  session,
  consent,
  redactor = createSecretRedactor([]),
  identities = [],
  persona,
  project,
  out,
}) {
  if (consent !== true) throw new Error("Lifecycle recording requires --consent");
  if (typeof session !== "string" || !session || !Array.isArray(identities) || identities.some((s) => typeof s !== "string" || !s))
    throw new Error("LifecycleRecordArguments");
  const entries = await store.list(session);
  if (!entries.length) throw new Error("LifecycleSessionMissing");
  const pseudonym = (text) => (/^[a-f0-9]{12}$/.test(text) ? hash(text).slice(0, 12) : `hash-${hash(text)}`);
  const names = [...new Set([...(session.length >= 8 ? [session] : []), ...identities])].sort((a, b) => b.length - a.length);
  const identityKeys = new Set([
    "id",
    "sessionId",
    "runId",
    "parentId",
    "tenantId",
    "resourceId",
    "threadId",
    "userId",
    "agentId",
    "projectId",
    "sourceEntryIds",
    "supportingObservationIds",
    "supersededReflectionIds",
    "consumedObservationIds",
    "observationIds",
    "supersededBy",
    "toolCallId",
  ]);
  function anonymize(value, key) {
    if (typeof value === "string") {
      if (identityKeys.has(key)) return pseudonym(value);
      let text = value
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, pseudonym)
        .replace(/(?:\/home\/|\/Users\/)[^\s/"\\]+/g, pseudonym);
      for (const name of names) text = text.split(name).join(pseudonym(name));
      return text;
    }
    if (Array.isArray(value)) return value.map((item) => anonymize(item, key));
    if (value && typeof value === "object")
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [identities.includes(k) ? pseudonym(k) : k, anonymize(v, k)]));
    return value;
  }
  return writeLedger(
    {
      manifest: {
        type: "manifest",
        version: 1,
        source: "recorded",
        consent: true,
        redactionVersion: "session+scan+identity-v1",
        session: hash(session),
        persona: hash(persona ?? entries[0].tenantId ?? session),
        project: hash(project ?? entries[0].resourceId ?? session),
        order: entries[0].timestamp,
        labels: [],
        probes: [],
      },
      entries: entries.map((entry) => anonymize(redactSessionEntry(entry, redactor))),
    },
    out,
  );
}
if (import.meta.main) {
  try {
    const options = args({
      session: "string",
      consent: "boolean",
      store: "string",
      identities: "string",
      persona: "string",
      project: "string",
      out: "string",
    });
    if (!options.consent) throw new Error("LifecycleConsentRequired");
    const secrets = Object.entries(process.env)
      .filter(([key]) => /(?:KEY|TOKEN|SECRET|PASSWORD)$/.test(key))
      .map(([, value]) => value)
      .filter(Boolean);
    const path = await recordLedger({
      ...options,
      store: createJsonlSessionStore({ dir: options.store ?? ".prism/sessions" }),
      identities: options.identities ? JSON.parse(await readFile(options.identities, "utf8")) : [],
      redactor: createSecretRedactor(secrets),
    });
    console.log(path);
  } catch {
    console.error("Lifecycle recording failed: check consent, session store, identity file and redaction; no unscanned ledger published");
    process.exitCode = 1;
  }
}
