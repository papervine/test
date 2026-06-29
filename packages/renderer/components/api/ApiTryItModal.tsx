"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import clsx from "clsx";
import { Play, Loader2, X, ChevronDown, ChevronRight, Copy, Check, Eye, EyeOff } from "lucide-react";
import { methodColor } from "../../lib/method-colors";

/**
 * The interactive API "Try it" playground (incumbent model): the trigger lives on the endpoint
 * bar in the center column, and clicking it opens a full modal that encompasses every OpenAPI
 * input class — security schemes (basic / bearer / apiKey / oauth2), headers, path, query, and
 * request body — each as an editable field. A live request sample (cURL / JavaScript / Python)
 * and the response render on the right. "Send" fires a real browser `fetch`; CORS is the live
 * constraint (a server-side proxy is the eventual fix), and a cross-origin failure degrades to
 * an inline message rather than throwing.
 *
 * Code is generated and lightly colorized on the client (the modal is opt-in, so we avoid
 * shipping Shiki) — the page's read-only right rail keeps the server-highlighted samples.
 */

export type TryItParam = {
  name: string;
  in: "path" | "query" | "header";
  required?: boolean;
  example?: string;
  type?: string;
  description?: string;
};
export type TryItAuth = {
  key: string;
  type: "basic" | "bearer" | "apiKey" | "oauth2" | "other";
  in?: "header" | "query" | "cookie";
  name?: string;
  description?: string;
};
export type TryItSibling = { slug: string; method: string; summary: string };
export type TryItProps = {
  method: string;
  baseUrl: string;
  path: string;
  summary: string;
  params: TryItParam[];
  auth: TryItAuth[];
  bodySample?: string;
  siblings: TryItSibling[];
};

type LiveResponse = { status: number; statusText: string; body: string; ok: boolean };

// ---- tiny client colorizers (avoid bundling Shiki for the opt-in modal) ----
const escapeHtml = (s: string) =>
  s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

function colorizeJson(src: string): string {
  return escapeHtml(src).replace(
    /("(?:\\.|[^"\\])*"(\s*:)?)|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (m, str, isKey, lit, num) => {
      if (str) return `<span class="${isKey ? "text-sky-300" : "text-amber-300"}">${str}</span>`;
      if (lit) return `<span class="text-violet-300">${lit}</span>`;
      if (num) return `<span class="text-emerald-300">${num}</span>`;
      return m;
    },
  );
}

function colorizeShell(src: string): string {
  // Strings amber, long/short flags muted blue — enough to read like the page's cURL panel.
  return escapeHtml(src)
    .replace(/('(?:\\.|[^'\\])*')/g, '<span class="text-amber-300">$1</span>')
    .replace(/(\s)(--?[a-zA-Z][\w-]*)/g, '$1<span class="text-sky-300">$2</span>');
}

function fieldKey(p: TryItParam): string {
  return `${p.in}:${p.name}`;
}

// Persistent, theme-matched scrollbar for the modal's scroll panes (the results window
// especially). Defining ::-webkit-scrollbar disables macOS's fade-out overlay scrollbar, so it
// stays visible; `overflow-y-scroll` on the pane keeps the track reserved even for short bodies.
const TRY_IT_SCROLL_CSS = `
.try-it-scroll{scrollbar-width:thin;scrollbar-color:#52525b transparent}
.try-it-scroll::-webkit-scrollbar{width:12px;height:12px}
.try-it-scroll::-webkit-scrollbar-track{background:transparent}
.try-it-scroll::-webkit-scrollbar-thumb{background-color:#3f3f46;border-radius:9999px;border:3px solid transparent;background-clip:content-box}
.try-it-scroll::-webkit-scrollbar-thumb:hover{background-color:#52525b}
`;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="rounded p-1 text-zinc-400 hover:text-zinc-100"
      aria-label="Copy"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function Section({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-3 text-sm font-semibold text-zinc-200"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        {title}
      </button>
      {open && <div className="space-y-4 px-4 pb-4">{children}</div>}
    </div>
  );
}

