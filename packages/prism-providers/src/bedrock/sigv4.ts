import { createHash, createHmac } from "node:crypto";

export interface AwsCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
}

export interface SignAwsRequestInput {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string;
  readonly region: string;
  readonly service: string;
  readonly credentials: AwsCredentials;
  readonly now?: Date;
}

function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

/** Minimal AWS SigV4 for Bedrock Runtime (no AWS SDK). */
export function signAwsRequest(input: SignAwsRequestInput): Record<string, string> {
  const url = new URL(input.url);
  const now = input.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(input.body);
  // Normalize caller headers once: lowercase names, last-wins on duplicate
  // case (object-spread semantics), then filter reserved names. Canonicalizing
  // from the merged map avoids the old duplicate-lowercase-key .find ambiguity.
  const merged = new Map<string, string>();
  for (const [key, value] of Object.entries(input.headers)) merged.set(key.toLowerCase(), value);
  const headers: Record<string, string> = {
    host: url.host,
    "content-type": merged.get("content-type") ?? "application/json",
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
  };
  for (const [key, value] of merged) {
    if (key !== "host" && key !== "authorization" && key !== "x-amz-date" && key !== "x-amz-content-sha256") {
      headers[key] = value;
    }
  }
  if (input.credentials.sessionToken) headers["x-amz-security-token"] = input.credentials.sessionToken;

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${(headers[name] ?? "").trim().replace(/\s+/g, " ")}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");
  // AWS sorts encoded keys, then encoded values (repeated keys by value).
  const canonicalQuery = [...url.searchParams.entries()]
    .map(([key, value]) => [encodeURIComponent(key), encodeURIComponent(value)] as const)
    .sort(([ka, va], [kb, vb]) => (ka === kb ? va.localeCompare(vb) : ka.localeCompare(kb)))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const canonicalRequest = [
    input.method.toUpperCase(),
    url.pathname || "/",
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${input.credentials.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, input.service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
