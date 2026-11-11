/**
 * Plan 204 Task 9: the operator's OAuth sign-in for a provider whose grant lives in the OS keyring.
 *
 * A host runs an `AuthMethod`; nothing in the kernel does. This script is that host, in a terminal: it
 * builds an `AuthContext` from a printable `HostUi` and a writable keyring slot, then calls the
 * provider's own login, logout, expire, import, or one-request check. It never prints a token, code, or
 * verifier, and it prints fingerprints (not values) when you ask it to compare grants.
 *
 * ```sh
 * bun scripts/provider-login.mjs --provider openai-codex --app-name "Prism live tests"
 * bun scripts/provider-login.mjs --provider openai-codex --status
 * bun scripts/provider-login.mjs --provider openai-codex --expire      # force a refresh on next use
 * bun scripts/provider-login.mjs --provider openai-codex --check       # one request, refreshes if due
 * bun scripts/provider-login.mjs --provider openai-codex --logout
 * bun scripts/provider-login.mjs --provider openai-codex --import grant.json --check
 * ```
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import {
  credentialRecordFromSecret,
  credentialRecordToSecret,
  credentialRegistrationFromSecret,
  openAICodexApiKey,
  openAICodexAuth,
  openAICodexErrorCode,
  openAICodexHttpError,
  openAICodexImportCredentials,
  openAICodexLogout,
} from "@arnilo/prism-ai/openai-codex";

const PROVIDERS = new Set(["openai-codex"]);
const REF_PATTERN = /^keyring:[A-Za-z0-9._:-]{1,128}$/;
const SERVICE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const FIELD_PATTERN = /^[a-z][a-z0-9_]{1,40}$/;

/** The modes are exclusive; `--check` runs after a login or an import, or on its own with no mode. */
export function parseArgs(argv) {
  const options = {
    provider: undefined,
    appName: undefined,
    ref: "keyring:openai-codex",
    service: undefined,
    port: undefined,
    mode: "login",
    importPath: undefined,
    check: false,
    withField: undefined,
    paste: false,
  };
  let modeExplicit = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) throw new Error(`ProviderLogin: ${arg} needs a value`);
      index += 1;
      return next;
    };
    switch (arg) {
      case "--provider":
        options.provider = value();
        break;
      case "--app-name":
        options.appName = value();
        break;
      case "--ref":
        options.ref = value();
        break;
      case "--service":
        options.service = value();
        break;
      case "--port":
        options.port = Number(value());
        break;
      case "--import":
        options.mode = "import";
        modeExplicit = true;
        options.importPath = value();
        break;
      case "--status":
        options.mode = "status";
        modeExplicit = true;
        break;
      case "--expire":
        options.mode = "expire";
        modeExplicit = true;
        break;
      case "--logout":
        options.mode = "logout";
        modeExplicit = true;
        break;
      case "--forget":
        options.mode = "forget";
        modeExplicit = true;
        break;
      case "--check":
        options.check = true;
        break;
      case "--with-field":
        options.withField = value();
        break;
      case "--paste":
        options.paste = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`ProviderLogin: unknown argument ${arg}`);
    }
  }
  if (options.help) return options;
  if (options.withField !== undefined) options.check = true;
  // `--check` on its own is a request check, not a sign-in, so it needs no app name.
  if (!modeExplicit && options.check) options.mode = "check";
  if (!options.provider) throw new Error("ProviderLogin: --provider is required");
  if (!PROVIDERS.has(options.provider))
    throw new Error(`ProviderLogin: ${options.provider} has no login here; supported: ${[...PROVIDERS].join(", ")}`);
  if (!REF_PATTERN.test(options.ref)) throw new Error("ProviderLogin: --ref must be a writable keyring: ref; env: refs are read-only");
  if (options.service !== undefined && !SERVICE_PATTERN.test(options.service))
    throw new Error("ProviderLogin: --service must be a plain keyring service name");
  if (options.port !== undefined && (!Number.isSafeInteger(options.port) || options.port < 1 || options.port > 65_535))
    throw new Error("ProviderLogin: --port must be 1..65535");
  if (options.mode !== "login" && options.appName !== undefined && options.mode !== "import")
    throw new Error(`ProviderLogin: --app-name is not used with --${options.mode}`);
  if (options.mode === "login" && !options.appName?.trim())
    throw new Error("ProviderLogin: --app-name is required to sign in (it names this app on the consent screen)");
  if (options.withField !== undefined) options.check = true;
  if (options.withField !== undefined && !FIELD_PATTERN.test(options.withField))
    throw new Error("ProviderLogin: --with-field takes one snake_case body field name");
  if (options.mode === "status" && options.check && options.withField !== undefined)
    throw new Error("ProviderLogin: --with-field needs a request; it cannot be combined with --status");
  return options;
}

