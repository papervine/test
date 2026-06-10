// AI-agent detection from a request User-Agent (SPEC §10.1, Agents analytics). Pure
// and dependency-free so it runs in route handlers AND unit-tests in isolation. We
// classify the well-known docs-reading crawlers/fetchers by name (drives the Agents
// tab "Top agents" breakdown), and fall back to a generic "Other" for anything that
// is clearly a non-browser client. A normal browser UA returns isAgent:false — those
// requests are humans and stay on the human side of the split (the JS page-view beacon).

export interface AgentDetection {
  /** True when the UA looks like an AI/crawler/non-browser client, not a person's browser. */
  isAgent: boolean;
  /** Friendly agent name for known agents, "Other" for generic bots, "" when not an agent. */
  name: string;
}

// Ordered: first match wins. Named AI agents before the generic bot fallback so e.g.
// "ClaudeBot" reports as "Claude", not "Other". Patterns match Anthropic/OpenAI/etc.
// published crawler + fetcher UAs (ClaudeBot, Claude-User, GPTBot, ChatGPT-User, …).
const NAMED: Array<{ name: string; re: RegExp }> = [
  { name: "Claude", re: /claudebot|claude-user|claude-web|anthropic/i },
  { name: "ChatGPT", re: /gptbot|chatgpt-user|oai-searchbot|openai/i },
  { name: "Perplexity", re: /perplexitybot|perplexity/i },
  { name: "Gemini", re: /google-extended|googleother|gemini|bard/i },
  { name: "Cursor", re: /\bcursor\b/i },
];

// Generic non-browser markers — covers other crawlers and bare HTTP clients. Kept
// after NAMED so a recognized agent never collapses into "Other".
const GENERIC_RE =
  /bot\b|crawler|spider|slurp|\bhttp\b|curl|wget|python-requests|node-fetch|axios|libwww|go-http-client|okhttp/i;

export function detectAgent(ua: string | null | undefined): AgentDetection {
  if (!ua) return { isAgent: false, name: "" };
  for (const { name, re } of NAMED) {
    if (re.test(ua)) return { isAgent: true, name };
  }
  if (GENERIC_RE.test(ua)) return { isAgent: true, name: "Other" };
  return { isAgent: false, name: "" };
}
