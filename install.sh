#!/usr/bin/env bash
# Alfred installer for macOS/Linux — the POSIX counterpart to install.ps1.
# Idempotent: backs up before touching, merges (never deletes), rewrites source-machine
# paths to the target machine, and translates the Windows-only `cmd /c node ...` hook
# syntax install.ps1 never has to touch (it stays on Windows) into a direct `node ...`
# call. Run with --dry-run to preview.
#
#   ./install.sh                 # install
#   ./install.sh --dry-run       # preview only, touch nothing
#   ./install.sh --skip-claude-md
#   ./install.sh --claude-home /path --home-dir /path

set -euo pipefail

# --- Configuration ---
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_HOME="${HOME}/.claude"
HOME_DIR="${HOME}"
DRY_RUN=0
SKIP_CLAUDE_MD=0
SOURCE_USER="C:/Users/dishi"   # path baked into hooks/settings at export time (Windows source)

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --skip-claude-md) SKIP_CLAUDE_MD=1; shift ;;
    --claude-home) CLAUDE_HOME="$2"; shift 2 ;;
    --home-dir) HOME_DIR="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="${CLAUDE_HOME}/backups/alfred-v4-install-${STAMP}"

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; OFF='\033[0m'
step() { printf "${CYAN}==> %s${OFF}\n" "$1"; }
ok()   { printf "    ${GREEN}%s${OFF}\n" "$1"; }
warn() { printf "    ${YELLOW}%s${OFF}\n" "$1"; }

# Merge-copy a directory: back up the destination if it exists, then copy every source file
# on top without deleting anything already there. Mirrors Copy-Merged in install.ps1.
copy_merged() {
  local from="$1" to="$2" label
  label="$(basename "$from")"
  if [ "$DRY_RUN" = "1" ]; then warn "[dry-run] would merge ${from} -> ${to}"; return; fi
  if [ -d "$to" ]; then
    mkdir -p "$BACKUP_DIR"
    cp -R "$to" "${BACKUP_DIR}/${label}" 2>/dev/null || true
  fi
  mkdir -p "$to"
  cp -R "${from}/." "$to"
  ok "merged ${label} -> ${to}"
}

trap 'echo "INSTALL FAILED" >&2; exit 1' ERR

step "Alfred install (target: ${CLAUDE_HOME})"
[ "$DRY_RUN" = "1" ] && warn "DRY RUN - no changes will be made"

copy_merged "${REPO_ROOT}/agents"   "${CLAUDE_HOME}/agents"
copy_merged "${REPO_ROOT}/skills"   "${CLAUDE_HOME}/skills"
copy_merged "${REPO_ROOT}/commands" "${CLAUDE_HOME}/commands"
copy_merged "${REPO_ROOT}/helpers"  "${CLAUDE_HOME}/helpers"

# CLAUDE.md files (skippable; backed up if present)
if [ "$SKIP_CLAUDE_MD" != "1" ]; then
  # Delimiter is "|", not ":" -- HOME_DIR/CLAUDE_HOME are Windows paths on Git Bash
  # (e.g. "C:/Users/dishi"), and a ":"-delimited pair collides with the drive-letter
  # colon, silently truncating the destination path down to "/Users/...".
  for pair in "claude-md/home-CLAUDE.md|${HOME_DIR}/CLAUDE.md" "claude-md/global-CLAUDE.md|${CLAUDE_HOME}/CLAUDE.md"; do
    src_rel="${pair%%|*}"; dst="${pair##*|}"
    src="${REPO_ROOT}/${src_rel}"
    if [ "$DRY_RUN" = "1" ]; then warn "[dry-run] would install ${src_rel} -> ${dst}"; continue; fi
    if [ -f "$dst" ]; then
      mkdir -p "$BACKUP_DIR"
      cp -f "$dst" "${BACKUP_DIR}/$(basename "$dst").$(basename "$src_rel")"
    fi
    mkdir -p "$(dirname "$dst")"
    cp -f "$src" "$dst"
    ok "installed ${src_rel}"
  done
fi

# Settings: path-rewritten AND translated off the Windows-only `cmd /c node ...` hook
# syntax; only auto-written when absent. Uses node (already a hard dependency of every
# helper in this repo) for safe string substitution instead of shell-escaping JSON by hand.
SETTINGS_SRC="${REPO_ROOT}/settings/settings.reference.json"
SETTINGS_DST="${CLAUDE_HOME}/settings.json"
if [ "$DRY_RUN" = "1" ]; then
  warn "[dry-run] would handle settings.json"
else
  REWRITTEN="$(node -e '
    const fs = require("fs");
    const [src, sourceUser, targetUser] = process.argv.slice(1);
    let text = fs.readFileSync(src, "utf8");
    // Windows source path, forward-slash and backslash-escaped forms.
    text = text.split(sourceUser).join(targetUser);
    const sourceUserBackslash = sourceUser.replace(/\//g, "\\\\");
    text = text.split(sourceUserBackslash).join(targetUser);
    // Git-Bash/WSL-style form ("//c/Users/dishi" — lowercase drive letter, double leading
    // slash) some permission patterns use. On a real macOS/Linux target there is no drive
    // letter, so the natural fix is dropping the Windows-only prefix entirely and using the
    // plain POSIX home path instead of trying to construct an equivalent that does not exist.
    const sourceUserPosix = "//" + sourceUser[0].toLowerCase() + sourceUser.slice(2);
    text = text.split(sourceUserPosix).join(targetUser);
    // "cmd /c node <path>" only means something on Windows; direct invocation is correct here.
    text = text.replace(/cmd \/c node /g, "node ");
    process.stdout.write(text);
  ' "$SETTINGS_SRC" "$SOURCE_USER" "$HOME_DIR")"

  if [ ! -f "$SETTINGS_DST" ]; then
    printf '%s' "$REWRITTEN" > "$SETTINGS_DST"
    ok "wrote settings.json (no existing file)"
  else
    printf '%s' "$REWRITTEN" > "${CLAUDE_HOME}/settings.merged-proposal.json"
    warn "settings.json exists - wrote settings.merged-proposal.json; merge hooks/permissions manually"
  fi

  cp -f "${REPO_ROOT}/settings/config-policy.json" "${CLAUDE_HOME}/config-policy.json"
  ok "installed config-policy.json"
fi

# Operator profile: NEVER overwrite an existing one. Only scaffolds a blank template so the
# "Check ~/.claude/alfred-profile.md" instruction in agent charters resolves to something
# even if this script runs directly instead of through ONBOARDING.md.
PROFILE_DST="${CLAUDE_HOME}/alfred-profile.md"
if [ "$DRY_RUN" = "1" ]; then
  warn "[dry-run] would scaffold alfred-profile.md if absent"
elif [ ! -f "$PROFILE_DST" ]; then
  cp -f "${REPO_ROOT}/claude-md/alfred-profile.template.md" "$PROFILE_DST"
  ok "scaffolded alfred-profile.md (blank — fill it in, or ask Claude to run ONBOARDING.md)"
else
  ok "alfred-profile.md already exists, left untouched"
fi

step "Done. Backup (if any): ${BACKUP_DIR}"
echo -e "${CYAN}Next: review settings.merged-proposal.json if produced; run 'claude' and check /status.${OFF}"
