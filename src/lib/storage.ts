import "server-only";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

// Object storage over the S3 API. Local = MinIO, prod = Cloudflare R2 — same code,
// only env changes (SPEC §3.1, §11). forcePathStyle is required by MinIO and fine
// for R2. Stores per-tenant content + assets written by the sync job (SPEC §3).
const BUCKET = process.env.S3_BUCKET ?? "papervine-content";

const s3 = new S3Client({
  region: process.env.S3_REGION ?? "auto",
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true,
  // AWS SDK v3 >=3.729 defaults requestChecksumCalculation to "WHEN_SUPPORTED",
  // which adds a CRC32 trailer (STREAMING-UNSIGNED-PAYLOAD-TRAILER). R2 signs that
  // canonical request differently than the SDK and rejects PutObject with
  // SignatureDoesNotMatch (MinIO tolerates it, so local works and prod doesn't).
  // "WHEN_REQUIRED" restores pre-3.729 behavior. See SPEC §3.1.
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
  },
});

export async function putObject(key: string, body: Uint8Array | string, contentType?: string) {
  await s3.send(
    new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }),
  );
}

/** Fetch an object as text, or null if it doesn't exist. */
export async function getObjectText(key: string): Promise<string | null> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    return (await res.Body?.transformToString()) ?? null;
  } catch (err) {
    if ((err as { name?: string }).name === "NoSuchKey") return null;
    throw err;
  }
}

/** Fetch an object as bytes + content-type, or null if it doesn't exist. */
export async function getObjectBytes(
  key: string,
): Promise<{ body: Uint8Array; contentType?: string } | null> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const body = await res.Body?.transformToByteArray();
    return body ? { body, contentType: res.ContentType } : null;
  } catch (err) {
    if ((err as { name?: string }).name === "NoSuchKey") return null;
    throw err;
  }
}

/** List object keys under a prefix (handles pagination). */
export async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }),
    );
    for (const o of res.Contents ?? []) if (o.Key) keys.push(o.Key);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}
