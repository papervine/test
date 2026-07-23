#!/usr/bin/env bash
# Set up a fresh git worktree to SHARE the main checkout's dev env + deps, so worktrees don't
# drift (see CLAUDE.md → "Working across worktrees"). Run it from inside the new worktree:
#
#   bash bin/setup-worktree.sh
#
# Idempotent. Symlinks `.env.local` (one canonical secrets file for every worktree) to the main
# checkout. `.env.local*` is gitignored, so the symlink is never committed; both Next dev and the
# `--env-file=.env.local` scripts follow it. Deps are NOT shared — a worktree on a different
# branch can have different dependencies (symlinking node_modules to main breaks it), so run
# `npm ci` per worktree.
set -euo pipefail

# The main checkout = the parent of the shared git dir (works for any user/clone, no hardcoded path).
MAIN="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
HERE="$(git rev-parse --show-toplevel)"

if [ "$HERE" = "$MAIN" ]; then
  echo "This IS the main checkout ($MAIN) — it holds the canonical files; nothing to link."
  exit 0
fi

link() { # link <name>: symlink HERE/<name> -> MAIN/<name>, backing up a real file first
  local name="$1"
  local src="$MAIN/$name"
  local dst="$HERE/$name"
  if [ ! -e "$src" ] && [ ! -L "$src" ]; then echo "  skip $name (not in main)"; return; fi
  if [ -L "$dst" ]; then echo "  $name already linked"; return; fi
  if [ -e "$dst" ]; then mv "$dst" "$dst.bak-$(date +%Y%m%d)"; echo "  backed up existing $name -> $name.bak-$(date +%Y%m%d)"; fi
  ln -s "$src" "$dst"; echo "  linked $name -> $src"
}

echo "Linking this worktree ($HERE) to main ($MAIN):"
link .env.local
echo "Done — this worktree shares main's .env.local (edit $MAIN/.env.local to update them all)."
echo "If deps aren't installed yet, run: npm ci"
