import "server-only";
import { tool } from "ai";
import { z } from "zod";
import type { ToolSet } from "ai";
import { proxy } from "../nango";

/**
 * Google Drive read tools for the agent (SPEC §10.2 connector tool layer).
 *
 * Read-only by construction: these are the only Drive operations the agent has, and
 * every one is a GET. The agent's ability to *change* anything remains the §9.2
 * authoring backend, over the docs — a connected source is context, never a write target.
 *
 * Nango is the keychain, not a unified API: it injects the org's token and handles
 * refresh, but these are Google's own endpoints and Google's own response shapes. That's
 * the trade recorded in the §10.2 ADR — ~40 lines of provider-specific wrapper per
 * connector, in exchange for owning the code and keeping the exit cheap.
 */

// Drive returns a lot per file; the model needs enough to cite and choose, not everything.
const FILE_FIELDS = "files(id,name,mimeType,modifiedTime,webViewLink,owners(displayName))";

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  webViewLink?: string;
  owners?: { displayName?: string }[];
};

/**
 * Google Docs/Sheets/Slides are not stored as bytes — `files.get?alt=media` fails on
 * them with "Only files with binary content can be downloaded". They export instead, and
 * the export MIME type is per-format, so read_file has to branch on what it found.
 */
const EXPORT_AS: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
};

// A whole spreadsheet or a long doc would swamp the context window and the Slack reply
// that quotes it. Truncation is announced in the tool result so the model can say the
// document continues rather than implying it read all of it.
const MAX_CHARS = 20_000;

function describe(f: DriveFile) {
  return {
    id: f.id,
    name: f.name,
    type: f.mimeType,
    modified: f.modifiedTime,
    link: f.webViewLink,
    owner: f.owners?.[0]?.displayName,
  };
}

export function googleDriveTools(organizationId: string): ToolSet {
  const call = <T>(endpoint: string, params: Record<string, string | number | boolean>) =>
    proxy<T>({ organizationId, provider: "google-drive", endpoint, params });

  return {
    search_google_drive: tool({
      description:
        "Search the connected Google Drive for files by keyword. Returns names, types, " +
        "owners and links. Use before read_google_drive_file to find the right document.",
      inputSchema: z.object({
        query: z.string().describe("Keywords to search for in file names and contents."),
        limit: z.number().int().min(1).max(25).optional().describe("Max results (default 10)."),
      }),
      execute: async ({ query, limit }) => {
        // Drive's `q` is its own DSL and a raw apostrophe terminates the quoted string,
        // so escape before interpolating — a title like "Bob's notes" would otherwise be
        // a syntax error rather than a search.
        const escaped = query.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
        const res = await call<{ files?: DriveFile[] }>("/drive/v3/files", {
          q: `fullText contains '${escaped}' and trashed = false`,
          fields: FILE_FIELDS,
          pageSize: limit ?? 10,
          // Shared drives are where team documentation actually lives; without these two
          // the search silently covers only the user's own My Drive.
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        });
        if ("error" in res) return { error: res.error };
        const files = res.data.files ?? [];
        return files.length
          ? { files: files.map(describe) }
          : { files: [], note: "No matching files in the connected Drive." };
      },
    }),

    read_google_drive_file: tool({
      description:
        "Read the text of a Google Drive file by id (from search_google_drive). Google " +
        "Docs, Sheets and Slides are exported as text; other files are returned as-is.",
      inputSchema: z.object({
        fileId: z.string().describe("The Drive file id returned by search_google_drive."),
      }),
      execute: async ({ fileId }) => {
        const meta = await call<DriveFile>(`/drive/v3/files/${encodeURIComponent(fileId)}`, {
          fields: "id,name,mimeType,webViewLink",
          supportsAllDrives: true,
        });
        if ("error" in meta) return { error: meta.error };

        const exportAs = EXPORT_AS[meta.data.mimeType];
        const res = exportAs
          ? await call<string>(`/drive/v3/files/${encodeURIComponent(fileId)}/export`, {
              mimeType: exportAs,
            })
          : await call<string>(`/drive/v3/files/${encodeURIComponent(fileId)}`, {
              alt: "media",
              supportsAllDrives: true,
            });
        if ("error" in res) return { error: res.error };

        // Binary files (a PDF, an image) come back as something that isn't text; say so
        // rather than handing the model a wall of mojibake it will try to interpret.
        // Control bytes outside tab/newline/CR are the giveaway.
        const body = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
        if (/[\x00-\x08\x0E-\x1F]/.test(body.slice(0, 2000))) {
          return {
            name: meta.data.name,
            link: meta.data.webViewLink,
            error: "This file isn't text and can't be read directly.",
          };
        }
        const truncated = body.length > MAX_CHARS;
        return {
          name: meta.data.name,
          type: meta.data.mimeType,
          link: meta.data.webViewLink,
          content: truncated ? body.slice(0, MAX_CHARS) : body,
          ...(truncated ? { truncated: true, note: "Content truncated." } : {}),
        };
      },
    }),
  };
}
