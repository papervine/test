import "server-only";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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

/**
 * A short-lived URL the BROWSER can PUT straight to, bypassing this app entirely.
 *
 * Necessary rather than convenient: a Route Handler on Vercel caps the request body at a few MB,
 * which a video clears immediately — so bytes uploaded through us would fail at exactly the sizes
 * this exists for. The trade-off is that the bucket needs CORS for the app's origin; MinIO allows
 * any origin by default, so local dev works untouched.
 *
 * The content type is signed in, so a client can't upload one thing and have it served as another.
 */
export async function presignPut(
  key: string,
  contentType: string,
  expiresInSeconds = 900,
): Promise<string> {
  return getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }),
    { expiresIn: expiresInSeconds },
  );
}

/** Does this key exist, and how big is it? Used to confirm a presigned upload actually landed
 *  before anything records it as a change. */
export async function headObject(key: string): Promise<{ size: number } | null> {
  try {
    const res = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return { size: res.ContentLength ?? 0 };
  } catch {
    return null;
  }
}

/** Server-side copy — the bytes never travel through this process. Publishing an uploaded asset
 *  is exactly this: the same object, one prefix over. */
export async function copyObject(fromKey: string, toKey: string): Promise<void> {
  await s3.send(
    new CopyObjectCommand({
      Bucket: BUCKET,
      // The source is bucket-qualified and must be URI-encoded: a key with a space or a `+`
      // silently copies the wrong object (or 404s) otherwise.
      CopySource: encodeURI(`${BUCKET}/${fromKey}`),
      Key: toKey,
    }),
  );
}

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

/**
 * Delete every object under a prefix. Used when a site/org is deleted (SPEC §10.5) — the
 * Postgres FK cascade drops the rows, but object storage has no cascade, so the synced
 * content (sites/{id}/…) must be swept explicitly or it leaks. Batches by 1000 (the
 * S3 DeleteObjects cap). Best-effort and idempotent: an empty prefix is a no-op.
 */
export async function deletePrefix(prefix: string): Promise<void> {
  await deleteKeys(await listKeys(prefix));
}

/**
 * Delete an explicit set of object keys. Used by the sync to sweep docs files that vanished
 * from the repo (object storage has no cascade). Batches by 1000 (the S3 DeleteObjects cap).
 * Best-effort and idempotent: an empty list is a no-op.
 */
export async function deleteKeys(keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) {
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })) },
      }),
    );
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
