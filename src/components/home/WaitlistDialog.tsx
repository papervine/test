"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { WAITLIST_NOTE_MAX } from "@/lib/waitlist";

/**
 * The little celebration on success.
 *
 * `canvas-confetti` is imported at the moment it fires, not at the top of the file: this
 * component is reachable from the hero, which is the LCP surface, and a library that runs once
 * after a form submit has no business in the initial bundle (the same rule the tour video and
 * the editor chunk follow).
 *
 * Brand colours rather than the default rainbow, and skipped entirely under reduced motion —
 * a burst of particles is exactly what that setting is about.
 */
async function celebrate() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const { default: confetti } = await import("canvas-confetti");
  confetti({
    particleCount: 90,
    spread: 70,
    // Aimed at where the dialog sits rather than the default bottom of the screen.
    origin: { y: 0.45 },
    colors: ["#5b8cff", "#a974ff", "#ffffff"],
    disableForReducedMotion: true,
    scalar: 0.9,
  });
}

/**
 * The hero's primary action: join the waitlist, without leaving the page.
 *
 * A dialog rather than a `/waitlist` route on purpose. The hero's whole job is to get someone to
 * act on what they just read; navigating away costs the context that persuaded them, and a
 * two-field form doesn't need a page of its own.
 *
 * Two fields, one of them optional, and that ratio is the design: every required field costs
 * completions, and the address is the only thing actually needed. The optional note is left as
 * free text rather than a set of buckets because pre-launch the useful part is their words —
 * which are the copy we should be writing back at them — and a bucket can be read out of a
 * sentence later, while a sentence can't be recovered from a bucket.
 */
export function WaitlistDialog({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(form: FormData) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          note: form.get("note"),
          company: form.get("company"),
          // Captured, not asked: where they were when they decided. One less field to fill and
          // more reliable than a "how did you hear about us?" anyone would skip.
          source: typeof window === "undefined" ? null : window.location.pathname,
        }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(body?.error ?? "Something went wrong — try again in a moment.");
        return;
      }
      setDone(true);
      // Deliberately not awaited: the success copy should be on screen before the chunk loads,
      // and a failed dynamic import must never turn a successful signup into an error.
      void celebrate().catch(() => {});
    } catch {
      // A network failure, not a rejection: say so, because "try again" is genuinely the fix.
      setError("Couldn't reach us just now — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Reset only on the way OUT, and only after the animation would have finished, so the
        // form doesn't visibly flip back to its empty state while the dialog is closing.
        if (!next) setTimeout(() => setError(null), 200);
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className={className}>
        {done ? (
          <>
            <DialogHeader>
              <DialogTitle>You&apos;re on the list</DialogTitle>
              <DialogDescription>
                We&apos;ll email you when there&apos;s something to try. No other mail, and
                nothing to unsubscribe from.
              </DialogDescription>
            </DialogHeader>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Join the waitlist</DialogTitle>
              <DialogDescription>
                We&apos;ll let you know when it&apos;s your turn. Your email, and nothing else,
                unless you want to tell us more.
              </DialogDescription>
            </DialogHeader>

            <form
              action={submit}
              className="grid gap-4"
              // The browser's own bubble would fire before the request and say something less
              // useful than the server's message; one validator, one voice.
              noValidate
            >
              <div className="grid gap-2">
                <Label htmlFor="waitlist-email">Email</Label>
                <Input
                  id="waitlist-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  autoFocus
                  required
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="waitlist-note">
                  What are you hoping to use it for?{" "}
                  <span className="font-normal text-[var(--muted)]">(optional)</span>
                </Label>
                <Textarea
                  id="waitlist-note"
                  name="note"
                  rows={3}
                  maxLength={WAITLIST_NOTE_MAX}
                  placeholder="Moving a docs.json site over, an internal handbook, docs for an API…"
                />
              </div>

              {/* Honeypot. Hidden from sight AND from assistive tech and tab order, so the only
                  thing that ever fills it is something reading the DOM. `position: absolute` off
                  screen rather than `display: none`, which the better bots already skip. */}
              <input
                type="text"
                name="company"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden
                className="pointer-events-none absolute left-[-9999px] h-px w-px opacity-0"
              />

              {error ? (
                <p role="alert" className="text-sm text-[var(--danger)]">
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={busy}
                className="db-cta inline-flex items-center justify-center rounded-xl px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60"
              >
                {busy ? "Adding you…" : "Join waitlist"}
              </button>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