/**
 * The terminal `HostUi`. `open-url` prints the provider's URL and hands it to the desktop; `input` reads
 * one pasted callback URL; everything else a login cannot invent answers `unavailable`.
 */
export function createTerminalHostUi({ print = console.log, open = openInBrowser, ask = askLine } = {}) {
  return {
    async request(request) {
      switch (request.kind) {
        case "open-url":
          print(`\nOpen this URL to sign in with ChatGPT:\n\n  ${request.url}\n`);
          await open(request.url);
          return { status: "answered", value: undefined };
        case "input": {
          if (request.detail) print(`\n${request.title}\n${request.detail}\n`);
          const answer = await ask(`${request.title} (blank to keep waiting): `);
          return answer.trim() ? { status: "answered", value: answer.trim() } : { status: "dismissed" };
        }
        case "notify":
          print(`${request.level}: ${request.message}`);
          return { status: "answered", value: undefined };
        default:
          return { status: "unavailable" };
      }
    },
  };
}

function openInBrowser(url) {
  // The URL carries state/nonce/challenge, never a token; a missing opener is not a failure, the URL is printed.
  const [command, args] = process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.on("error", () => resolve(undefined));
    child.on("spawn", () => {
      child.unref();
      resolve(undefined);
    });
  });
}

async function askLine(question) {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await readline.question(question);
  } finally {
    readline.close();
  }
}

/** The kernel-side half of an `AuthContext`: store/delete over the same resolver the provider reads. */
export function credentialsHandle(resolver) {
  return {
    store: (ref, secret) => resolver.store(ref, secret),
    delete: (ref) => resolver.delete(ref),
  };
}

/** Resolve the ref to a slot the provider can read and write; a missing record is `undefined`, not an error. */
export async function openSlot({ service, importer = (name) => import(name) } = {}) {
  const keyring = await importer("@arnilo/prism-extensions/keyring");
  const createResolver = keyring.createKeyringCredentialResolver ?? keyring.default?.createKeyringCredentialResolver;
  const createStore = keyring.createKeychainCredentialStore ?? keyring.default?.createKeychainCredentialStore;
  if (typeof createResolver !== "function" || typeof createStore !== "function")
    throw new Error("ProviderLogin: @arnilo/prism-extensions/keyring exposes no credential resolver");
  const store = createStore({ service: service ?? keyring.KEYRING_DEFAULT_SERVICE ?? "prism" });
  return { resolver: createResolver({ store }), store, service: service ?? keyring.KEYRING_DEFAULT_SERVICE ?? "prism" };
}

