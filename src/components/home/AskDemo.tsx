"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";

// The loader endpoint. Referenced only from this client component, so the server-rendered HTML
// of a home page with no demo site contains no trace of the widget (asserted by the smoke gate).
const EMBED_SRC = "/api/widget/embed.js";

type PapervineAssistantApi = {
  init: (opts: Record<string, unknown>) => Promise<unknown>;
  ask: (question: string, options?: { open?: boolean }) => void;
  update: (config: Record<string, unknown>) => void;
};

declare global {
  interface Window {
    PapervineAssistant?: PapervineAssistantApi;
  }
}

export type DemoQuestion = { q: string; href: string };

/** The platform's current appearance, which the widget should match. */
function currentTheme(): "dark" | "light" {
  return document.documentElement.getAttribute("data-db-theme") === "light" ? "light" : "dark";
}

/**
 * The "ask" half of the home page's live demo.
 *
 * There is no bespoke chat UI here on purpose: the answers come from the SAME embeddable widget
 * a customer drops on their own site with one script tag, pointed at our own docs. That's the
 * strongest form the claim can take — the bubble in the corner *is* the product being sold — and
 * it means there's no second chat implementation to keep in step with the real one.
 *
 * `widgetId` is null whenever the demo site isn't available (no DB, single-repo preview, the
 * operator hasn't enabled the widget or allowlisted this origin). The chips then stay useful as
 * links into the docs page that answers each question, and no script is ever requested.
 */
export function AskDemo({
  widgetId,
  questions,
}: {
  widgetId: string | null;
  questions: DemoQuestion[];
}) {
  const [loading, setLoading] = useState(false);
  // The in-flight (or settled) load, so N rapid clicks mount one widget rather than racing.
  const ready = useRef<Promise<PapervineAssistantApi> | null>(null);

  const load = useCallback((): Promise<PapervineAssistantApi> => {
    if (ready.current) return ready.current;

    ready.current = new Promise<PapervineAssistantApi>((resolve, reject) => {
      const existing = window.PapervineAssistant;
      if (existing) return resolve(existing);

      // A module script: the loader reads `import.meta.url` to discover which origin to call
      // back to, which is only defined for type="module".
      const tag = document.createElement("script");
      tag.type = "module";
      tag.src = EMBED_SRC;
      tag.onload = () => {
        const api = window.PapervineAssistant;
        if (api) resolve(api);
        else reject(new Error("widget loader ran without defining PapervineAssistant"));
      };
      tag.onerror = () => reject(new Error("widget loader failed to load"));
      document.head.appendChild(tag);
    })
      .then(async (api) => {
        await api.init({
          id: widgetId,
          theme: currentTheme(),
          title: "Ask the Papervine docs",
          trigger: "Ask the docs",
          starterQuestions: questions.map((q) => q.q),
        });
        return api;
      })
      .catch((err) => {
        // Let a later click retry rather than wedging on one bad network moment.
        ready.current = null;
        throw err;
      });

    return ready.current;
  }, [widgetId, questions]);

  // Follow the platform's appearance toggle. The widget lives in a shadow root outside the `.db`
  // shell, so it can't inherit the theme through CSS — it has to be told.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      window.PapervineAssistant?.update({ theme: currentTheme() });
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-db-theme"],
    });
    return () => observer.disconnect();
  }, []);

  const ask = useCallback(
    async (question: string) => {
      setLoading(true);
      try {
        const api = await load();
        api.ask(question);
      } catch {
        // The widget is a progressive enhancement on a marketing page: if it can't load, the
        // section still reads correctly and the docs are one click away.
      } finally {
        setLoading(false);
      }
    },
    [load],
  );

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {questions.map(({ q, href }) =>
        widgetId ? (
          <button
            key={q}
            type="button"
            onClick={() => void ask(q)}
            disabled={loading}
            className="db-feature group flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-left text-sm transition-colors hover:text-[var(--fg)] disabled:opacity-60"
          >
            <span>{q}</span>
            <Sparkles className="h-4 w-4 shrink-0 text-[var(--blue)] opacity-60 transition-opacity group-hover:opacity-100" />
          </button>
        ) : (
          <a
            key={q}
            href={href}
            className="db-feature group flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-left text-sm transition-colors hover:text-[var(--fg)]"
          >
            <span>{q}</span>
            <Sparkles className="h-4 w-4 shrink-0 text-[var(--blue)] opacity-60 transition-opacity group-hover:opacity-100" />
          </a>
        ),
      )}
    </div>
  );
}
