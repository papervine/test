import { describe, expect, it } from "vitest";
import {
  UPLOAD_KINDS,
  draftAssetKey,
  draftAssetPrefix,
  extensionOf,
  isUploadKindPath,
  mergeMediaListing,
  parseStorageError,
  storageOrigin,
  uploadThrewMessage,
  uploadTargetPath,
  validateUpload,
} from "../../src/lib/media-upload";

describe("draft asset keys", () => {
  it("mirror the live layout with the prefix swapped, so publishing is a copy", () => {
    expect(draftAssetPrefix("sess1")).toBe("drafts/sess1/");
    expect(draftAssetKey("sess1", "videos/demo.mp4")).toBe("drafts/sess1/videos/demo.mp4");
  });
});

describe("extensionOf", () => {
  it("reads the extension off a bare name or a full path", () => {
    expect(extensionOf("demo.MP4")).toBe("mp4");
    expect(extensionOf("/Users/me/My Clips/demo.webm")).toBe("webm");
    expect(extensionOf("C:\\videos\\demo.mp4")).toBe("mp4");
    expect(extensionOf("archive.tar.gz")).toBe("gz");
  });

  it("returns nothing for a name with no extension", () => {
    expect(extensionOf("README")).toBe("");
    // A dotfile is a name, not an extension.
    expect(extensionOf(".gitignore")).toBe("");
  });
});

describe("validateUpload", () => {
  it("accepts the formats browsers actually play", () => {
    expect(validateUpload("video", "demo.mp4", 1024)).toEqual({ ok: true });
    expect(validateUpload("video", "demo.WEBM", 1024)).toEqual({ ok: true });
  });

  it("refuses a format that would upload and then fail to play", () => {
    const result = validateUpload("video", "demo.mov", 1024);
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("MP4 or WebM");
  });

  it("goes by extension, not the browser's reported type", () => {
    // The MIME type is client-supplied and often wrong or missing; the extension is what
    // decides the stored content type downstream, so it's the one thing checked.
    expect(validateUpload("video", "clip", 1024)).toHaveProperty("error");
  });

  it("refuses an empty file and one over the cap, naming the numbers", () => {
    expect(validateUpload("video", "demo.mp4", 0)).toHaveProperty("error");
    const tooBig = validateUpload("video", "demo.mp4", UPLOAD_KINDS.video.maxBytes + 1);
    expect((tooBig as { error: string }).error).toContain("200");
  });

  it("has its own rules per kind", () => {
    expect(validateUpload("image", "hero.png", 1024)).toEqual({ ok: true });
    expect(validateUpload("image", "hero.mp4", 1024)).toHaveProperty("error");
    expect(validateUpload("video", "demo.png", 1024)).toHaveProperty("error");
  });
});

describe("uploadTargetPath", () => {
  it("slugifies the name, because it becomes part of a public URL", () => {
    expect(uploadTargetPath("video", "My Great Clip.mp4")).toBe("videos/my-great-clip.mp4");
    expect(uploadTargetPath("video", "weird#name (final).webm")).toBe("videos/weird-name-final.webm");
    expect(uploadTargetPath("image", "/tmp/Hero Image.PNG")).toBe("images/hero-image.png");
  });

  it("still produces a filename when the name slugifies to nothing", () => {
    expect(uploadTargetPath("video", "!!!.mp4")).toBe("videos/video.mp4");
    expect(uploadTargetPath("video", "日本語.mp4")).toBe("videos/video.mp4");
  });

  it("suffixes a collision instead of overwriting a file still in use elsewhere", () => {
    const taken = ["videos/demo.mp4", "videos/demo-2.mp4"];
    expect(uploadTargetPath("video", "demo.mp4", taken)).toBe("videos/demo-3.mp4");
  });

  it("treats a different extension as a different file", () => {
    expect(uploadTargetPath("video", "demo.webm", ["videos/demo.mp4"])).toBe("videos/demo.webm");
  });

  it("returns null for a kind that can't hold that extension", () => {
    expect(uploadTargetPath("video", "notes.txt")).toBeNull();
  });
});