/** A grant fingerprint: enough to compare two grants, never enough to use one. */
export function fingerprint(value) {
  if (typeof value !== "string" || value.length === 0) return "absent";
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

/** What `--status` prints, and what an acceptance run compares before and after a re-login. */
export async function grantStatus(config) {
  const secret = await config.slot.resolve(config.credential);
  const record = credentialRecordFromSecret(secret);
  const identity = record ?? credentialRegistrationFromSecret(secret);
  if (!record)
    return {
      ref: config.credential,
      present: false,
      registered: identity !== undefined,
      clientFingerprint: fingerprint(identity?.clientId),
      hostFingerprint: fingerprint(identity?.hostId),
    };
  return {
    ref: config.credential,
    present: true,
    registered: true,
    expiresAt: new Date(record.expires).toISOString(),
    expired: record.expires <= Date.now(),
    hasRefresh: record.refresh.length > 0,
    scope: record.scope,
    clientFingerprint: fingerprint(identity?.clientId),
    hostFingerprint: fingerprint(identity?.hostId),
  };
}

/** Force the next use to refresh: the record stays readable and the refresh token is untouched. */
export async function expireGrant(config) {
  const secret = await config.slot.resolve(config.credential);
  const record = credentialRecordFromSecret(secret);
  if (!record) throw new Error(`ProviderLogin: ${config.credential} has no record to expire; sign in first`);
  await config.slot.store(config.credential, credentialRecordToSecret({ ...record, expires: Date.now() - 60_000 }));
  return grantStatus(config);
}

/** One non-streaming-shaped Responses call, so an operator learns whether the grant works without an agent. */
export async function checkGrant(config, { withField, baseUrl = "https://api.openai.com/v1", model = "gpt-6.1-sol", secrets = [] } = {}) {
  const token = await config.apiKey();
  const body = {
    model,
    store: false,
    stream: true,
    input: [{ role: "user", content: [{ type: "input_text", text: "Reply with OK." }] }],
    ...(withField ? { [withField]: withField === "conversation" ? { id: "conv_acceptance_probe" } : {} } : {}),
  };
  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    const error = openAICodexHttpError(response, text, [token, ...secrets]);
    return {
      ok: false,
      status: response.status,
      errorCode: openAICodexErrorCode(text),
      name: error.name,
      failureClass: error.failureClass,
      message: error.message,
    };
  }
  return { ok: true, status: response.status, events: text.split("\n").filter((line) => line.startsWith("data:")).length };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      [
        "usage: bun scripts/provider-login.mjs --provider openai-codex [--app-name NAME] [MODE] [--check] [--with-field FIELD]",
        "",
        "  --app-name NAME   the app name on the consent screen (required to sign in)",
        "  --ref REF         writable keyring ref, default keyring:openai-codex",
        "  --service NAME    OS keyring service (a separate namespace), default prism",
        "  --port N          loopback callback port to try first, default 1455",
        "  --paste           skip the loopback listener and paste the callback URL instead",
        "  --status          print the grant's presence, expiry, scope and fingerprints",
        "  --expire          move expires into the past so the next request refreshes",
        "  --logout          revoke the grant; keep the issued client and host ID",
        "  --forget          delete the record without revoking (a copied grant, a scratch namespace)",
        "  --import FILE     validate a v1 record and store it, keeping this host's host ID",
        "  --check           send one Responses request through the grant",
        "  --with-field NAME add one body field the route rejects, to see the mapped error",
      ].join("\n"),
    );
    return;
  }
  const { resolver } = await openSlot({ service: options.service });
  const slot = {
    resolve: (ref) => resolver.resolve(ref, {}),
    store: (ref, secret) => resolver.store(ref, secret),
    delete: (ref) => resolver.delete(ref),
  };
  const config = {
    credential: options.ref,
    slot,
    ...(options.appName ? { appName: options.appName } : {}),
    ...(options.port !== undefined ? { callbackPort: options.port } : {}),
    ...(options.paste ? { callback: "paste" } : {}),
  };
  const credentials = credentialsHandle(resolver);
  const ui = options.mode === "login" ? createTerminalHostUi() : undefined;
  const ctx = { host: { ...(ui ? { ui } : {}) }, credentials };

  if (options.mode === "login") {
    const method = openAICodexAuth(config);
    await method.login({ host: { ui }, credentials });
    console.log("signed in");
  } else if (options.mode === "logout") {
    await openAICodexLogout(config)(ctx);
    console.log("signed out; the grant is revoked, and the issued client and host ID are kept for the next sign-in");
  } else if (options.mode === "forget") {
    await credentials.delete(options.ref);
    console.log(`forgot ${options.ref}; nothing was revoked upstream`);
  } else if (options.mode === "expire") {
    await expireGrant(config);
    console.log("grant expired; the next request refreshes and persists the rotated record");
  } else if (options.mode === "import") {
    const record = JSON.parse(await readFile(options.importPath, "utf8"));
    await openAICodexImportCredentials(config)(ctx, record);
    console.log("imported; this host keeps its own host ID");
  }

  if (options.mode !== "login" || options.check) {
    const status = await grantStatus(config);
    console.log(JSON.stringify(status));
  }
  if (options.check) {
    const result = await checkGrant({ ...config, apiKey: openAICodexApiKey(config) }, { withField: options.withField });
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(`provider-login: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
