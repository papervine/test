"use client";

import { useEffect, useRef, useState } from "react";
import { Link2, Loader2, Search, Upload, Youtube } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MEDIA_INPUTS, isSafeMediaUrl, toEmbedUrl, type MediaInputKind } from "@/lib/media-embed";
import {
  UPLOAD_KINDS,
  parseStorageError,
  storageOrigin,
  uploadThrewMessage,
  validateUpload,
  type UploadKind,
} from "@/lib/media-upload";
import { finalizeMediaUpload, listSiteMedia, requestMediaUpload } from "@/lib/actions/media";

// Collects the media for the `/` menu's items.
//
// Two shapes behind one dialog, because the two jobs are genuinely different: `embed` is only ever
// a URL someone pastes (nothing to browse — the file lives on YouTube), while `video` and `image`
// are files this site owns, so they get a picker: what's already here, plus an upload.
//
// Uploads go straight to object storage from the browser (see actions/media.ts for why), land
// under the session's draft prefix, and appear in the change list like any other edit — nothing is
// live until Publish.

export function MediaDialog({
  kind,
  org,
  site,
  branch,
  onSubmit,
  onClose,
}: {
  kind: MediaInputKind;
  org: string;
  site: string;
  branch: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const copy = MEDIA_INPUTS[kind];
  // `embed` has no file behind it; the other two are files in this site's storage.
  const uploadKind: UploadKind | null = kind === "embed" ? null : kind;
  // The field to land on. Claimed here, in the one callback Radix fires when it would otherwise
  // focus the dialog container itself — a focus() from a child's mount effect gets taken straight
  // back, which shows up as the first keystroke of a paste going nowhere.
  const firstField = useRef<HTMLInputElement>(null);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={uploadKind ? "max-w-2xl" : "max-w-lg"}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          firstField.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        {uploadKind ? (
          <FilePicker
            kind={uploadKind}
            searchRef={firstField}
            org={org}
            site={site}
            branch={branch}
            submitLabel={copy.submit}
            onSubmit={onSubmit}
            onClose={onClose}
          />
        ) : (
          <UrlOnly copy={copy} inputRef={firstField} onSubmit={onSubmit} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** `embed`: a URL and nothing else, with the provider named back before you commit. */
function UrlOnly({
  copy,
  inputRef,
  onSubmit,
  onClose,
}: {
  copy: (typeof MEDIA_INPUTS)[MediaInputKind];
  inputRef: React.RefObject<HTMLInputElement | null>;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");

  const trimmed = value.trim();
  const valid = isSafeMediaUrl(trimmed);
  const invalid = trimmed !== "" && !valid;
  const provider = valid ? toEmbedUrl(trimmed).provider : null;

  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor="pv-media-url">{copy.label}</Label>
        <Input
          id="pv-media-url"
          ref={inputRef}
          value={value}
          placeholder={copy.placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && valid) {
              e.preventDefault();
              onSubmit(trimmed);
            }
          }}
          aria-invalid={invalid}
          aria-describedby="pv-media-hint"
        />
        <Hint invalid={invalid} provider={provider} valid={valid} />
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => valid && onSubmit(trimmed)} disabled={!valid}>
          {copy.submit}
        </Button>
      </DialogFooter>
    </>
  );
}

function Hint({
  invalid,
  provider,
  valid,
}: {
  invalid: boolean;
  provider: string | null;
  valid: boolean;
}) {
  return (
    <p id="pv-media-hint" className="min-h-5 text-xs text-[var(--muted)]">
      {invalid ? (
        <span className="text-red-400">
          Use an https:// link or a path starting with / — other schemes aren&apos;t inserted.
        </span>
      ) : provider ? (
        <span className="inline-flex items-center gap-1.5 text-[var(--fg)]">
          <Youtube className="h-3.5 w-3.5" />
          {provider === "youtube" ? "YouTube" : provider === "vimeo" ? "Vimeo" : "Loom"} link —
          converted to its embeddable form.
        </span>
      ) : valid ? (
        <span className="inline-flex items-center gap-1.5">
          <Link2 className="h-3.5 w-3.5" />
          Embedded as-is.
        </span>
      ) : null}
    </p>
  );
}

/** `video` / `image`: the files this site already has, plus an upload. */
function FilePicker({
  kind,
  searchRef,
  org,
  site,
  branch,
  submitLabel,
  onSubmit,
  onClose,
}: {
  kind: UploadKind;
  searchRef: React.RefObject<HTMLInputElement | null>;
  org: string;
  site: string;
  branch: string;
  submitLabel: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [files, setFiles] = useState<string[] | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const res = await listSiteMedia({ orgSlug: org, siteSlug: site, branch, kind });
    if ("error" in res) {
      setError(res.error);
      setFiles([]);
      return;
    }
    setFiles(res.files);
  };
  // Load once on open. The list is small (paths only) and the dialog is short-lived, so there's
  // nothing to invalidate — an upload appends to it directly.
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const upload = async (file: File) => {
    setError(null);
    // Checked here for an instant answer AND again server-side, which is the one that counts.
    const local = validateUpload(kind, file.name, file.size);
    if ("error" in local) {
      setError(local.error);
      return;
    }
    setUploading(true);
    // Held outside the try so the catch can say WHERE the request was going — the most useful
    // thing to know when it never got a response.
    let endpoint: string | null = null;
    try {
      const ticket = await requestMediaUpload({
        orgSlug: org,
        siteSlug: site,
        branch,
        kind,
        filename: file.name,
        size: file.size,
      });
      if ("error" in ticket) {
        setError(ticket.error);
        return;
      }
      endpoint = storageOrigin(ticket.uploadUrl);
      // Straight to storage — the bytes never pass through the app.
      const put = await fetch(ticket.uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "content-type": ticket.contentType },
      });
      if (!put.ok) {
        // Read the body: S3 and MinIO answer with an XML <Code> that says exactly what went
        // wrong (SignatureDoesNotMatch, RequestTimeTooSkewed, EntityTooLarge…). A bare status
        // sends whoever hits this reading network logs for something the server already said.
        const detail = parseStorageError(await put.text().catch(() => ""));
        setError(`Upload failed (${put.status})${detail ? ` — ${detail}` : ""}`);
        return;
      }
      const done = await finalizeMediaUpload({
        orgSlug: org,
        siteSlug: site,
        branch,
        kind,
        path: ticket.path,
      });
      if ("error" in done) {
        setError(done.error);
        return;
      }
      setFiles((prev) => (prev?.includes(done.path) ? prev : [...(prev ?? []), done.path].sort()));
      setSelected(done.path);
    } catch (e) {
      // Without this the upload fails SILENTLY: a rejected fetch (blocked by CORS, storage
      // unreachable, connection dropped mid-transfer) or a server action that throws escapes
      // here, `finally` stops the spinner, and the dialog shows nothing at all — which reads as
      // the button doing nothing. `TypeError: Failed to fetch` in particular carries no detail by
      // design, so name the two things it actually means and where the request was going.
      setError(uploadThrewMessage(e, endpoint));
    } finally {
      setUploading(false);
    }
  };

  const shown = (files ?? []).filter((f) => f.toLowerCase().includes(query.trim().toLowerCase()));
  const spec = UPLOAD_KINDS[kind];

  return (
    <>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
        <Input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${kind === "video" ? "videos" : "images"}`}
          aria-label={`Search ${kind === "video" ? "videos" : "images"}`}
          className="pl-9"
        />
      </div>

      <div className="min-h-64 max-h-[50vh] overflow-y-auto">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex h-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[rgba(var(--ink-rgb),0.25)] text-sm text-[var(--muted)] transition-colors hover:border-[rgba(var(--ink-rgb),0.45)] hover:text-[var(--fg)] disabled:opacity-60"
          >
            {uploading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Uploading…
              </>
            ) : (
              <>
                <Upload className="h-5 w-5" />
                Upload
              </>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={spec.extensions.map((e) => `.${e}`).join(",")}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Reset so choosing the same file twice still fires a change event.
              e.target.value = "";
              if (file) void upload(file);
            }}
          />

          {files === null ? (
            <div className="flex h-32 items-center justify-center text-xs text-[var(--muted)]">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : (
            shown.map((path) => (
              <button
                type="button"
                key={path}
                onClick={() => setSelected(path)}
                onDoubleClick={() => onSubmit(`/${path}`)}
                className={`flex h-32 flex-col overflow-hidden rounded-lg border text-left transition-colors ${
                  selected === path
                    ? "border-[var(--blue)] bg-[rgba(var(--ink-rgb),0.06)]"
                    : "border-[rgba(var(--ink-rgb),0.12)] hover:border-[rgba(var(--ink-rgb),0.3)]"
                }`}
              >
                <MediaThumb kind={kind} site={site} path={path} />
                <span className="truncate px-2 py-1.5 text-xs text-[var(--fg)]" title={path}>
                  {path.split("/").pop()}
                </span>
              </button>
            ))
          )}
        </div>

        {files !== null && files.length === 0 && !uploading && (
          <p className="pt-4 text-xs text-[var(--muted)]">
            Nothing here yet — upload a file to get started. {spec.label}.
          </p>
        )}
        {files !== null && files.length > 0 && shown.length === 0 && (
          <p className="pt-4 text-xs text-[var(--muted)]">No {kind}s match “{query}”.</p>
        )}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => selected && onSubmit(`/${selected}`)} disabled={!selected}>
          {submitLabel}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * A preview of the actual file, through the tenant asset route — which serves the draft copy to an
 * editor, so a just-uploaded file previews before it's published. `preload="metadata"` fetches only
 * the header, so a grid of videos doesn't pull every byte.
 */
function MediaThumb({ kind, site, path }: { kind: UploadKind; site: string; path: string }) {
  const src = `/api/tenant-asset/${site}/${path}`;
  return (
    <span className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[rgba(var(--ink-rgb),0.06)]">
      {kind === "video" ? (
        <video src={src} preload="metadata" muted className="h-full w-full object-cover" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
      )}
    </span>
  );
}
