"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { connectRepo, createBlankSite, type ConnectState } from "@/lib/actions/sites";
import { Button } from "@/components/platform/Button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import {
  START_METHODS,
  defaultStartMethod,
  submitLabel,
  type StartMethod,
} from "@/lib/start-methods";
import { GitConnectFields, type GitConnectFieldsProps } from "./GitConnectFields";
import { ScratchFields } from "./ScratchFields";

const initial: ConnectState = {};

export type NewSiteChooserProps = GitConnectFieldsProps & {
  /** Does this org already have a site? Drives the first-run framing and the Back link. */
  hasSites: boolean;
  /** Can this viewer open Studio? A `member` can't, so they can't start from scratch. */
  canUseStudio: boolean;
};

/**
 * The add-site start-method chooser (SPEC §10.11): pick how to begin, fill that method's
 * fields inline, submit once. Two ways in today — a Papervine-hosted site written in Studio,
 * or a connected GitHub repo.
 *
 * Both server actions are wired through `useActionState` and both return
 * `{ error?, redirectTo? }`, and the redirect is applied with a HARD navigation because the
 * app-host Host rewrite is skipped by soft RSC navs (see the gotcha in CLAUDE.md).
 */
export function NewSiteChooser({ hasSites, canUseStudio, ...github }: NewSiteChooserProps) {
  const orgSlug = String(useParams().org);
  const [gitState, gitAction, gitPending] = useActionState(connectRepo, initial);
  const [blankState, blankAction, blankPending] = useActionState(createBlankSite, initial);
  const [method, setMethod] = useState<StartMethod>(() => defaultStartMethod({ canUseStudio }));

  const pending = method === "scratch" ? blankPending : gitPending;
  const error = method === "scratch" ? blankState.error : gitState.error;

  // On success the action returns the new site's bare URL — navigate with a hard load so the
  // app-host Host rewrite applies.
  useEffect(() => {
    const to = gitState.redirectTo ?? blankState.redirectTo;
    if (to) window.location.assign(to);
  }, [gitState.redirectTo, blankState.redirectTo]);

  return (
    <div className="mx-auto max-w-xl px-4 sm:px-6 lg:px-8 py-12">
      {/* Only when there's somewhere to go back TO: for a site-less org, /:org redirects
          straight back here, so a Back link would be a loop. */}
      {hasSites && (
        <Link
          href={`/${orgSlug}`}
          className="text-sm text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
        >
          ← Back
        </Link>
      )}
      <h1 className="mt-4 text-2xl font-semibold">
        {hasSites ? "Add a site" : "Create your first site"}
      </h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        {hasSites
          ? "Add another docs site to this organization."
          : "Your organization doesn’t have a site yet. Start from scratch and write in the browser, or connect a docs repo you already have."}
      </p>

      {/* ONE form wrapping the card list AND the button, with the action chosen by the
          selected method — rather than a form per card and a button associated to one of them
          by `form=`. Only the selected method's fields are ever mounted, so a single dynamic
          action is unambiguous, and it keeps the submit button in its natural place in the
          DOM. The radios carry no `name`, so they contribute nothing to the payload. */}
      <form action={method === "scratch" ? blankAction : gitAction}>
        <RadioGroup
          value={method}
          onValueChange={(value) => setMethod(value as StartMethod)}
          // Can't switch method mid-create — an action is already running.
          disabled={pending}
          aria-label="How do you want to start?"
          className="mt-8 gap-3"
        >
          {START_METHODS.map((option) => {
            const selected = option.value === method;
            // A member can't open Studio, so creating a hosted site would hand them one they
            // can never edit. Show why rather than silently hiding the option.
            const unavailable = option.value === "scratch" && !canUseStudio;
            const Icon = option.icon;
            return (
              <div
                key={option.value}
                className={cn(
                  "rounded-xl border p-4 transition-colors",
                  selected
                    ? "border-[var(--blue)] bg-[rgba(var(--ink-rgb),0.05)]"
                    : "border-[var(--line)] bg-[var(--card)] hover:border-[rgba(var(--ink-rgb),0.2)]",
                  unavailable && "opacity-60",
                )}
              >
                <label
                  htmlFor={`start-${option.value}`}
                  className={cn(
                    "flex items-start gap-3",
                    unavailable ? "cursor-not-allowed" : "cursor-pointer",
                  )}
                >
                  <Icon className="mt-0.5 size-4 shrink-0 text-[var(--muted)]" aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{option.title}</span>
                    <span className="mt-0.5 block text-xs text-[var(--muted)]">
                      {option.description}
                    </span>
                  </span>
                  <RadioGroupItem
                    id={`start-${option.value}`}
                    value={option.value}
                    disabled={unavailable}
                    className="ml-auto mt-1 shrink-0"
                  />
                </label>

                {unavailable && (
                  <p className="mt-3 pl-7 text-xs text-[var(--muted)]">
                    Studio isn’t enabled for your role yet — ask an owner or admin.
                  </p>
                )}

                {selected && (
                  <div className="mt-5 space-y-5 border-t border-[var(--line)] pt-5">
                    {option.value === "scratch" ? (
                      <ScratchFields />
                    ) : (
                      <GitConnectFields {...github} />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </RadioGroup>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        <Button type="submit" full disabled={pending} className="mt-6">
          {submitLabel(method, pending)}
        </Button>
      </form>
    </div>
  );
}
