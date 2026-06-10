import { describe, it, expect } from "vitest";
import { detectAgent } from "@/lib/ua-detect";

describe("detectAgent", () => {
  it("names known AI crawlers/fetchers", () => {
    expect(detectAgent("Mozilla/5.0 (compatible; ClaudeBot/1.0; +https://anthropic.com/bot)"))
      .toEqual({ isAgent: true, name: "Claude" });
    expect(detectAgent("Claude-User/1.0").name).toBe("Claude");
    expect(detectAgent("Mozilla/5.0 (compatible; GPTBot/1.1; +https://openai.com/gptbot)").name)
      .toBe("ChatGPT");
    expect(detectAgent("ChatGPT-User/1.0").name).toBe("ChatGPT");
    expect(detectAgent("PerplexityBot/1.0").name).toBe("Perplexity");
    expect(detectAgent("Mozilla/5.0 (compatible; Google-Extended)").name).toBe("Gemini");
  });

  it("falls back to 'Other' for generic non-browser clients", () => {
    expect(detectAgent("curl/8.4.0")).toEqual({ isAgent: true, name: "Other" });
    expect(detectAgent("python-requests/2.31.0").name).toBe("Other");
    expect(detectAgent("some-random-crawler/2.0").name).toBe("Other");
  });

  it("treats real browsers as humans (not agents)", () => {
    const chrome =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
    expect(detectAgent(chrome)).toEqual({ isAgent: false, name: "" });
    const safariMobile =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    expect(detectAgent(safariMobile).isAgent).toBe(false);
  });

  it("handles missing UA", () => {
    expect(detectAgent(null)).toEqual({ isAgent: false, name: "" });
    expect(detectAgent(undefined).isAgent).toBe(false);
    expect(detectAgent("").isAgent).toBe(false);
  });
});
