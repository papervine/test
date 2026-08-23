"use client";

import { useState } from "react";
import { FilePlus2, FolderPlus, Plus, FileText, PanelTop } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

// The "+" on a navigation group row: add a page or a group under it. Revealed on hover where
// hover exists and always visible where it doesn't — same rule as the settings cog beside it,
// for the same reason (a hover-only control is unreachable on a touch device).
const ADD_CLASS =
  "pv-nav-add shrink-0 rounded p-1 text-neutral-500 hover:bg-neutral-200 focus-visible:opacity-100 " +
  "data-[state=open]:opacity-100 [@media(hover:hover)]:opacity-0 " +
  "[@media(hover:hover)]:group-hover:opacity-100 [@media(hover:none)]:p-2 dark:hover:bg-neutral-700";

export type NavAddHandlers = {
  onNewPage: (group: string, title: string) => void;
  onNewGroup: (parent: string, name: string) => void;
  // Site-level, not group-level: a tab is the bar across the top of the site, so it doesn't nest
  // inside the group whose "+" opened the menu. It lives here because this is the "add to the
  // navigation" menu, which is where the reference puts it too.
  onNewTab: (name: string) => void;
  onAddExisting: (group: string, slug: string) => void;
  // Drag-and-drop reordering. Pages are addressed positionally because the same slug may appear
  // in more than one group — the row you picked up is the one that moves.
  onMovePage: (
    from: { group: string; index: number },
    to: { group: string; index: number },
  ) => void;
  onMoveGroup: (group: string, toIndex: number) => void;
  // Pages that exist as files but aren't referenced by this docs.json navigation.
  unlistedSlugs: string[];
  // True when the site has no tabs yet, so adding one restructures the navigation. The dialog
  // says so up front rather than surprising you after the fact.
  tabless: boolean;
};

export function NavAddMenu({ group, h }: { group: string; h: NavAddHandlers }) {
  // `prompt` holds which naming dialog is open; one dialog serves all three, since the only
  // difference is the label and where the name goes.
  const [prompt, setPrompt] = useState<"page" | "group" | "tab" | null>(null);
  const [value, setValue] = useState("");

  function submit() {
    const name = value.trim();
    if (!name) return;
    if (prompt === "page") h.onNewPage(group, name);
    else if (prompt === "group") h.onNewGroup(group, name);
    else if (prompt === "tab") h.onNewTab(name);
    setPrompt(null);
    setValue("");
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger aria-label={`Add to ${group}`} className={ADD_CLASS}>
          <Plus className="h-3.5 w-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            onSelect={() => {
              setValue("");
              setPrompt("page");
            }}
          >
            <FilePlus2 /> New page
          </DropdownMenuItem>

          {/* Only offered when there's something to add — an empty submenu is a dead end. */}
          {h.unlistedSlugs.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FileText /> Add existing page
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
                {h.unlistedSlugs.map((slug) => (
                  <DropdownMenuItem key={slug} onSelect={() => h.onAddExisting(group, slug)}>
                    <span className="truncate font-mono text-xs">{slug}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              setValue("");
              setPrompt("group");
            }}
          >
            <FolderPlus /> New group
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              setValue("");
              setPrompt("tab");
            }}
          >
            <PanelTop /> New tab
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={prompt !== null} onOpenChange={(o) => !o && setPrompt(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {prompt === "group" ? "New group" : prompt === "tab" ? "New tab" : "New page"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="nav-add-name">
              {prompt === "group" ? "Group name" : prompt === "tab" ? "Tab name" : "Page title"}
            </Label>
            <Input
              id="nav-add-name"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              // Enter is the expected way out of a one-field dialog.
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={
                prompt === "group" ? "Guides" : prompt === "tab" ? "API Reference" : "Getting started"
              }
            />
            <p className="text-xs text-[var(--muted)]">
              {prompt === "tab" ? (
                <>
                  A tab is a section across the top of your site.
                  {h.tabless && (
                    <>
                      {" "}
                      Your site doesn’t use tabs yet, so your current navigation becomes a first
                      tab called <strong>Documentation</strong>.
                    </>
                  )}
                </>
              ) : prompt === "group" ? (
                `Added inside “${group}”.`
              ) : (
                `Created in “${group}”. The page URL comes from the title.`
              )}
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPrompt(null)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={!value.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
