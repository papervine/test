/**
 * Client-side helpers for mounting our OWN embeddable widget (SPEC §8.7) inside our own
 * React surfaces — the marketing home's live demo (`AskDemo`) and the dashboard shell
 * (`SiteAssistantWidget`).
 *
 * Both do the same three awkward things: inject the loader as a `type="module"` script
 * exactly once per document, wait for it to define `window.PapervineAssistant`, and tell
 * the widget which appearance to use (it lives in a shadow root outside the `.db` shell,
 * so it can't inherit the platform theme through CSS — it has to be told). Shared here so
 * there's one definition of each, and one `Window` augmentation rather than two that must
 * agree.
 *
 * Nothing here is server-only, but nothing here may run on the server either: every
 * function touches `document`. Call them from an effect or an event handler.
 */

export type PapervineAssistantApi = {
  init: (opts: Record<string, unknown>) => Promise<unknown>;
  open: (options?: { source?: string; focus?: boolean }) => void;
  close: () => void;
  ask: (question: string, options?: { open?: boolean }) => void;
  update: (config: Record<string, unknown>) => void;
  destroy: () => void;
};

declare global {
  interface Window {
    PapervineAssistant?: PapervineAssistantApi;
  }
}

/** The loader endpoint. Same-origin: the script derives its API base from its own URL. */
export const WIDGET_EMBED_SRC = "/api/widget/embed.js";

// The in-flight (or settled) load for this document. The loader script itself is a
// singleton (`if (window.PapervineAssistant) return`), so a second tag would be inert —
// but two callers racing before the first resolves would still append two tags, and a
// failed load must not wedge the page forever (hence the reset in the rejection path).
let loading: Promise<PapervineAssistantApi> | null = null;

/**
 * Load the widget loader script and resolve its API. Idempotent: repeated calls share one
 * script tag and one promise. Rejects if the script can't load, and lets a later call
 * retry.
 */
export function loadPapervineWidget(): Promise<PapervineAssistantApi> {
  const existing = window.PapervineAssistant;
  if (existing) return Promise.resolve(existing);
  if (loading) return loading;

  loading = new Promise<PapervineAssistantApi>((resolve, reject) => {
    // A module script: the loader reads `import.meta.url` to discover which origin to call
    // back to, which is only defined for type="module".
    const tag = document.createElement("script");
    tag.type = "module";
    tag.src = WIDGET_EMBED_SRC;
    tag.onload = () => {
      const api = window.PapervineAssistant;
      if (api) resolve(api);
      else reject(new Error("widget loader ran without defining PapervineAssistant"));
    };
    tag.onerror = () => reject(new Error("widget loader failed to load"));
    document.head.appendChild(tag);
  }).catch((err: unknown) => {
    loading = null;
    throw err;
  });

  return loading;
}

/**
 * The platform's current appearance, which a widget mounted on our own surfaces should
 * match: `data-db-theme` on `<html>` (set pre-paint from `localStorage['pv-theme']`, see
 * the root layout), NOT the docs `.dark` class — the two theme systems are independent.
 */
export function platformWidgetTheme(): "dark" | "light" {
  return document.documentElement.getAttribute("data-db-theme") === "light"
    ? "light"
    : "dark";
}

/**
 * Call `onChange` whenever the platform appearance toggles. Returns the disposer, so an
 * effect can `return watchPlatformTheme(...)` directly.
 */
export function watchPlatformTheme(onChange: (theme: "dark" | "light") => void): () => void {
  const observer = new MutationObserver(() => onChange(platformWidgetTheme()));
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-db-theme"],
  });
  return () => observer.disconnect();
}