describe("isUploadKindPath", () => {
  it("filters by what the kind can hold", () => {
    expect(isUploadKindPath("video", "videos/demo.mp4")).toBe(true);
    expect(isUploadKindPath("video", "images/hero.png")).toBe(false);
    // Directory is irrelevant — a video committed anywhere still plays.
    expect(isUploadKindPath("video", "assets/deep/clip.webm")).toBe(true);
  });
});

describe("parseStorageError", () => {
  it("surfaces the code and message S3/MinIO already told us", () => {
    const body =
      '<?xml version="1.0" encoding="UTF-8"?><Error><Code>SignatureDoesNotMatch</Code>' +
      "<Message>The request signature we calculated does not match</Message></Error>";
    expect(parseStorageError(body)).toBe(
      "SignatureDoesNotMatch: The request signature we calculated does not match",
    );
  });

  it("takes the code alone when there's no message", () => {
    expect(parseStorageError("<Error><Code>RequestTimeTooSkewed</Code></Error>")).toBe(
      "RequestTimeTooSkewed",
    );
  });

  it("falls back to an excerpt for a non-XML body, e.g. a proxy's error page", () => {
    expect(parseStorageError("<html><body>502 Bad Gateway</body></html>")).toContain("502 Bad Gateway");
  });

  it("returns null for an empty body rather than an empty detail", () => {
    expect(parseStorageError("")).toBeNull();
    expect(parseStorageError("   \n ")).toBeNull();
  });
});

describe("uploadThrewMessage", () => {
  it("explains the one error browsers refuse to explain", () => {
    // A blocked cross-origin request is reported as a bare "Failed to fetch" on purpose, so the
    // only way to be useful is to name what it actually means and where the request went.
    const msg = uploadThrewMessage(new TypeError("Failed to fetch"), "https://storage.example.com");
    expect(msg).toContain("storage.example.com");
    expect(msg).toContain("CORS");
    expect(msg).not.toContain("Failed to fetch");
  });

  it("covers the other browsers' wording for the same failure", () => {
    // Safari says "Load failed"; Firefox says "NetworkError".
    expect(uploadThrewMessage(new TypeError("Load failed"), null)).toContain("CORS");
    expect(uploadThrewMessage(new Error("NetworkError when attempting to fetch"), null)).toContain("CORS");
  });

  it("passes a real error's message through instead of guessing", () => {
    expect(uploadThrewMessage(new Error("Boom"), null)).toBe("Upload failed: Boom");
    expect(uploadThrewMessage("weird", null)).toBe("Upload failed: weird");
  });
});

describe("storageOrigin", () => {
  it("reduces a presigned URL to the host it points at", () => {
    expect(storageOrigin("http://127.0.0.1:9000/bucket/key?X-Amz-Signature=abc")).toBe(
      "http://127.0.0.1:9000",
    );
  });

  it("returns null rather than throwing on a non-URL", () => {
    expect(storageOrigin("not a url")).toBeNull();
  });
});

describe("mergeMediaListing", () => {
  const published = ["videos/a.mp4", "videos/b.webm", "images/hero.png", "guides/intro.mdx"];

  it("lists only media of the asked-for kind", () => {
    expect(mergeMediaListing("video", published, [])).toEqual(["videos/a.mp4", "videos/b.webm"]);
    expect(mergeMediaListing("image", published, [])).toEqual(["images/hero.png"]);
  });

  it("includes draft uploads that aren't published yet", () => {
    expect(mergeMediaListing("video", published, [{ path: "videos/new.mp4", deleted: false }])).toEqual([
      "videos/a.mp4",
      "videos/b.webm",
      "videos/new.mp4",
    ]);
  });

  it("doesn't double-list a re-upload of an existing path", () => {
    expect(mergeMediaListing("video", published, [{ path: "videos/a.mp4", deleted: false }])).toEqual([
      "videos/a.mp4",
      "videos/b.webm",
    ]);
  });

  it("hides a file the draft deleted — the picker shows what the page would use today", () => {
    expect(mergeMediaListing("video", published, [{ path: "videos/a.mp4", deleted: true }])).toEqual([
      "videos/b.webm",
    ]);
  });
});
