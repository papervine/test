// One-off R2 PutObject debug. Reads S3_* from --env-file (.env.r2.local).
// Dumps the FULL SignatureDoesNotMatch body — R2 echoes the AWSAccessKeyId it
// received and the StringToSign, which tells us wrong-secret vs canonical mismatch.
// Run: node --env-file=.env.r2.local scripts/r2-debug.mjs
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const cfg = {
  region: process.env.S3_REGION ?? "auto",
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true,
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
  },
};
const BUCKET = process.env.S3_BUCKET ?? "papervine-content";

// Show exactly what we're sending — lengths catch trailing-newline/truncation.
console.log("endpoint   :", JSON.stringify(cfg.endpoint));
console.log("region     :", JSON.stringify(cfg.region));
console.log("bucket     :", JSON.stringify(BUCKET));
console.log("accessKeyId:", JSON.stringify(cfg.credentials.accessKeyId), "len", cfg.credentials.accessKeyId.length);
console.log("secret len :", cfg.credentials.secretAccessKey.length,
  "| has whitespace:", /\s/.test(cfg.credentials.secretAccessKey));
console.log("---");

const s3 = new S3Client(cfg);
try {
  const out = await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: "debug/ping.txt", Body: "ping", ContentType: "text/plain",
  }));
  console.log("✅ PutObject OK", out.$metadata.httpStatusCode, "etag", out.ETag);
} catch (err) {
  console.log("❌", err.name, "-", err.message);
  console.log("httpStatus:", err.$metadata?.httpStatusCode);
  // The interesting bits R2 returns on a sig mismatch:
  for (const k of ["AWSAccessKeyId", "StringToSign", "CanonicalRequest", "Code", "Resource", "Region"]) {
    if (err[k] !== undefined) console.log(`${k}:`, err[k]);
  }
  // Raw body fallback if the SDK didn't parse those fields out.
  const body = err.$response?.body;
  if (body && typeof body.transformToString === "function") {
    console.log("raw body:\n" + (await body.transformToString()));
  }
}
