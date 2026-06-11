"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
} from "lucide-react";
import {
  AUTH_METHODS,
  AUTH_METHOD_META,
  type AuthMethod,
  type ReaderAuthConfig,
} from "@/lib/reader-auth";
import { Switch } from "@/components/ui/switch";
import {
  setAuthEnabled,
  setAuthMethod,
  saveAuthConfig,
  regenerateJwtSecret,
  type AuthActionState,
} from "./actions";

export function AuthenticationForm({
  enabled,
  method,
  config,
  secret,
}: {
  enabled: boolean;
  method: AuthMethod;
  config: ReaderAuthConfig;
  secret: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Editable copies of the server state. The server is the source of truth — after an
  // action we router.refresh() and resync these from the new props (see effect below).
  const [loginUrl, setLoginUrl] = useState(config.loginUrl ?? "");
  const [authorizationUrl, setAuthorizationUrl] = useState(config.authorizationUrl ?? "");
  const [tokenUrl, setTokenUrl] = useState(config.tokenUrl ?? "");
  const [userInfoUrl, setUserInfoUrl] = useState(config.userInfoUrl ?? "");
  const [clientId, setClientId] = useState(config.clientId ?? "");
  const [scopes, setScopes] = useState(config.scopes ?? "");
  const [secretValue, setSecretValue] = useState(secret);
  const [reveal, setReveal] = useState(false);
  const [copied, setCopied] = useState(false);

  // Resync from props whenever the server state changes (method switch, regenerate,
  // enable-seeding all round-trip through router.refresh()).
  useEffect(() => {
    setLoginUrl(config.loginUrl ?? "");
    setAuthorizationUrl(config.authorizationUrl ?? "");
    setTokenUrl(config.tokenUrl ?? "");
    setUserInfoUrl(config.userInfoUrl ?? "");
    setClientId(config.clientId ?? "");
    setScopes(config.scopes ?? "");
    setSecretValue(secret);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, secret, config]);

  function run(fn: () => Promise<AuthActionState>, after?: () => void) {
    setError(null);
    setSaved(false);
    start(async () => {
      const res = await fn();
      if (res.error) {
        setError(res.error);
        return;
      }
      after?.();
      router.refresh();
    });
  }

  function copySecret() {
    void navigator.clipboard?.writeText(secretValue).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="mt-8 max-w-2xl space-y-4">
      {/* Master switch */}
      <div className="db-feature flex items-start justify-between gap-6 rounded-xl px-5 py-4">
        <div>
          <h2 className="text-base font-medium">Enable Authentication</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Require users to authenticate before accessing your documentation.
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={() => run(() => setAuthEnabled(!enabled))}
          disabled={pending}
          aria-label="Enable authentication"
          className="mt-0.5"
        />
      </div>

      {/* Custom Authentication — only relevant once gating is on */}
      {enabled && (
        <div className="db-feature rounded-xl px-5 py-5">
          <h2 className="text-base font-medium">Custom Authentication</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Choose how readers prove who they are. We verify a signed assertion from your
            own login system — we never store reader credentials.
          </p>

          {/* Method picker */}
          <div className="mt-4 inline-flex rounded-lg border border-white/[0.08] p-1">
            {AUTH_METHODS.map((m) => {
              const activeM = m === method;
              return (
                <button
                  key={m}
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (m !== method) run(() => setAuthMethod(m));
                  }}
                  className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${
                    activeM
                      ? "bg-white/[0.10] text-[var(--fg)]"
                      : "text-[var(--muted)] hover:text-[var(--fg)]"
                  }`}
                >
                  {AUTH_METHOD_META[m].label}
                </button>
              );
            })}
          </div>

          <p className="mt-3 text-sm text-[var(--muted)]">
            {AUTH_METHOD_META[method].tagline}
          </p>

          {/* Per-method config */}
          <div className="mt-5 space-y-4">
            {method === "jwt" && (
              <>
                <Field label="Login URL" hint="Where we send an unauthenticated reader to sign in.">
                  <UrlInput
                    value={loginUrl}
                    onChange={setLoginUrl}
                    placeholder="https://app.acme.com/login"
                  />
                </Field>
                <Field
                  label="Signing secret"
                  hint="Your backend signs reader JWTs with this; we verify with it. Keep it secret."
                >
                  <div className="flex items-center gap-2">
                    <div className="flex flex-1 items-stretch overflow-hidden rounded-lg border border-white/[0.08]">
                      <input
                        readOnly
                        value={reveal ? secretValue : mask(secretValue)}
                        spellCheck={false}
                        className="min-w-0 flex-1 bg-white/[0.02] px-3 py-2.5 font-mono text-xs text-[var(--fg)] outline-none"
                      />
                      <button
                        type="button"
                        aria-label={reveal ? "Hide secret" : "Reveal secret"}
                        onClick={() => setReveal((v) => !v)}
                        className="flex items-center px-3 text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
                      >
                        {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                      <button
                        type="button"
                        aria-label="Copy secret"
                        onClick={copySecret}
                        className="flex items-center border-l border-white/[0.08] px-3 text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
                      >
                        {copied ? (
                          <Check className="h-4 w-4 text-emerald-400" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(regenerateJwtSecret)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-3 py-2.5 text-sm text-[var(--muted)] transition-colors hover:text-[var(--fg)] disabled:opacity-50"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Regenerate
                    </button>
                  </div>
                </Field>
              </>
            )}

            {method === "oauth" && (
              <>
                <Field label="Authorization URL">
                  <UrlInput
                    value={authorizationUrl}
                    onChange={setAuthorizationUrl}
                    placeholder="https://auth.acme.com/oauth/authorize"
                  />
                </Field>
                <Field label="Token URL">
                  <UrlInput
                    value={tokenUrl}
                    onChange={setTokenUrl}
                    placeholder="https://auth.acme.com/oauth/token"
                  />
                </Field>
                <Field label="User info URL" hint="Returns the reader's groups and personalization JSON.">
                  <UrlInput
                    value={userInfoUrl}
                    onChange={setUserInfoUrl}
                    placeholder="https://auth.acme.com/userinfo"
                  />
                </Field>
                <Field label="Client ID">
                  <TextInput value={clientId} onChange={setClientId} placeholder="acme-docs" />
                </Field>
                <Field label="Client secret" hint="Stored encrypted. Leave blank to keep the current one.">
                  <SecretInput
                    value={secretValue}
                    onChange={setSecretValue}
                    reveal={reveal}
                    onToggleReveal={() => setReveal((v) => !v)}
                  />
                </Field>
                <Field label="Scopes" hint="Space-separated. Optional.">
                  <TextInput value={scopes} onChange={setScopes} placeholder="openid profile" />
                </Field>
              </>
            )}

            {method === "password" && (
              <Field
                label="Shared password"
                hint="Every reader enters this one password. At least 8 characters."
              >
                <SecretInput
                  value={secretValue}
                  onChange={setSecretValue}
                  reveal={reveal}
                  onToggleReveal={() => setReveal((v) => !v)}
                  placeholder="a strong shared secret"
                />
              </Field>
            )}
          </div>

          <div className="mt-5 flex items-center gap-3">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(
                  () =>
                    saveAuthConfig({
                      method,
                      loginUrl,
                      authorizationUrl,
                      tokenUrl,
                      userInfoUrl,
                      clientId,
                      scopes,
                      // JWT secret is server-managed (regenerate), so don't resend it.
                      secret: method === "jwt" ? undefined : secretValue,
                    }),
                  () => setSaved(true),
                )
              }
              className="db-cta inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm disabled:opacity-50"
            >
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {pending ? "Saving…" : "Save"}
            </button>
            {saved && !pending && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Saved
              </span>
            )}
          </div>

          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-sm font-medium text-[var(--fg)]">{label}</label>
      {hint && <p className="mb-2 mt-0.5 text-xs text-[var(--muted)]">{hint}</p>}
      <div className={hint ? "" : "mt-2"}>{children}</div>
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      spellCheck={false}
      autoCapitalize="none"
      className="w-full rounded-lg border border-white/[0.08] bg-transparent px-3 py-2.5 text-sm text-[var(--fg)] outline-none placeholder:text-[var(--muted)]/60 focus:border-[var(--blue)]/50"
    />
  );
}

function UrlInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="url"
      inputMode="url"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      spellCheck={false}
      autoCapitalize="none"
      className="w-full rounded-lg border border-white/[0.08] bg-transparent px-3 py-2.5 text-sm text-[var(--fg)] outline-none placeholder:text-[var(--muted)]/60 focus:border-[var(--blue)]/50"
    />
  );
}

function SecretInput({
  value,
  onChange,
  reveal,
  onToggleReveal,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  reveal: boolean;
  onToggleReveal: () => void;
  placeholder?: string;
}) {
  return (
    <div className="flex items-stretch overflow-hidden rounded-lg border border-white/[0.08] focus-within:border-[var(--blue)]/50">
      <input
        type={reveal ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="none"
        autoComplete="off"
        className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm text-[var(--fg)] outline-none placeholder:text-[var(--muted)]/60"
      />
      <button
        type="button"
        aria-label={reveal ? "Hide" : "Reveal"}
        onClick={onToggleReveal}
        className="flex items-center px-3 text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
      >
        {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

// Length-preserving dot mask so the revealed/hidden toggle doesn't reflow the field.
function mask(value: string): string {
  return value ? "•".repeat(Math.min(value.length, 44)) : "";
}
