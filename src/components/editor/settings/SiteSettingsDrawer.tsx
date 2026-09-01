"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ListTree, Plus, X } from "lucide-react";
import { readSiteConfigAction, setSiteConfigValueAction } from "@/lib/actions/authoring";
import { getAtPath, logoParts, logoValue, setAtPath, summarizeNavigation } from "@/lib/site-config-edit";
import { CONFIG_SECTIONS, type ConfigField } from "./site-config-schema";

// Site settings, as a drawer over the live preview.
//
// The dashboard already has a Settings PAGE, and the preview's "Site settings" button used to
// navigate to it — which threw away the preview, the editor, and the draft you were looking at, to
// show you a form for the same file. So this is the same `docs.json` surface without leaving: pick a
// colour, watch the frame behind it re-render.
//
// It's deliberately ONE long scrolling column rather than tabs. Config editing is a browsing task
// ("what can I even change?") more than a lookup task, and tabs hide exactly the field you didn't
// know existed. The section picker at the top is for when you do know.
//
// Every field writes through `setSiteConfigValueAction` into the SAME draft session as page edits,
// so a settings change is part of the same reviewable, revertable, publishable unit and shows up in
// the Publish panel as `docs.json`. Nothing here touches the live site until you publish.

type Obj = Record<string, unknown>;

const keyOf = (path: readonly string[]) => path.join(".");
/** Text edits debounce; a toggle or a select commits on the spot (there's nothing to coalesce). */
const TEXT_DEBOUNCE_MS = 600;