function Field({
  label,
  type,
  required,
  description,
  value,
  onChange,
  placeholder,
  mono,
  secret,
}: {
  label: string;
  type?: string;
  required?: boolean;
  description?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  // Credential field (password / token / api key): mask the value as dots with an eye toggle.
  secret?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-medium text-zinc-200">{label}</span>
        {type && <span className="text-xs text-zinc-500">{type}</span>}
        {required && (
          <span className="rounded bg-red-950 px-1.5 py-0.5 text-[0.6rem] font-medium text-red-300">
            required
          </span>
        )}
      </div>
      {description && <p className="mb-1.5 text-xs text-zinc-400">{description}</p>}
      <div className="relative">
        <input
          type={secret && !show ? "password" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={clsx(
            "w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-primary focus:outline-none",
            secret && "pr-10",
            mono && "font-mono",
          )}
        />
        {secret && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute inset-y-0 right-0 flex items-center px-3 text-zinc-400 hover:text-zinc-200"
            aria-label={show ? "Hide value" : "Show value"}
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </div>
    </div>
  );
}

export function ApiTryItModal(props: TryItProps) {
  const [open, setOpen] = useState(false);
  const { method, path, summary, params, auth } = props;

  const [base, setBase] = useState(props.baseUrl);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(params.map((p) => [fieldKey(p), p.example ?? ""])),
  );
  const [authValues, setAuthValues] = useState<Record<string, string>>({});
  const [body, setBody] = useState(props.bodySample ?? "");
  const [lang, setLang] = useState<"cURL" | "JavaScript" | "Python">("cURL");
  const [sending, setSending] = useState(false);
  const [live, setLive] = useState<LiveResponse | null>(null);

  const hasBody = method !== "GET" && method !== "HEAD" && method !== "DELETE";
  const av = (k: string) => authValues[k] ?? "";

  // Resolve the request from current inputs: substitute path params, collect query + headers,
  // and fold each auth scheme into the right header/query. Shared by Send and the code samples.
  const built = useMemo(() => {
    let url = base + path;
    const query = new URLSearchParams();
    const headers: Record<string, string> = {};
    for (const p of params) {
      const v = values[fieldKey(p)]?.trim();
      if (!v) continue;
      if (p.in === "path") url = url.replace(`{${p.name}}`, encodeURIComponent(v));
      else if (p.in === "query") query.set(p.name, v);
      else headers[p.name] = v;
    }
    for (const a of auth) {
      if (a.type === "basic") {
        const u = av(`${a.key}.username`);
        const pw = av(`${a.key}.password`);
        if (u || pw) headers["Authorization"] = `Basic ${btoaSafe(`${u}:${pw}`)}`;
      } else if (a.type === "bearer" || a.type === "oauth2" || a.type === "other") {
        const t = av(`${a.key}.token`);
        if (t) headers["Authorization"] = `Bearer ${t}`;
      } else if (a.type === "apiKey" && a.name) {
        const v = av(`${a.key}.value`);
        if (v) {
          if (a.in === "query") query.set(a.name, v);
          else headers[a.name] = v;
        }
      }
    }
    const qs = query.toString();
    if (qs) url += (url.includes("?") ? "&" : "?") + qs;
    const sendBody = hasBody && body.trim() ? body : undefined;
    if (sendBody && !("Content-Type" in headers)) headers["Content-Type"] = "application/json";
    return { url, headers, body: sendBody };
  }, [base, path, params, values, auth, authValues, body, hasBody]); // eslint-disable-line react-hooks/exhaustive-deps

  const sample = useMemo(() => buildSample(lang, method, built), [lang, method, built]);

  async function send() {
    setSending(true);
    try {
      const res = await fetch(built.url, {
        method,
        headers: built.headers,
        body: built.body,
      });
      const text = await res.text();
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        /* not JSON */
      }
      setLive({ status: res.status, statusText: res.statusText, body: pretty, ok: res.ok });
    } catch (err) {
      setLive({
        status: 0,
        statusText: "Request failed",
        ok: false,
        body:
          `${(err as Error).message}\n\n` +
          "The endpoint may be unreachable, or it may not allow cross-origin browser requests " +
          "(CORS). Copy the cURL sample and run it from a terminal instead.",
      });
    } finally {
      setSending(false);
    }
  }

  // Close on Escape; lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const grouped = {
    path: params.filter((p) => p.in === "path"),
    header: params.filter((p) => p.in === "header"),
    query: params.filter((p) => p.in === "query"),
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
      >
        Try it <Play className="h-3.5 w-3.5" />
      </button>

      {open && <Modal {...{ props, method, path, summary, base, setBase, values, setValues, authValues, setAuthValues, body, setBody, hasBody, grouped, auth, lang, setLang, sample, sending, send, live, setLive, setOpen, built }} />}
    </>
  );
}

