#!/usr/bin/env node
/**
 * Record the looping "browsing the docs" clip the marketing home shows on phones.
 *
 * The home page frames a REAL docs site in an iframe, which is the whole argument of that
 * section — but only above `md`. On a phone the frame is useless: a desktop docs layout squeezed
 * into 340px is unreadable, and a phone-width one loses the sidebar and the search button (both
 * are `md:`-gated in the renderer), so it would show a page you can only scroll. So phones get a
 * short silent loop of someone browsing the same site at desktop proportions instead.
 *
 * This is a SCREEN RECORDING of the live site, not an animation of a mock: it can't drift from
 * what we ship, and re-recording it is one command. Re-run it whenever the docs chrome changes
 * enough that the clip looks dated.
 *
 *   node scripts/record-docs-loop.mjs                       # records docs.papervine.io
 *   node scripts/record-docs-loop.mjs --url http://localhost:3001/sites/starter
 *
 * Needs ffmpeg on PATH (`brew install ffmpeg`). Writes into `out/marketing/` (gitignored) and
 * prints the two upload commands: like the product tour, the clip lives in the public R2 media
 * bucket rather than in git — R2 egress is free, and a marketing asset that gets re-recorded
 * whenever the docs chrome moves would otherwise add a fresh binary to history each time.
 *
 * `--remote` is not optional in the printed commands: without it wrangler writes to a LOCAL
 * simulated bucket and still prints "Upload complete."
 */
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  // Worth the four lines: without it, `--help` fell through and spent half a minute recording.
  console.log("usage: node scripts/record-docs-loop.mjs [--url <docs site>] [--name <basename>]");
  process.exit(0);
}
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const URL_ = flag("url", "https://docs.papervine.io/");
// Matches the object names live in the bucket, so a re-record overwrites the right pair.
const NAME = flag("name", "browse");
// `/out` is gitignored; nothing here is committed.
const OUT_DIR = path.join(ROOT, "out", "marketing");
const OUT_MP4 = path.join(OUT_DIR, `${NAME}.mp4`);
const OUT_POSTER = path.join(OUT_DIR, `${NAME}.png`);

// The public media bucket — the same one the product tour is served from (video/README.md).
// Not hardcoded, because the bucket name isn't recorded anywhere in this repo (only its r2.dev
// origin is): pass `--bucket`, or `npx wrangler r2 bucket list` to remind yourself.
const R2_BUCKET = flag("bucket", process.env.PAPERVINE_MEDIA_BUCKET ?? "<bucket>");

// Recorded at desktop proportions on purpose (see the header): the phone shows it scaled down
// and clipped, so what has to survive is the SHAPE of a docs site — sidebar, tabs, content,
// table of contents — not legible body text.
const SIZE = { width: 1280, height: 800 };

/**
 * A drawn cursor, because a screen recording has none. Injected through addInitScript so it
 * survives a full document load; a client-side nav can't remove it either, since it hangs off
 * <body> outside React's root.
 */
const CURSOR = () => {
  const ensure = () => {
    let el = document.getElementById("__pv_cursor");
    if (!el) {
      el = document.createElement("div");
      el.id = "__pv_cursor";
      el.style.cssText =
        "position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;" +
        "pointer-events:none;transition:transform 620ms cubic-bezier(.4,0,.2,1);" +
        "will-change:transform;filter:drop-shadow(0 2px 5px rgba(0,0,0,.4))";
      el.innerHTML =
        '<svg viewBox="0 0 24 24" width="22" height="22" fill="none">' +
        '<path d="M5 2.5 18.5 11l-6.2 1.2L9.8 19z" fill="#fff" stroke="#111" ' +
        'stroke-width="1.5" stroke-linejoin="round"/></svg>';
      document.body.appendChild(el);
    }
    return el;
  };
  const at = (x, y, scale) => {
    const el = ensure();
    el.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  };
  window.__pvMove = (x, y) => {
    const el = ensure();
    el.style.transition = "transform 620ms cubic-bezier(.4,0,.2,1)";
    at(x, y, 1);
  };
  window.__pvPress = (x, y) => {
    const el = ensure();
    // The move transition would stretch the click into a slow squash; the press gets its own.
    el.style.transition = "transform 110ms ease-out";
    at(x, y, 0.78);
    setTimeout(() => at(x, y, 1), 130);
  };
  window.__pvShow = ensure;
};

