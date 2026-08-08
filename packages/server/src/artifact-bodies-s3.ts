/**
 * Hand-rolled AWS Signature V4 over native WebCrypto (crypto.subtle) — no SDK dependency.
 * Validated against the official AWS sig-v4-test-suite get-vanilla vector in
 * `src/__tests__/artifact-bodies.test.ts`. S3-specific presigning (query-string auth,
 * UNSIGNED-PAYLOAD for GET/DELETE, signed x-amz-content-sha256 for single-chunk PUT)
 * lives in `artifact-bodies.ts`; this module is the generic algorithm.
 */

/** RFC 3986 percent-encoding as required by SigV4 (encodeURIComponent leaves !'()* unencoded). */
export function awsUriEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** SHA-256 hex digest over WebCrypto. */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return Buffer.from(digest).toString("hex");
}

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const imported = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", imported, data as BufferSource);
  return new Uint8Array(signature);
}

/** Canonical query string: sorted keys, RFC 3986 encoded, `key=value` joined with `&`. */
export function canonicalQueryString(query: Readonly<Record<string, string>>): string {
  return Object.keys(query)
    .sort()
    .map((key) => `${awsUriEncode(key)}=${awsUriEncode(query[key])}`)
    .join("&");
}

/** Canonical headers block: lowercase name, trimmed/collapsed value, trailing newline. */
export function canonicalHeaders(headers: Readonly<Record<string, string>>, signedHeaders: readonly string[]): string {
  return signedHeaders.map((name) => `${name}:${(headers[name] ?? "").trim().replace(/\s+/g, " ")}\n`).join("");
}

export interface SigV4SignInput {
  readonly method: string;
  /** Pre-encoded path (e.g. `/bucket/key`); used verbatim. */
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  /** Lowercase header names. */
  readonly headers: Readonly<Record<string, string>>;
  /** Subset of header names, sorted; the caller decides what to sign. */
  readonly signedHeaders: readonly string[];
  /** Hex SHA-256 of the payload, or "UNSIGNED-PAYLOAD". */
  readonly payloadHash: string;
  readonly region: string;
  readonly service: string;
  /** `YYYYMMDDTHHMMSSZ`. */
  readonly amzDate: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
}

export interface SigV4Signature {
  readonly signature: string;
  readonly canonicalRequest: string;
}

/** Full SigV4 pipeline: canonical request -> string-to-sign -> derived-key HMAC. */
export async function signV4(input: SigV4SignInput): Promise<SigV4Signature> {
  const date = input.amzDate.slice(0, 8);
  const query = canonicalQueryString(input.query ?? {});
  const headers = canonicalHeaders(input.headers, input.signedHeaders);
  const signedNames = input.signedHeaders.join(";");
  const canonicalRequest = `${input.method}\n${input.path}\n${query}\n${headers}\n${signedNames}\n${input.payloadHash}`;
  const scope = `${date}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${input.amzDate}\n${scope}\n${await sha256Hex(new TextEncoder().encode(canonicalRequest))}`;
  const kDate = await hmacSha256(new TextEncoder().encode(`AWS4${input.secretAccessKey}`), new TextEncoder().encode(date));
  const kRegion = await hmacSha256(kDate, new TextEncoder().encode(input.region));
  const kService = await hmacSha256(kRegion, new TextEncoder().encode(input.service));
  const kSigning = await hmacSha256(kService, new TextEncoder().encode("aws4_request"));
  const signature = Buffer.from(await hmacSha256(kSigning, new TextEncoder().encode(stringToSign))).toString("hex");
  return { signature, canonicalRequest };
}

export interface SigV4PresignInput {
  readonly method: string;
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  /** Lowercase header names; only `host` is signed for presigned URLs. */
  readonly headers: Readonly<Record<string, string>>;
  readonly payloadHash: string;
  readonly region: string;
  readonly service: string;
  readonly amzDate: string;
  readonly expiresSeconds: number;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
}

/** Presign: returns the full query string (X-Amz-* params + X-Amz-Signature) for a URL. */
export async function presignV4(input: SigV4PresignInput): Promise<string> {
  const date = input.amzDate.slice(0, 8);
  const scope = `${date}/${input.region}/${input.service}/aws4_request`;
  const signedHeaders = ["host"];
  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${input.accessKeyId}/${scope}`,
    "X-Amz-Date": input.amzDate,
    "X-Amz-Expires": String(input.expiresSeconds),
    "X-Amz-SignedHeaders": signedHeaders.join(";"),
    ...(input.sessionToken === undefined ? {} : { "X-Amz-Security-Token": input.sessionToken }),
    ...input.query,
  };
  const { signature } = await signV4({
    method: input.method,
    path: input.path,
    query,
    headers: input.headers,
    signedHeaders,
    payloadHash: input.payloadHash,
    region: input.region,
    service: input.service,
    amzDate: input.amzDate,
    accessKeyId: input.accessKeyId,
    secretAccessKey: input.secretAccessKey,
    sessionToken: input.sessionToken,
  });
  return canonicalQueryString({ ...query, "X-Amz-Signature": signature });
}

export interface SigV4RequestSignInput {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  /** Headers to sign (subset of `headers`, sorted); the caller sends exactly these. */
  readonly signedHeaders: readonly string[];
  readonly payloadHash: string;
  readonly region: string;
  readonly service: string;
  readonly amzDate: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
}

/** Sign a direct request: returns headers including x-amz-date, x-amz-content-sha256, and Authorization. */
export async function signRequestV4(input: SigV4RequestSignInput): Promise<{ readonly headers: Record<string, string> }> {
  const date = input.amzDate.slice(0, 8);
  const scope = `${date}/${input.region}/${input.service}/aws4_request`;
  const headers: Record<string, string> = {
    ...input.headers,
    "x-amz-date": input.amzDate,
    "x-amz-content-sha256": input.payloadHash,
  };
  const { signature } = await signV4({
    method: input.method,
    path: input.path,
    headers,
    signedHeaders: input.signedHeaders,
    payloadHash: input.payloadHash,
    region: input.region,
    service: input.service,
    amzDate: input.amzDate,
    accessKeyId: input.accessKeyId,
    secretAccessKey: input.secretAccessKey,
    sessionToken: input.sessionToken,
  });
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${input.signedHeaders.join(";")}, Signature=${signature}`;
  return { headers };
}
