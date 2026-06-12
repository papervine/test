import { describe, it, expect } from "vitest";
import { gzipSync } from "node:zlib";
import { tarFiles, extractTarGz } from "@/lib/tar";

// Craft tar archives byte-by-byte (the same wire format `git archive` emits) so the
// parser is tested against the real layout, not a fixture we can't read.

function header(
  name: string,
  size: number,
  type: string | number = "0",
  prefix = "",
): Buffer {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, "utf8");
  h.write("0000644\0", 100); // mode
  h.write(size.toString(8).padStart(11, "0") + "\0", 124); // size, octal
  h[156] = typeof type === "number" ? type : type.charCodeAt(0);
  h.write("ustar", 257); // POSIX magic
  if (prefix) h.write(prefix, 345, 155, "utf8");
  return h;
}

function entry(name: string, content: string, type: string | number = "0", prefix = ""): Buffer {
  const data = Buffer.from(content, "utf8");
  const padded = Buffer.alloc(Math.ceil(data.length / 512) * 512);
  data.copy(padded);
  return Buffer.concat([header(name, data.length, type, prefix), padded]);
}

// "<len> <key>=<value>\n" where len counts the whole record including its own digits.
function paxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`;
  let len = body.length + 1;
  while (String(len).length + body.length !== len) len = String(len).length + body.length;
  return `${len}${body}`;
}

const END = Buffer.alloc(1024); // two zero blocks

describe("tarFiles", () => {
  it("yields regular files with their bytes", () => {
    const tar = Buffer.concat([entry("root/docs.json", '{"name":"x"}'), END]);
    const files = [...tarFiles(tar)];
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("root/docs.json");
    expect(files[0].data.toString()).toBe('{"name":"x"}');
  });

  it("skips directories, symlinks, and the pax global header", () => {
    const tar = Buffer.concat([
      entry("root/pax_global_header", "52 comment=abc\n", "g"),
      entry("root/docs/", "", "5"),
      entry("root/link.md", "", "2"),
      entry("root/real.mdx", "# hi"),
      END,
    ]);
    const files = [...tarFiles(tar)];
    expect(files.map((f) => f.path)).toEqual(["root/real.mdx"]);
  });

  it("joins the ustar prefix field for long-ish paths", () => {
    const tar = Buffer.concat([entry("page.mdx", "deep", "0", "root/very/deep/dir"), END]);
    expect([...tarFiles(tar)][0].path).toBe("root/very/deep/dir/page.mdx");
  });

  it("applies a pax extended header's path to the next entry only", () => {
    const longPath = "root/" + "sub/".repeat(70) + "page.mdx"; // >255 chars → pax
    const tar = Buffer.concat([
      entry("root/PaxHeaders/page.mdx", paxRecord("path", longPath), "x"),
      entry("root/truncated-name.mdx", "long one"),
      entry("root/normal.mdx", "normal"),
      END,
    ]);
    const files = [...tarFiles(tar)];
    expect(files[0].path).toBe(longPath);
    expect(files[0].data.toString()).toBe("long one");
    expect(files[1].path).toBe("root/normal.mdx"); // override consumed, not sticky
  });

  it("pads data to 512-byte blocks without bleeding into the next entry", () => {
    const tar = Buffer.concat([
      entry("root/a.md", "x".repeat(513)), // spans two data blocks
      entry("root/b.md", "y"),
      END,
    ]);
    const files = [...tarFiles(tar)];
    expect(files[0].data.length).toBe(513);
    expect(files[1].data.toString()).toBe("y");
  });

  it("stops at the end-of-archive zero block", () => {
    const tar = Buffer.concat([END, entry("root/after-end.md", "ghost")]);
    expect([...tarFiles(tar)]).toHaveLength(0);
  });
});

describe("extractTarGz", () => {
  it("gunzips and strips the GitHub root directory", () => {
    const tar = Buffer.concat([
      entry("owner-repo-abc123/docs.json", "{}"),
      entry("owner-repo-abc123/guides/intro.mdx", "# intro"),
      END,
    ]);
    const files = extractTarGz(gzipSync(tar), { stripRoot: true });
    expect(files.map((f) => f.path)).toEqual(["docs.json", "guides/intro.mdx"]);
    expect(files[1].data.toString()).toBe("# intro");
  });

  it("keeps full paths when stripRoot is off", () => {
    const tar = Buffer.concat([entry("a/b.md", "hi"), END]);
    expect(extractTarGz(gzipSync(tar)).map((f) => f.path)).toEqual(["a/b.md"]);
  });
});