const run = (cmd, argv) => {
  const r = spawnSync(cmd, argv, { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${cmd} exited ${r.status ?? "on a signal"}`);
};

async function main() {
  const raw = await mkdtemp(path.join(tmpdir(), "pv-docs-loop-"));
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: SIZE,
    // 1x: the clip is displayed at roughly half size, so a 2x record would quadruple the
    // encode for detail the phone throws away.
    deviceScaleFactor: 1,
    recordVideo: { dir: raw, size: SIZE },
    // Dark, to sit on the marketing band rather than punch a white hole in it.
    colorScheme: "dark",
    reducedMotion: "no-preference",
  });
  await context.addInitScript(CURSOR);
  // `colorScheme` alone only covers a site whose appearance default is `system`. The renderer's
  // pre-paint script (appearanceInitScript) reads localStorage['theme'] first, and that is what
  // actually decides — so set it, and set it in an INIT script, or the first paint is light and
  // the clip opens on a white flash.
  await context.addInitScript(() => {
    try {
      localStorage.setItem("theme", "dark");
    } catch {}
  });
  const page = await context.newPage();

  const hold = (ms) => page.waitForTimeout(ms);

  /** Glide the drawn cursor (and the real one, so hover states light up) onto a target. */
  const moveTo = async (locator) => {
    const box = await locator.boundingBox();
    if (!box) throw new Error("target has no box — the site's chrome moved, fix the step");
    const x = Math.round(box.x + box.width / 2);
    const y = Math.round(box.y + box.height / 2);
    await page.evaluate(([px, py]) => window.__pvMove(px - 3, py - 2), [x, y]);
    await page.mouse.move(x, y);
    await hold(700);
    return [x, y];
  };

  const clickOn = async (locator) => {
    const [x, y] = await moveTo(locator);
    await page.evaluate(([px, py]) => window.__pvPress(px - 3, py - 2), [x, y]);
    await hold(140);
    await locator.click();
  };

  const scrollBy = async (dy) => {
    await page.evaluate((d) => window.scrollBy({ top: d, behavior: "smooth" }), dy);
    await hold(1400);
  };

  // ---------------------------------------------------------------- the browse
  await page.goto(URL_, { waitUntil: "networkidle" });
  await page.evaluate(() => window.__pvShow());
  await hold(1100);

  // 1. Search — the thing every docs reader reaches for first, and one of the two affordances
  //    a phone-width recording of the same site would not have been able to show at all.
  await clickOn(page.getByRole("button", { name: /Search/ }));
  await hold(450);
  // Typed briskly, and then we WAIT FOR A RESULT ROW rather than for a fixed time. Search here
  // is a request per keystroke (debounced), and the dialog's empty state reads "No results for
  // …" while one is in flight — so a fixed hold recorded that message sitting on screen for a
  // second and a half, which is the opposite of the point. Holding on the rows instead means the
  // clip dwells on the answer, and a slow round trip lengthens the clip rather than spoiling it.
  await page.keyboard.type("reader auth", { delay: 45 });
  const firstHit = page.locator("li button[data-active]").first();
  await firstHit.waitFor({ state: "visible", timeout: 10_000 });
  await hold(1300);
  await clickOn(firstHit);
  await page.waitForLoadState("networkidle");
  await hold(900);

  // 2. Read a bit of the page it landed on.
  await scrollBy(620);
  await hold(500);

  // 3. Then navigate the way a browsing reader does, from the sidebar.
  await clickOn(page.getByRole("link", { name: "Quickstart", exact: true }).first());
  await page.waitForLoadState("networkidle");
  await hold(900);
  await scrollBy(520);
  await hold(700);

  // 4. Home, back to the exact frame the clip opened on, so the loop seam doesn't jump.
  await clickOn(page.getByRole("link", { name: "Papervine", exact: true }).first());
  await page.waitForLoadState("networkidle");
  await hold(1500);

  await context.close();
  await browser.close();

  // ---------------------------------------------------------------- encode
  const recorded = (await readdir(raw)).find((f) => f.endsWith(".webm"));
  if (!recorded) throw new Error("playwright wrote no video");
  const src = path.join(raw, recorded);

  await mkdir(OUT_DIR, { recursive: true });
  // Mostly-static screen content, so h264 at a high CRF still looks clean — and keeping it
  // small matters even on free egress, because a phone on cellular pays for every byte.
  run("ffmpeg", [
    "-y", "-loglevel", "error", "-i", src,
    "-an",
    "-vf", `fps=25,scale=${SIZE.width}:-2:flags=lanczos`,
    "-c:v", "libx264", "-preset", "slow", "-crf", "31", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    OUT_MP4,
  ]);
  // The poster is the first frame, so the clip's own opening frame is what shows before it
  // plays — no visible swap when playback starts.
  run("ffmpeg", ["-y", "-loglevel", "error", "-i", OUT_MP4, "-frames:v", "1", OUT_POSTER]);

  await rm(raw, { recursive: true, force: true });

  const put = (file, type) =>
    `npx wrangler r2 object put ${R2_BUCKET}/${path.basename(file)} \\\n` +
    `  --file ${path.relative(ROOT, file)} --content-type ${type} --remote`;

  console.log(`\nrecorded ${URL_} → ${path.relative(ROOT, OUT_MP4)} + poster\n`);
  console.log("upload both to the public media bucket, then point CLIP/POSTER in");
  console.log("src/components/home/DocsLoop.tsx at the new filenames:\n");
  if (R2_BUCKET === "<bucket>") {
    console.log("# `npx wrangler r2 bucket list` for the name, then re-run with --bucket <name>");
  }
  console.log(put(OUT_MP4, "video/mp4"));
  console.log(put(OUT_POSTER, "image/png"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