export function SiteSettingsDrawer({
  org,
  site,
  branch,
  onClose,
  onSaved,
  onEditNavigation,
}: {
  org: string;
  site: string;
  branch: string;
  onClose: () => void;
  /** A write landed — the caller reloads the preview frame so the change is visible behind us. */
  onSaved: () => void;
  /** Nav editing lives in the editor's tree, so the Navigation section hands off to it. */
  onEditNavigation: () => void;
}) {
  const [config, setConfig] = useState<Obj | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Text inputs render from their own draft while you type, so a slow round trip can't fight the
  // caret; the draft is dropped once the value it produced is in `config`.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [inFlight, setInFlight] = useState(0);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Debounced writes, held by path so a later keystroke replaces an earlier one — and so closing
  // can still flush whatever hasn't fired.
  const pending = useRef(new Map<string, { path: string[]; value: unknown; timer: ReturnType<typeof setTimeout> }>());

  useEffect(() => {
    let live = true;
    void readSiteConfigAction(org, site, branch).then((res) => {
      if (!live) return;
      if ("error" in res) setLoadError(res.error);
      else setConfig((res.config ?? {}) as Obj);
    });
    return () => {
      live = false;
    };
  }, [org, site, branch]);

  const write = useCallback(
    async (path: string[], value: unknown) => {
      setConfig((c) => setAtPath(c ?? {}, path, value) as Obj);
      setInFlight((n) => n + 1);
      const res = await setSiteConfigValueAction(org, site, branch, path, value);
      setInFlight((n) => n - 1);
      setDrafts((d) => {
        const next = { ...d };
        delete next[keyOf(path)];
        return next;
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setSavedAt(Date.now());
      onSaved();
    },
    [org, site, branch, onSaved],
  );

  /** Schedule a write, replacing any pending write to the same path. */
  const queue = useCallback(
    (path: string[], value: unknown, delay = TEXT_DEBOUNCE_MS) => {
      const key = keyOf(path);
      const prior = pending.current.get(key);
      if (prior) clearTimeout(prior.timer);
      if (delay === 0) {
        pending.current.delete(key);
        void write(path, value);
        return;
      }
      const timer = setTimeout(() => {
        pending.current.delete(key);
        void write(path, value);
      }, delay);
      pending.current.set(key, { path, value, timer });
    },
    [write],
  );

  // Closing with a debounce still pending would silently discard the last thing typed — so fire
  // the outstanding writes rather than cancelling them.
  const flush = useCallback(() => {
    const outstanding = [...pending.current.values()];
    pending.current.clear();
    for (const p of outstanding) {
      clearTimeout(p.timer);
      void write(p.path, p.value);
    }
  }, [write]);
  const closeNow = useCallback(() => {
    flush();
    onClose();
  }, [flush, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Stop here rather than letting the preview overlay's own Escape handler close both.
      if (e.key !== "Escape") return;
      e.stopPropagation();
      closeNow();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [closeNow]);

  const jumpTo = (id: string) => {
    bodyRef.current?.querySelector(`[data-section="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const valueAt = (path: string[]) => getAtPath(config, path);
  const textAt = (path: string[]) => {
    const draft = drafts[keyOf(path)];
    if (draft !== undefined) return draft;
    const v = valueAt(path);
    return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
  };
  const setText = (path: string[], next: string) => {
    setDrafts((d) => ({ ...d, [keyOf(path)]: next }));
    queue(path, next);
  };

  return (
    <>
      <div className="pv-cfg-overlay" onClick={closeNow} />
      <aside className="pv-cfg db-portal" role="dialog" aria-label="Site settings">
        <header className="pv-cfg-head">
          <div className="min-w-0">
            <div className="pv-cfg-title">Site settings</div>
            <div className="pv-cfg-sub">
              docs.json on <code>{branch}</code>
              <SaveState inFlight={inFlight} savedAt={savedAt} />
            </div>
          </div>
          <button type="button" aria-label="Close site settings" className="pv-settings-iconbtn" onClick={closeNow}>
            <X className="h-4 w-4" />
          </button>
        </header>

        {loadError ? (
          <div className="pv-cfg-body">
            <p className="pv-settings-loading">{loadError}</p>
          </div>
        ) : config === null ? (
          <div className="pv-cfg-body">
            <p className="pv-settings-loading">Loading docs.json…</p>
          </div>
        ) : (
          <div className="pv-cfg-body" ref={bodyRef}>
            <SectionPicker onPick={jumpTo} />

            {CONFIG_SECTIONS.map((section) => (
              <section key={section.id} data-section={section.id} className="pv-cfg-section">
                {/* The badge sits OUTSIDE the heading: inside it, it becomes part of the
                    heading's accessible name ("Typography Not rendered yet"), which is both worse
                    to hear and impossible to address precisely from a test. */}
                <div className="pv-cfg-sectionhead">
                  <h3 className="pv-cfg-sectiontitle">
                    <section.icon className="h-4 w-4 opacity-70" />
                    {section.title}
                  </h3>
                  {section.rendered === false && <NotRenderedBadge />}
                </div>
                {section.blurb && <p className="pv-cfg-blurb">{section.blurb}</p>}

                {section.custom === "navigation" ? (
                  <NavigationSummary nav={valueAt(["navigation"])} onEdit={onEditNavigation} />
                ) : (
                  section.fields.map((field) => (
                    <Field
                      key={keyOf(field.path)}
                      field={field}
                      // A whole unrendered section says so once at its head; inside a rendered one
                      // the odd unrendered field carries its own mark.
                      marked={section.rendered !== false && field.rendered === false}
                      value={valueAt(field.path)}
                      text={textAt(field.path)}
                      onText={(v) => setText(field.path, v)}
                      onCommit={(v, delay) => queue(field.path, v, delay)}
                    />
                  ))
                )}
              </section>
            ))}

            <Passthrough />
          </div>
        )}
      </aside>
    </>
  );
}

function SaveState({ inFlight, savedAt }: { inFlight: number; savedAt: number | null }) {
  if (inFlight > 0) return <span className="pv-cfg-state">Saving…</span>;
  if (savedAt) return <span className="pv-cfg-state">Saved to draft</span>;
  return null;
}

/**
 * Jump-to-section control. A dropdown rather than a row of chips: there are twenty-odd sections,
 * and a sticky chip cloud that tall eats the drawer. The list is still the discovery surface —
 * scrolling the one column is how you find a setting you didn't know about; this is for when you
 * already know.
 */
function SectionPicker({ onPick }: { onPick: (id: string) => void }) {
  return (
    <div className="pv-cfg-picker">
      <span className="pv-cfg-pickerlabel">Section</span>
      <select
        className="pv-settings-select"
        aria-label="Jump to section"
        // Stays on the placeholder: it's a jump control, not a value. Leaving the chosen section
        // selected would make picking it again a no-op change event.
        value=""
        onChange={(e) => {
          if (e.target.value) onPick(e.target.value);
        }}
      >
        <option value="">Jump to…</option>
        {CONFIG_SECTIONS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.title}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * The mark on a key Papervine keeps but doesn't consume yet.
 *
 * The alternative was leaving those fields out, which is what this drawer did first — and it's
 * worse: `docs.json` is the customer's own portable file, so being unable to set a key they rely
 * on elsewhere (or are migrating with) costs them more than setting one we don't read. Labelling
 * is what keeps that honest.
 */
function NotRenderedBadge() {
  return (
    <span className="pv-cfg-badge" title="Saved to docs.json and preserved — Papervine doesn't render this key yet">
      Not rendered yet
    </span>
  );
}

/** How the drawer treats everything else in the file. */
function Passthrough() {
  const [open, setOpen] = useState(false);
  return (
    <section className="pv-cfg-section">
      <button type="button" className="pv-cfg-disclosure" onClick={() => setOpen((o) => !o)}>
        <ChevronDown className={`h-4 w-4 transition-transform${open ? "" : " -rotate-90"}`} />
        About “Not rendered yet”
      </button>
      {open && (
        <p className="pv-cfg-blurb">
          Everything above is written into your <code>docs.json</code> exactly as the format
          specifies, so it travels with your repo and works in any tool that reads it. A section or
          field marked <em>Not rendered yet</em> is one Papervine stores and preserves but
          doesn&rsquo;t draw on the page — set it if you need it in the file, and it&rsquo;ll start
          taking effect the moment support lands. Keys the drawer doesn&rsquo;t show at all are left
          untouched by everything you change here.
        </p>
      )}
    </section>
  );
}

function NavigationSummary({ nav, onEdit }: { nav: unknown; onEdit: () => void }) {
  const { tabs, groups, pages } = summarizeNavigation(nav);
  const parts = [
    tabs > 0 ? `${tabs} ${tabs === 1 ? "tab" : "tabs"}` : null,
    `${groups} ${groups === 1 ? "group" : "groups"}`,
    `${pages} ${pages === 1 ? "page" : "pages"}`,
  ].filter(Boolean);
  return (
    <div className="pv-cfg-nav">
      <span className="pv-cfg-navcount">{parts.join(" · ")}</span>
      <button type="button" className="pv-cfg-navbtn" onClick={onEdit}>
        <ListTree className="h-3.5 w-3.5" />
        Edit in the navigation tree
      </button>
    </div>
  );
}

function Field({
  field,
  marked,
  value,
  text,
  onText,
  onCommit,
}: {
  field: ConfigField;
  /** Show the "Not rendered yet" mark on this row. */
  marked?: boolean;
  value: unknown;
  text: string;
  onText: (v: string) => void;
  onCommit: (v: unknown, delay?: number) => void;
}) {
  return (
    <div className="pv-cfg-field">
      {/* A plain div, not a <label>: several kinds render a composite control (a link list, a
          key/value table) that a single label can't point at, so the accessible name lives on the
          controls themselves as an aria-label and this is purely the visible heading. */}
      <div className="pv-cfg-label">
        {field.label}
        {marked && <NotRenderedBadge />}
      </div>
      <Control field={field} value={value} text={text} onText={onText} onCommit={onCommit} />
      {field.help && <p className="pv-cfg-help">{field.help}</p>}
    </div>
  );
}

function Control({
  field,
  value,
  text,
  onText,
  onCommit,
}: {
  field: ConfigField;
  value: unknown;
  text: string;
  onText: (v: string) => void;
  onCommit: (v: unknown, delay?: number) => void;
}) {
  switch (field.kind) {
    case "textarea":
      return (
        <textarea
          className="pv-cfg-input pv-cfg-textarea"
          aria-label={field.label}
          rows={3}
          value={text}
          placeholder={field.placeholder}
          onChange={(e) => onText(e.target.value)}
        />
      );
    case "toggle":
      return (
        <button
          type="button"
          role="switch"
          aria-checked={value === true}
          aria-label={field.label}
          onClick={() => onCommit(value === true ? undefined : true, 0)}
          className="pv-settings-toggle"
        >
          <span className={`pv-toggle-track${value === true ? " is-on" : ""}`}>
            <span className="pv-toggle-thumb" />
          </span>
          <span className="pv-toggle-label">{value === true ? "On" : "Off"}</span>
        </button>
      );
    case "select":
      return (
        <select
          className="pv-settings-select"
          aria-label={field.label}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onCommit(e.target.value === "" ? undefined : e.target.value, 0)}
        >
          {/* Empty = the key is absent, which is a real and common state — the renderer's own
              default then applies, and choosing it back is how you remove the key. */}
          <option value="">Not set</option>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "color":
      return <ColorControl field={field} text={text} onText={onText} />;
    case "linkList":
      return <LinkListControl value={value} onCommit={onCommit} />;
    case "linkPair":
      return <LinkPairControl value={value} onCommit={onCommit} />;
    case "imagePair":
      return <ImagePairControl field={field} value={value} onCommit={onCommit} />;
    case "number":
      return (
        <input
          className="pv-cfg-input"
          aria-label={field.label}
          inputMode="numeric"
          value={text}
          placeholder={field.placeholder}
          onChange={(e) => onText(e.target.value)}
          // Numbers go into the file as numbers: `"weight": "400"` is a string where the schema
          // wants an integer. The text draft keeps typing responsive; this coerces on the way out.
          onBlur={() => {
            const n = Number(text.trim());
            onCommit(text.trim() === "" || Number.isNaN(n) ? undefined : n, 0);
          }}
        />
      );
    case "tags":
      return <TagsControl field={field} value={value} onCommit={onCommit} />;
    case "multiselect":
      return <MultiSelectControl field={field} value={value} onCommit={onCommit} />;
    case "footerColumns":
      return <FooterColumnsControl value={value} onCommit={onCommit} />;
    case "redirects":
      return <RedirectsControl value={value} onCommit={onCommit} />;
    case "keyValue":
      return <KeyValueControl field={field} value={value} onCommit={onCommit} />;
    default:
      return (
        <input
          className="pv-cfg-input"
          aria-label={field.label}
          value={text}
          placeholder={field.placeholder}
          onChange={(e) => onText(e.target.value)}
        />
      );
  }
}

const HEX = /^#[0-9a-f]{3,8}$/i;

function ColorControl({
  field,
  text,
  onText,
}: {
  field: ConfigField;
  text: string;
  onText: (v: string) => void;
}) {
  // The swatch is a real `input[type=color]`, but it CAN'T be the source of truth: it coerces
  // anything it doesn't understand to #000000, so an unset colour would render as black and the
  // first click would write black. The text field owns the value; the swatch only proposes one.
  const set = HEX.test(text);
  const swatch = set ? text : (field.placeholder && HEX.test(field.placeholder) ? field.placeholder : "#000000");
  return (
    <div className="pv-cfg-color">
      <input
        type="color"
        aria-label={`${field.label} swatch`}
        // Dimmed when nothing is set, so the placeholder colour the picker has to start from
        // doesn't read as a value this site has chosen.
        className={`pv-cfg-swatch${set ? "" : " is-unset"}`}
        title={set ? text : "No colour set"}
        value={swatch.slice(0, 7)}
        onChange={(e) => onText(e.target.value)}
      />
      <input
        className="pv-cfg-input"
        aria-label={field.label}
        value={text}
        placeholder={field.placeholder}
        onChange={(e) => onText(e.target.value)}
      />
    </div>
  );
}

type Link = { label: string; href: string };

function asLinks(value: unknown): Link[] {
  if (!Array.isArray(value)) return [];
  return value.map((row) => {
    const o = (row ?? {}) as Record<string, unknown>;
    return {
      label: typeof o.label === "string" ? o.label : "",
      href: typeof o.href === "string" ? o.href : "",
    };
  });
}

function LinkListControl({ value, onCommit }: { value: unknown; onCommit: (v: unknown, delay?: number) => void }) {
  const [rows, setRows] = useState<Link[]>(() => asLinks(value));
  const apply = (next: Link[], delay?: number) => {
    setRows(next);
    // A half-typed row would write `{label: "Sup", href: ""}`, which the config schema rejects for
    // the whole list — so incomplete rows are held locally and only complete ones are written.
    const clean = next.filter((r) => r.label.trim() && r.href.trim());
    onCommit(clean.length ? clean : undefined, delay);
  };
  return (
    <div className="pv-cfg-list">
      {rows.map((row, i) => (
        <div key={i} className="pv-cfg-listrow">
          <input
            className="pv-cfg-input"
            aria-label={`Link ${i + 1} label`}
            value={row.label}
            placeholder="Label"
            onChange={(e) => apply(rows.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)))}
          />
          <input
            className="pv-cfg-input"
            aria-label={`Link ${i + 1} URL`}
            value={row.href}
            placeholder="https://…"
            onChange={(e) => apply(rows.map((r, j) => (j === i ? { ...r, href: e.target.value } : r)))}
          />
          <button
            type="button"
            aria-label={`Remove link ${i + 1}`}
            className="pv-settings-iconbtn"
            onClick={() => apply(rows.filter((_, j) => j !== i), 0)}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button type="button" className="pv-cfg-add" onClick={() => setRows([...rows, { label: "", href: "" }])}>
        <Plus className="h-3.5 w-3.5" /> Add link
      </button>
    </div>
  );
}

/**
 * `logo` / `favicon` — one control over the whole key, because the value is EITHER a string or
 * `{light, dark, href}`. Editing `logo.light` directly on a string-form logo would show an empty
 * field (the string isn't at that path) and then replace the string with an object, silently
 * dropping the logo the site was using. `logoParts` reads both shapes; `logoValue` decides which
 * one to write — the plain string when there's nothing to distinguish, which is what a
 * hand-written `docs.json` says.
 */
function ImagePairControl({
  field,
  value,
  onCommit,
}: {
  field: ConfigField;
  value: unknown;
  onCommit: (v: unknown, delay?: number) => void;
}) {
  const [parts, setParts] = useState(() => logoParts(value));
  const apply = (next: { light: string; dark: string; href: string }) => {
    setParts(next);
    onCommit(logoValue(field.hasHref ? next : { light: next.light, dark: next.dark }));
  };
  return (
    <div className="pv-cfg-list">
      <div className="pv-cfg-pairrow">
        <input
          className="pv-cfg-input"
          aria-label={`${field.label} (light)`}
          value={parts.light}
          placeholder={field.placeholder}
          onChange={(e) => apply({ ...parts, light: e.target.value })}
        />
        <input
          className="pv-cfg-input"
          aria-label={`${field.label} (dark)`}
          value={parts.dark}
          placeholder={field.placeholder?.replace("light", "dark")}
          onChange={(e) => apply({ ...parts, dark: e.target.value })}
        />
      </div>
      {field.hasHref && (
        <input
          className="pv-cfg-input"
          aria-label={`${field.label} link`}
          value={parts.href}
          placeholder="Where clicking it goes (defaults to your docs home)"
          onChange={(e) => apply({ ...parts, href: e.target.value })}
        />
      )}
    </div>
  );
}

/**
 * A single label+href pair (the navbar's call to action).
 *
 * Written ONLY when both halves are present. `navbar.primary` requires both keys, and the config
 * parser's leniency works per block: a `primary` missing its `href` invalidates `navbar` and the
 * whole block — the links included — is dropped. So typing the label first must not be able to
 * make somebody's navbar links disappear.
 */
function LinkPairControl({ value, onCommit }: { value: unknown; onCommit: (v: unknown, delay?: number) => void }) {
  const [pair, setPair] = useState<Link>(() => asLinks([value])[0] ?? { label: "", href: "" });
  const apply = (next: Link) => {
    setPair(next);
    const complete = next.label.trim() && next.href.trim();
    onCommit(complete ? { label: next.label.trim(), href: next.href.trim() } : undefined);
  };
  return (
    <div className="pv-cfg-list">
      <div className="pv-cfg-pairrow">
        <input
          className="pv-cfg-input"
          aria-label="Call to action label"
          value={pair.label}
          placeholder="Get started"
          onChange={(e) => apply({ ...pair, label: e.target.value })}
        />
        <input
          className="pv-cfg-input"
          aria-label="Call to action link"
          value={pair.href}
          placeholder="https://example.com/signup"
          onChange={(e) => apply({ ...pair, href: e.target.value })}
        />
      </div>
    </div>
  );
}

const asStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

/** A free-form string list (`api.examples.languages`) — order is meaningful, so no sorting. */
function TagsControl({
  field,
  value,
  onCommit,
}: {
  field: ConfigField;
  value: unknown;
  onCommit: (v: unknown, delay?: number) => void;
}) {
  const items = asStrings(value);
  const [draft, setDraft] = useState("");
  const apply = (next: string[]) => onCommit(next.length ? next : undefined, 0);
  const add = () => {
    const t = draft.trim();
    setDraft("");
    if (t && !items.includes(t)) apply([...items, t]);
  };
  return (
    <div className="pv-keywords">
      {items.map((item) => (
        <span key={item} className="pv-keyword">
          {item}
          <button
            type="button"
            aria-label={`Remove ${item}`}
            onClick={() => apply(items.filter((x) => x !== item))}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        className="pv-keyword-input"
        aria-label={field.label}
        value={draft}
        placeholder="Add…"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          add();
        }}
        onBlur={add}
      />
    </div>
  );
}

/** A fixed set of values, any number of them (`contextual.options`). */
function MultiSelectControl({
  field,
  value,
  onCommit,
}: {
  field: ConfigField;
  value: unknown;
  onCommit: (v: unknown, delay?: number) => void;
}) {
  const chosen = asStrings(value);
  const toggle = (option: string) => {
    // Written in the SCHEMA's order rather than click order — the config's list order is what
    // decides the menu's order, and "the order I happened to tick them" is not a design.
    const next = (field.options ?? [])
      .map((o) => o.value)
      .filter((v) => (v === option ? !chosen.includes(v) : chosen.includes(v)));
    onCommit(next.length ? next : undefined, 0);
  };
  return (
    <div className="pv-cfg-chips">
      {(field.options ?? []).map((o) => {
        const on = chosen.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            role="checkbox"
            aria-checked={on}
            className={`pv-cfg-chip${on ? " is-on" : ""}`}
            onClick={() => toggle(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

type FooterColumn = { header: string; items: Link[] };

function asColumns(value: unknown): FooterColumn[] {
  if (!Array.isArray(value)) return [];
  return value.map((row) => {
    const o = (row ?? {}) as Record<string, unknown>;
    return {
      header: typeof o.header === "string" ? o.header : "",
      items: asLinks(o.items),
    };
  });
}

/** `footer.links` — columns of links, each with a heading. */
function FooterColumnsControl({
  value,
  onCommit,
}: {
  value: unknown;
  onCommit: (v: unknown, delay?: number) => void;
}) {
  const [columns, setColumns] = useState<FooterColumn[]>(() => asColumns(value));
  const apply = (next: FooterColumn[], delay?: number) => {
    setColumns(next);
    // Same rule as the navbar's links: only complete rows are written, so a half-typed link can't
    // invalidate the block it lives in.
    const clean = next
      .map((c) => ({ ...c, items: c.items.filter((i) => i.label.trim() && i.href.trim()) }))
      .filter((c) => c.header.trim() || c.items.length);
    onCommit(clean.length ? clean : undefined, delay);
  };
  const editColumn = (i: number, patch: Partial<FooterColumn>, delay?: number) =>
    apply(
      columns.map((c, j) => (j === i ? { ...c, ...patch } : c)),
      delay,
    );

  return (
    <div className="pv-cfg-columns">
      {columns.map((column, i) => (
        <div key={i} className="pv-cfg-column">
          <div className="pv-cfg-listrow pv-cfg-columnhead">
            <input
              className="pv-cfg-input"
              aria-label={`Column ${i + 1} heading`}
              value={column.header}
              placeholder="Heading (e.g. Resources)"
              onChange={(e) => editColumn(i, { header: e.target.value })}
            />
            <button
              type="button"
              aria-label={`Remove column ${i + 1}`}
              className="pv-settings-iconbtn"
              onClick={() => apply(columns.filter((_, j) => j !== i), 0)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {column.items.map((item, k) => (
            <div key={k} className="pv-cfg-listrow">
              <input
                className="pv-cfg-input"
                aria-label={`Column ${i + 1} link ${k + 1} label`}
                value={item.label}
                placeholder="Label"
                onChange={(e) =>
                  editColumn(i, {
                    items: column.items.map((x, j) => (j === k ? { ...x, label: e.target.value } : x)),
                  })
                }
              />
              <input
                className="pv-cfg-input"
                aria-label={`Column ${i + 1} link ${k + 1} URL`}
                value={item.href}
                placeholder="https://…"
                onChange={(e) =>
                  editColumn(i, {
                    items: column.items.map((x, j) => (j === k ? { ...x, href: e.target.value } : x)),
                  })
                }
              />
              <button
                type="button"
                aria-label={`Remove column ${i + 1} link ${k + 1}`}
                className="pv-settings-iconbtn"
                onClick={() => editColumn(i, { items: column.items.filter((_, j) => j !== k) }, 0)}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="pv-cfg-add"
            onClick={() =>
              setColumns(
                columns.map((c, j) => (j === i ? { ...c, items: [...c.items, { label: "", href: "" }] } : c)),
              )
            }
          >
            <Plus className="h-3.5 w-3.5" /> Add link
          </button>
        </div>
      ))}
      <button
        type="button"
        className="pv-cfg-add"
        onClick={() => setColumns([...columns, { header: "", items: [] }])}
      >
        <Plus className="h-3.5 w-3.5" /> Add column
      </button>
    </div>
  );
}

type Redirect = { source: string; destination: string; permanent: boolean };

function asRedirects(value: unknown): Redirect[] {
  if (!Array.isArray(value)) return [];
  return value.map((row) => {
    const o = (row ?? {}) as Record<string, unknown>;
    return {
      source: typeof o.source === "string" ? o.source : "",
      destination: typeof o.destination === "string" ? o.destination : "",
      permanent: o.permanent === true,
    };
  });
}

/** `redirects` — old path → new path, with the 301/302 choice. */
function RedirectsControl({
  value,
  onCommit,
}: {
  value: unknown;
  onCommit: (v: unknown, delay?: number) => void;
}) {
  const [rows, setRows] = useState<Redirect[]>(() => asRedirects(value));
  const apply = (next: Redirect[], delay?: number) => {
    setRows(next);
    const clean = next
      .filter((r) => r.source.trim() && r.destination.trim())
      // `permanent` is only written when true: false is the format's default, and a config full of
      // `"permanent": false` is noise in a diff.
      .map((r) => ({
        source: r.source.trim(),
        destination: r.destination.trim(),
        ...(r.permanent ? { permanent: true } : {}),
      }));
    onCommit(clean.length ? clean : undefined, delay);
  };
  const edit = (i: number, patch: Partial<Redirect>, delay?: number) =>
    apply(
      rows.map((r, j) => (j === i ? { ...r, ...patch } : r)),
      delay,
    );

  return (
    <div className="pv-cfg-list">
      {rows.map((row, i) => (
        <div key={i} className="pv-cfg-redirectrow">
          <input
            className="pv-cfg-input"
            aria-label={`Redirect ${i + 1} from`}
            value={row.source}
            placeholder="/old-path"
            onChange={(e) => edit(i, { source: e.target.value })}
          />
          <input
            className="pv-cfg-input"
            aria-label={`Redirect ${i + 1} to`}
            value={row.destination}
            placeholder="/new-path"
            onChange={(e) => edit(i, { destination: e.target.value })}
          />
          <button
            type="button"
            role="switch"
            aria-checked={row.permanent}
            aria-label={`Redirect ${i + 1} permanent`}
            className="pv-settings-toggle"
            onClick={() => edit(i, { permanent: !row.permanent }, 0)}
          >
            <span className={`pv-toggle-track${row.permanent ? " is-on" : ""}`}>
              <span className="pv-toggle-thumb" />
            </span>
            <span className="pv-toggle-label">{row.permanent ? "301" : "302"}</span>
          </button>
          <button
            type="button"
            aria-label={`Remove redirect ${i + 1}`}
            className="pv-settings-iconbtn"
            onClick={() => apply(rows.filter((_, j) => j !== i), 0)}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="pv-cfg-add"
        onClick={() => setRows([...rows, { source: "", destination: "", permanent: false }])}
      >
        <Plus className="h-3.5 w-3.5" /> Add redirect
      </button>
    </div>
  );
}

type Pair = { key: string; value: string };

function asPairs(value: unknown): Pair[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).map(([key, v]) => ({
    key,
    value: typeof v === "string" ? v : JSON.stringify(v),
  }));
}

/**
 * A name→value map (`seo.metatags`, `footer.socials`, `variables`).
 *
 * The row labels come from the FIELD, not from this component: the same control serves meta tags,
 * social links and content variables, and hardcoding one of them puts "Add meta tag" under the
 * footer's Socials — which is how this first shipped.
 */
function KeyValueControl({
  field,
  value,
  onCommit,
}: {
  field: ConfigField;
  value: unknown;
  onCommit: (v: unknown, delay?: number) => void;
}) {
  const [rows, setRows] = useState<Pair[]>(() => asPairs(value));
  const noun = field.itemNoun ?? "row";
  const [keyPlaceholder, valuePlaceholder] = field.itemPlaceholders ?? ["name", "value"];
  const apply = (next: Pair[], delay?: number) => {
    setRows(next);
    const out: Record<string, string> = {};
    for (const r of next) if (r.key.trim()) out[r.key.trim()] = r.value;
    onCommit(Object.keys(out).length ? out : undefined, delay);
  };
  return (
    <div className="pv-cfg-list">
      {rows.map((row, i) => (
        <div key={i} className="pv-cfg-listrow">
          <input
            className="pv-cfg-input"
            aria-label={`${field.label} ${i + 1} name`}
            value={row.key}
            placeholder={keyPlaceholder}
            onChange={(e) => apply(rows.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))}
          />
          <input
            className="pv-cfg-input"
            aria-label={`${field.label} ${i + 1} value`}
            value={row.value}
            placeholder={valuePlaceholder}
            onChange={(e) => apply(rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))}
          />
          <button
            type="button"
            aria-label={`Remove ${noun} ${i + 1}`}
            className="pv-settings-iconbtn"
            onClick={() => apply(rows.filter((_, j) => j !== i), 0)}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button type="button" className="pv-cfg-add" onClick={() => setRows([...rows, { key: "", value: "" }])}>
        <Plus className="h-3.5 w-3.5" /> Add {noun}
      </button>
    </div>
  );
}
