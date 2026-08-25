import { describe, expect, it } from "vitest";
import {
  MEDIA_INPUTS,
  embedMarkup,
  isSafeMediaUrl,
  parseMediaElement,
  toEmbedUrl,
  videoMarkup,
  type MediaInputKind,
} from "../../src/lib/media-embed";

describe("isSafeMediaUrl", () => {
  it("accepts http(s), protocol-relative, and site-relative", () => {
    expect(isSafeMediaUrl("https://example.com/a.mp4")).toBe(true);
    expect(isSafeMediaUrl("http://example.com/a.mp4")).toBe(true);
    expect(isSafeMediaUrl("//example.com/a.mp4")).toBe(true);
    expect(isSafeMediaUrl("/videos/demo.mp4")).toBe(true);
  });

  it("rejects the schemes that would run for every reader", () => {
    // Not a security boundary — Source mode can write anything — but this is the one path where
    // a pasted string becomes markup without anyone reading it first.
    expect(isSafeMediaUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeMediaUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeMediaUrl("vbscript:msgbox")).toBe(false);
    expect(isSafeMediaUrl("  ")).toBe(false);
    expect(isSafeMediaUrl("")).toBe(false);
  });
});

describe("toEmbedUrl", () => {
  it("converts every YouTube share shape people actually paste", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=4KzFe50RQkQ",
      "https://youtube.com/watch?v=4KzFe50RQkQ",
      "https://m.youtube.com/watch?v=4KzFe50RQkQ",
      "https://youtu.be/4KzFe50RQkQ",
      "https://www.youtube.com/shorts/4KzFe50RQkQ",
      "https://www.youtube.com/embed/4KzFe50RQkQ",
    ]) {
      expect(toEmbedUrl(url), url).toEqual({
        provider: "youtube",
        url: "https://www.youtube.com/embed/4KzFe50RQkQ",
      });
    }
  });

  it("finds v= even when it isn't the first query param", () => {
    expect(toEmbedUrl("https://www.youtube.com/watch?list=PL123&v=4KzFe50RQkQ").url).toBe(
      "https://www.youtube.com/embed/4KzFe50RQkQ",
    );
  });

  it("carries a timestamp across instead of dropping it", () => {
    // The one thing the author deliberately chose about the link.
    expect(toEmbedUrl("https://youtu.be/4KzFe50RQkQ?t=90").url).toBe(
      "https://www.youtube.com/embed/4KzFe50RQkQ?start=90",
    );
    expect(toEmbedUrl("https://www.youtube.com/embed/4KzFe50RQkQ?start=42").url).toBe(
      "https://www.youtube.com/embed/4KzFe50RQkQ?start=42",
    );
  });

  it("converts Vimeo and Loom share links", () => {
    expect(toEmbedUrl("https://vimeo.com/123456789")).toEqual({
      provider: "vimeo",
      url: "https://player.vimeo.com/video/123456789",
    });
    expect(toEmbedUrl("https://www.loom.com/share/abc123def456")).toEqual({
      provider: "loom",
      url: "https://www.loom.com/embed/abc123def456",
    });
    expect(toEmbedUrl("https://www.loom.com/embed/abc123def456").url).toBe(
      "https://www.loom.com/embed/abc123def456",
    );
  });

  it("passes anything unrecognized through untouched", () => {
    // Plenty of things are embeddable; guessing wrong is worse than not guessing.
    expect(toEmbedUrl("https://codesandbox.io/embed/xyz")).toEqual({
      provider: null,
      url: "https://codesandbox.io/embed/xyz",
    });
  });
});

describe("markup", () => {
  it("emits the portable shape, not a bespoke component", () => {
    expect(videoMarkup("/videos/demo.mp4")).toBe(
      '<video controls className="w-full aspect-video rounded-xl" src="/videos/demo.mp4"></video>',
    );
    const iframe = embedMarkup("https://www.youtube.com/embed/abc");
    expect(iframe).toContain('src="https://www.youtube.com/embed/abc"');
    expect(iframe).toContain('className="w-full aspect-video rounded-xl"');
    expect(iframe).toContain("allowFullScreen");
  });

  it("percent-encodes a quote so the attribute can't be broken out of", () => {
    // An HTML entity would stay literal inside a JSX string; %22 keeps the URL valid.
    expect(videoMarkup('/a".mp4')).toContain('src="/a%22.mp4"');
    expect(videoMarkup('/a".mp4')).not.toContain('/a".mp4');
  });
});

describe("MEDIA_INPUTS", () => {
  // A meta test in features.test.ts's style: the dialog reads every field, so a kind added with
  // one missing renders a blank label or an unlabelled button rather than failing loudly.
  const kinds: MediaInputKind[] = ["image", "video", "embed"];

  it("covers every kind, with nothing blank", () => {
    expect(Object.keys(MEDIA_INPUTS).sort()).toEqual([...kinds].sort());
    for (const kind of kinds) {
      const copy = MEDIA_INPUTS[kind];
      for (const [field, value] of Object.entries(copy)) {
        expect(value.trim(), `${kind}.${field}`).not.toBe("");
      }
    }
  });

  it("gives each kind its own submit label, so the button says what it does", () => {
    const labels = kinds.map((k) => MEDIA_INPUTS[k].submit);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("parseMediaElement", () => {
  it("reads back what we emit", () => {
    const el = parseMediaElement(videoMarkup("/videos/demo.mp4"));
    expect(el).toMatchObject({
      tag: "video",
      src: "/videos/demo.mp4",
      className: "w-full aspect-video rounded-xl",
    });
    expect(el?.flags).toContain("controls");
  });

  it("reads an iframe, including its boolean attributes", () => {
    const el = parseMediaElement(embedMarkup("https://www.youtube.com/embed/abc", "Demo"));
    expect(el).toMatchObject({ tag: "iframe", src: "https://www.youtube.com/embed/abc", title: "Demo" });
    expect(el?.flags).toContain("allowfullscreen");
  });

  it("reads the hand-written forms real repos use", () => {
    expect(parseMediaElement('<video autoPlay muted loop playsInline src="/v/a.mp4" />')).toMatchObject({
      tag: "video",
      src: "/v/a.mp4",
    });
    expect(parseMediaElement("<iframe src='https://x.com/e' class='w-full'></iframe>")).toMatchObject({
      tag: "iframe",
      src: "https://x.com/e",
      className: "w-full",
    });
  });

  it("keeps `muted` out of the flags when it's written as an assignment", () => {
    const el = parseMediaElement('<video muted={false} src="/v/a.mp4" />');
    expect(el?.flags).not.toContain("muted");
  });

  it("declines anything it can't render faithfully", () => {
    // A <source> list has no single src — better to show the source than approximate it.
    expect(
      parseMediaElement('<video controls>\n  <source src="/v/a.mp4" type="video/mp4" />\n</video>'),
    ).toBeNull();
    expect(parseMediaElement('<video src="/v/a.mp4">Your browser cannot play this.</video>')).toBeNull();
    expect(parseMediaElement("<video controls></video>")).toBeNull(); // no src
    expect(parseMediaElement('<Frame src="/v/a.mp4" />')).toBeNull(); // not a media tag
    expect(parseMediaElement('<video src="javascript:alert(1)" />')).toBeNull();
  });
});
