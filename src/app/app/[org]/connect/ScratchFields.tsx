"use client";

import { useState } from "react";
import { Field } from "@/components/platform/Field";
import { slugify } from "@/lib/slug";
import { domains } from "@/lib/tenant-host";

/**
 * The "Start from scratch" fields of the add-site chooser (SPEC §10.11): just a name. The
 * live subdomain preview mirrors the org-naming step in onboarding, so the connection
 * between what you type and the URL you get is visible before you commit.
 *
 * Renders no <form> or submit button — the chooser owns those.
 */
export function ScratchFields() {
  const [name, setName] = useState("");

  return (
    <>
      <Field
        name="name"
        label="Site name"
        placeholder="Acme Docs"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        hint={
          name && (
            <span className="mt-1 block text-xs text-[var(--muted)]">
              {slugify(name) || "—"}.{domains.tenant}
            </span>
          )
        }
      />
      <p className="text-xs text-[var(--muted)]">
        We’ll add a starter <code>docs.json</code> and a couple of pages, so your site
        renders straight away. Everything after that happens in Studio — there’s no
        repository to clone.
      </p>
    </>
  );
}
