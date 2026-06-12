import { gunzipSync } from "node:zlib";

// Minimal tar reader for GitHub repo tarballs (sync.ts). GitHub serves `git archive`
// output: gzipped, pax-format tar. We need exactly three things from it — file path,
// file bytes, skip everything else — so a ~60-line parser beats a tar dependency (and
// stays unit-testable: tests/unit/tar.test.ts crafts archives byte-by-byte). Pure module
// (no server-only) for that reason.
//
// Format notes (POSIX ustar/pax): 512-byte header blocks; `name` at 0..100 with an
// optional `prefix` at 345..500 for long paths; size as octal at 124..136; entry type at
// 156. Data follows, padded to 512. Paths >255 chars arrive as a pax extended header
// (type 'x') whose data holds "len path=value\n" records overriding the NEXT entry's
// path. `git archive` also emits a pax global header (type 'g', the commit comment) —
// skipped. Two all-zero blocks end the archive.

export type TarEntry = { path: string; data: Buffer };

// Bytes up to the first NUL, as UTF-8 (pax path records are UTF-8; header names too).
function readString(buf: Buffer, start: number, length: number): string {
  const slice = buf.subarray(start, start + length);
  const nul = slice.indexOf(0);
  return slice.subarray(0, nul === -1 ? length : nul).toString("utf8");
}

// Pax data is a sequence of "<len> <key>=<value>\n" records where <len> counts the whole
// record including its own digits. Returns the `path` override, if present.
function parsePaxPath(data: Buffer): string | null {
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    if (space === -1) return null;
    const len = parseInt(data.subarray(offset, space).toString("ascii"), 10);
    if (!Number.isInteger(len) || len <= 0) return null;
    const record = data.subarray(space + 1, offset + len).toString("utf8");
    const eq = record.indexOf("=");
    if (eq !== -1 && record.slice(0, eq) === "path") {
      return record.slice(eq + 1).replace(/\n$/, "");
    }
    offset += len;
  }
  return null;
}

// Iterate a (decompressed) tar's regular files. Lenient by design: no checksum/magic
// validation — we only ever feed it GitHub's own archives, and a malformed header just
// ends iteration at the zero-block check.
export function* tarFiles(tar: Buffer): Generator<TarEntry> {
  let offset = 0;
  let paxPath: string | null = null;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break; // end-of-archive marker
    const size = parseInt(readString(header, 124, 12).trim(), 8) || 0;
    const type = header[156];
    const body = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512; // data is padded to whole blocks

    if (type === 0x78 /* 'x' */) {
      paxPath = parsePaxPath(body) ?? paxPath;
      continue;
    }
    // Regular file is '0' or NUL; everything else (dirs '5', symlinks '2', global pax
    // 'g', GNU extensions) is skipped — a docs sync has no use for them.
    if (type !== 0x30 && type !== 0) {
      paxPath = null;
      continue;
    }
    const name = readString(header, 0, 100);
    const prefixField = readString(header, 345, 155);
    const path = paxPath ?? (prefixField ? `${prefixField}/${name}` : name);
    paxPath = null;
    if (path) yield { path, data: body };
  }
}

/**
 * Decompress and list a .tar.gz's regular files. GitHub tarball entries are rooted in a
 * `{owner}-{repo}-{shortsha}/` directory; pass stripRoot to drop that first segment so
 * paths are repo-relative (entries without a "/" — none in practice — are dropped).
 */
export function extractTarGz(gz: Buffer, opts?: { stripRoot?: boolean }): TarEntry[] {
  const tar = gunzipSync(gz);
  const out: TarEntry[] = [];
  for (const entry of tarFiles(tar)) {
    if (opts?.stripRoot) {
      const slash = entry.path.indexOf("/");
      if (slash === -1) continue;
      const path = entry.path.slice(slash + 1);
      if (path) out.push({ path, data: entry.data });
    } else {
      out.push(entry);
    }
  }
  return out;
}