// Separated so the heavy modal tree only mounts when open (and can portal to <body>).
function Modal(p: {
  props: TryItProps;
  method: string;
  path: string;
  summary: string;
  base: string;
  setBase: (v: string) => void;
  values: Record<string, string>;
  setValues: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  authValues: Record<string, string>;
  setAuthValues: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  body: string;
  setBody: (v: string) => void;
  hasBody: boolean;
  grouped: { path: TryItParam[]; header: TryItParam[]; query: TryItParam[] };
  auth: TryItAuth[];
  lang: "cURL" | "JavaScript" | "Python";
  setLang: (l: "cURL" | "JavaScript" | "Python") => void;
  sample: string;
  sending: boolean;
  send: () => void;
  live: LiveResponse | null;
  setLive: (r: LiveResponse | null) => void;
  setOpen: (o: boolean) => void;
  built: { url: string; headers: Record<string, string>; body?: string };
}) {
  const ref = useRef<HTMLDivElement>(null);
  const node = (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm sm:p-8"
      onMouseDown={(e) => e.target === ref.current && p.setOpen(false)}
      ref={ref}
    >
      {/* Always-visible, styled scrollbar for the modal's scroll panes — defining
          ::-webkit-scrollbar opts out of macOS overlay scrollbars (which fade out), so the
          results window's scrollbar is persistently there. Paired with overflow-y-scroll. */}
      <style>{TRY_IT_SCROLL_CSS}</style>
      <div className="my-auto w-full max-w-6xl overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 text-zinc-100 shadow-2xl">
        {/* Header: op selector · editable URL · Send */}
        <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800 p-4">
          <OpSelect method={p.method} summary={p.summary} siblings={p.props.siblings} />
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5">
            <span className={clsx("rounded px-2 py-0.5 text-xs font-bold", methodColor(p.method))}>
              {p.method}
            </span>
            <input
              value={p.base}
              onChange={(e) => p.setBase(e.target.value)}
              className="min-w-0 flex-1 bg-transparent font-mono text-sm text-zinc-300 focus:outline-none"
            />
            <span className="shrink-0 font-mono text-sm text-zinc-500">{p.path}</span>
          </div>
          <button
            type="button"
            onClick={p.send}
            disabled={p.sending}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            {p.sending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {p.sending ? "Sending…" : "Send"} {!p.sending && <Play className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => p.setOpen(false)}
            className="rounded-lg p-2 text-zinc-400 hover:text-zinc-100"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid max-h-[80vh] gap-6 overflow-y-auto p-5 lg:grid-cols-2">
          {/* Left: editable inputs across every OpenAPI input class */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-zinc-100">{p.summary}</h2>

            {p.auth.length > 0 && (
              <Section title="Authorization">
                {p.auth.map((a) => (
                  <AuthFields key={a.key} auth={a} values={p.authValues} set={p.setAuthValues} />
                ))}
              </Section>
            )}

            {p.grouped.header.length > 0 && (
              <Section title="Headers">
                {p.grouped.header.map((f) => (
                  <ParamField key={fieldKey(f)} f={f} values={p.values} set={p.setValues} />
                ))}
              </Section>
            )}

            {p.grouped.path.length > 0 && (
              <Section title="Path">
                {p.grouped.path.map((f) => (
                  <ParamField key={fieldKey(f)} f={f} values={p.values} set={p.setValues} />
                ))}
              </Section>
            )}

            {p.grouped.query.length > 0 && (
              <Section title="Query">
                {p.grouped.query.map((f) => (
                  <ParamField key={fieldKey(f)} f={f} values={p.values} set={p.setValues} />
                ))}
              </Section>
            )}

            {p.hasBody && (
              <Section title="Body">
                <textarea
                  value={p.body}
                  onChange={(e) => p.setBody(e.target.value)}
                  rows={Math.min(14, Math.max(4, p.body.split("\n").length))}
                  spellCheck={false}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-100 focus:border-primary focus:outline-none"
                />
              </Section>
            )}
          </div>

          {/* Right: live request sample + response */}
          <div className="space-y-4">
            <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
              <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
                <span className="text-xs font-medium text-zinc-400">{p.summary}</span>
                <div className="flex items-center gap-1">
                  {(["cURL", "JavaScript", "Python"] as const).map((l) => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => p.setLang(l)}
                      className={clsx(
                        "rounded px-1.5 py-0.5 text-[0.7rem] font-medium",
                        p.lang === l ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200",
                      )}
                    >
                      {l}
                    </button>
                  ))}
                  <CopyButton text={p.sample} />
                </div>
              </div>
              <pre
                className="m-0 overflow-x-auto p-4 font-mono text-xs leading-relaxed text-zinc-200"
                dangerouslySetInnerHTML={{
                  __html: p.lang === "cURL" ? colorizeShell(p.sample) : colorizeJsLike(p.sample),
                }}
              />
            </div>

            <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
              <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
                {p.live ? (
                  <span className="flex items-center gap-2 text-xs">
                    <span
                      className={clsx(
                        "rounded px-1.5 py-0.5 text-[0.65rem] font-bold",
                        p.live.ok ? "bg-green-950 text-green-300" : "bg-red-950 text-red-300",
                      )}
                    >
                      {p.live.status || "ERR"}
                    </span>
                    <span className="text-zinc-400">{p.live.statusText}</span>
                  </span>
                ) : (
                  <span className="text-xs font-medium text-zinc-500">
                    Response — press Send to call the API
                  </span>
                )}
                {p.live && <CopyButton text={p.live.body} />}
              </div>
              {p.live ? (
                <pre
                  className="try-it-scroll m-0 max-h-[40vh] overflow-y-scroll overflow-x-auto p-4 font-mono text-xs leading-relaxed text-zinc-200"
                  dangerouslySetInnerHTML={{ __html: colorizeJson(p.live.body) }}
                />
              ) : (
                <div className="p-4 text-xs text-zinc-600">No response yet.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
  return createPortal(node, document.body);
}

function OpSelect({
  method,
  summary,
  siblings,
}: {
  method: string;
  summary: string;
  siblings: TryItSibling[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => siblings.length > 0 && setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2"
      >
        <span className={clsx("rounded px-1.5 py-0.5 text-[0.65rem] font-bold", methodColor(method))}>
          {method}
        </span>
        <span className="text-sm font-medium text-zinc-200">{summary}</span>
        {siblings.length > 0 && <ChevronDown className="h-4 w-4 text-zinc-500" />}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-10 mt-1 w-64 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 py-1 shadow-xl">
          {siblings.map((s) => (
            <Link
              key={s.slug}
              href={`/${s.slug}`}
              className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
            >
              <span
                className={clsx("rounded px-1.5 py-0.5 text-[0.6rem] font-bold", methodColor(s.method))}
              >
                {s.method}
              </span>
              <span className="truncate">{s.summary}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function ParamField({
  f,
  values,
  set,
}: {
  f: TryItParam;
  values: Record<string, string>;
  set: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  return (
    <Field
      label={f.name}
      type={f.type}
      required={f.required}
      description={f.description}
      value={values[fieldKey(f)] ?? ""}
      onChange={(v) => set((s) => ({ ...s, [fieldKey(f)]: v }))}
      placeholder={f.example ?? `enter ${f.name}`}
    />
  );
}

function AuthFields({
  auth,
  values,
  set,
}: {
  auth: TryItAuth;
  values: Record<string, string>;
  set: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  const upd = (k: string) => (v: string) => set((s) => ({ ...s, [k]: v }));
  if (auth.type === "basic") {
    return (
      <>
        {auth.description && <p className="text-xs text-zinc-400">{auth.description}</p>}
        <Field
          label={`${auth.key}.username`}
          type="string"
          required
          value={values[`${auth.key}.username`] ?? ""}
          onChange={upd(`${auth.key}.username`)}
          placeholder="username"
        />
        <Field
          label={`${auth.key}.password`}
          type="string"
          required
          secret
          value={values[`${auth.key}.password`] ?? ""}
          onChange={upd(`${auth.key}.password`)}
          placeholder="password"
        />
      </>
    );
  }
  if (auth.type === "apiKey") {
    return (
      <Field
        label={auth.name ?? auth.key}
        type={`apiKey · ${auth.in ?? "header"}`}
        required
        description={auth.description}
        value={values[`${auth.key}.value`] ?? ""}
        onChange={upd(`${auth.key}.value`)}
        placeholder="key"
        mono
        secret
      />
    );
  }
  // bearer / oauth2 / other → a single token sent as `Authorization: Bearer …`
  return (
    <Field
      label={`${auth.key} token`}
      type={auth.type === "oauth2" ? "oauth2 · access token" : "bearer"}
      required
      description={auth.description}
      value={values[`${auth.key}.token`] ?? ""}
      onChange={upd(`${auth.key}.token`)}
      placeholder="token"
      mono
      secret
    />
  );
}

// ---- code sample generation (client) ----
function btoaSafe(s: string): string {
  try {
    return typeof btoa === "function" ? btoa(s) : Buffer.from(s).toString("base64");
  } catch {
    return s;
  }
}

function buildSample(
  lang: "cURL" | "JavaScript" | "Python",
  method: string,
  req: { url: string; headers: Record<string, string>; body?: string },
): string {
  const entries = Object.entries(req.headers);
  if (lang === "cURL") {
    const lines = [`curl --request ${method} \\`, `  --url ${req.url}`];
    for (const [k, v] of entries) lines[lines.length - 1] += ` \\\n  --header '${k}: ${v}'`;
    if (req.body) lines[lines.length - 1] += ` \\\n  --data '${req.body}'`;
    return lines.join("");
  }
  if (lang === "JavaScript") {
    const h = entries.map(([k, v]) => `    "${k}": "${v}",`).join("\n");
    const opts = [`  method: "${method}",`];
    if (entries.length) opts.push(`  headers: {\n${h}\n  },`);
    if (req.body) opts.push(`  body: ${JSON.stringify(req.body)},`);
    return `const response = await fetch("${req.url}", {\n${opts.join("\n")}\n});\nconst data = await response.json();`;
  }
  const h = entries.map(([k, v]) => `        "${k}": "${v}",`).join("\n");
  const args = [`    "${req.url}",`];
  if (entries.length) args.push(`    headers={\n${h}\n    },`);
  if (req.body) args.push(`    data=${JSON.stringify(req.body)},`);
  return `import requests\n\nresponse = requests.${method.toLowerCase()}(\n${args.join("\n")}\n)\nprint(response.json())`;
}

// JS/Python share enough surface that the JSON colorizer reads fine for them too (strings,
// numbers, keywords) without a full grammar.
function colorizeJsLike(src: string): string {
  return escapeHtml(src)
    .replace(/("(?:\\.|[^"\\])*")/g, '<span class="text-amber-300">$1</span>')
    .replace(/\b(await|const|async|import|def|print|method|headers|body|data)\b/g, '<span class="text-sky-300">$1</span>');
}
