import { describe, expect, it } from "vitest";
import type { ComponentType } from "react";
import {
  LITERAL_MEDIA_COMPONENTS,
  applyTenantUrls,
} from "../../packages/renderer/lib/mdx-runtime";

// Media in MDX is raw HTML — the docs.json-compatible schema has no video component — so
// `<video>` and `<source>` arrive as INTRINSIC elements, which compile to a bare `_jsx("video")`
// and bypass the components map entirely. Nothing tenant-scoped their src, so on every surface
// that sets an assetBase *because* root-relative isn't the tenant there — path-based serving and
// the editor's draft preview — a video resolved against the wrong host and 404'd, while the
// markdown image beside it worked.
//
// The fix is the trick literal `<img>` already needed: a remark plugin renames the element to a
// capitalized synthetic name (`video` → `PvVideo`) so the compiler emits
// `_jsx(_components.PvVideo)`, which is the only way the map can reach it. These tests cover the
// map; the rename is covered by the `/media` smoke fixture and the draft-preview check in SPEC.
//
// Asserted on the returned components map rather than through a render: these are plain functions
// of props, so calling one and reading the element's props is the whole behaviour.

const ASSET_BASE = "/api/tenant-asset/acme";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function propsOf(map: Record<string, any>, name: string, props: Record<string, unknown>) {
  const Comp = map[name] as ComponentType<Record<string, unknown>> | undefined;
  expect(Comp, `no override registered for <${name}>`).toBeTruthy();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (Comp as any)(props).props as Record<string, unknown>;
}

const M = LITERAL_MEDIA_COMPONENTS;

describe("applyTenantUrls — media", () => {
  const withAssetBase = () => applyTenantUrls({}, "", ASSET_BASE, {});

  it("prefixes a root-relative video src", () => {
    expect(propsOf(withAssetBase(), M.video, { src: "/videos/demo.mp4" }).src).toBe(
      `${ASSET_BASE}/videos/demo.mp4`,
    );
  });

  it("prefixes the poster too — a broken still over a working video is still broken", () => {
    const props = propsOf(withAssetBase(), M.video, {
      src: "/videos/demo.mp4",
      poster: "/images/still.png",
    });
    expect(props.poster).toBe(`${ASSET_BASE}/images/still.png`);
  });

  it("prefixes <source>, the form where the video carries no src at all", () => {
    expect(propsOf(withAssetBase(), M.source, { src: "/videos/demo.webm" }).src).toBe(
      `${ASSET_BASE}/videos/demo.webm`,
    );
  });

  it("prefixes audio and a self-hosted iframe", () => {
    expect(propsOf(withAssetBase(), M.audio, { src: "/audio/clip.mp3" }).src).toBe(
      `${ASSET_BASE}/audio/clip.mp3`,
    );
    expect(propsOf(withAssetBase(), M.iframe, { src: "/embeds/thing.html" }).src).toBe(
      `${ASSET_BASE}/embeds/thing.html`,
    );
  });

  it("leaves anything that isn't a same-origin path alone", () => {
    const map = withAssetBase();
    // A YouTube embed must not be rewritten into our own asset route.
    expect(propsOf(map, M.iframe, { src: "https://www.youtube.com/embed/abc" }).src).toBe(
      "https://www.youtube.com/embed/abc",
    );
    expect(propsOf(map, M.video, { src: "//cdn.example.com/a.mp4" }).src).toBe(
      "//cdn.example.com/a.mp4",
    );
    // Relative to the page, not to the site root.
    expect(propsOf(map, M.video, { src: "clips/a.mp4" }).src).toBe("clips/a.mp4");
  });

  it("carries every other attribute through", () => {
    const props = propsOf(withAssetBase(), M.video, {
      src: "/videos/demo.mp4",
      controls: true,
      className: "w-full aspect-video rounded-xl",
    });
    expect(props.controls).toBe(true);
    expect(props.className).toBe("w-full aspect-video rounded-xl");
  });

  it("renders back as the real tag, not as the synthetic name", () => {
    const map = withAssetBase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((map[M.video] as any)({ src: "/videos/demo.mp4" }).type).toBe("video");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((map[M.source] as any)({ src: "/videos/demo.mp4" }).type).toBe("source");
  });

  it("still renders the element on a tenant host, where the rewrite is a no-op", () => {
    // Registered even with no base. By this point the element has been RENAMED, so if the map
    // didn't hold these names the compiler's unknown-component Fallback would render children
    // only — and the video would silently vanish on the published site. That's the real hazard
    // of the rename, and this is the guard for it.
    const hostMode = applyTenantUrls({}, "", "", {});
    expect(hostMode[M.video]).toBeTruthy();
    expect(propsOf(hostMode, M.video, { src: "/videos/demo.mp4" }).src).toBe("/videos/demo.mp4");
  });
});
