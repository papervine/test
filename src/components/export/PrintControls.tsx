"use client";

import { useEffect } from "react";
import { FileDown } from "lucide-react";

/**
 * The toolbar atop the export view (SPEC §10.4). It opens the browser print dialog, where
 * "Save as PDF" produces the single offline file — full renderer fidelity, no server-side
 * PDF pipeline. Hidden from the printout itself (`pv-no-print`).
 *
 * It also strips `.dark` from the document: the export is a print artifact and must be
 * black-on-white regardless of the reader's stored theme (the root layout's pre-paint
 * script may have set dark mode from localStorage).
 */
export function PrintControls() {
  useEffect(() => {
    document.documentElement.classList.remove("dark");
  }, []);

  return (
    <div className="pv-no-print sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-black/10 bg-white/90 px-6 py-3 text-zinc-900 backdrop-blur">
      <span className="text-sm text-zinc-600">
        Use <b className="font-medium text-zinc-900">Save as PDF</b> in the print dialog
        to download this document.
      </span>
      <button
        type="button"
        onClick={() => window.print()}
        className="db-cta inline-flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-sm"
      >
        <FileDown className="h-4 w-4" />
        Save as PDF
      </button>
    </div>
  );
}
