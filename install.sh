#!/usr/bin/env bash
# Sets up Webapp Reviewer from this folder:
#  - links it into ~/.claude/skills so Claude Code finds the skill,
#  - registers the native messaging host that saves reviews to ~/.claude/reviews,
#  - creates .env for the Soniox key if there is none.
# Safe to run again after moving the folder or updating.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
NAME="webapp_reviewer"
EXT_ID="ondohcdchnemipapifhehapnhdcoahnn" # fixed by the "key" in extension/manifest.json

NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  echo "Node.js is required (https://nodejs.org)." >&2
  exit 1
fi

# Version managers (fnm, nvm) put node on a per-shell link; use the file it points to.
NODE="$(readlink -f "$NODE" 2>/dev/null || echo "$NODE")"

# Chrome starts native hosts without your shell's PATH, so the launcher names node by full path.
LAUNCHER="$ROOT/assets/native-host-launcher"
printf '#!/bin/sh\nexec "%s" "%s/assets/native-host.js" "$@"\n' "$NODE" "$ROOT" > "$LAUNCHER"
chmod +x "$LAUNCHER" "$ROOT/assets/native-host.js"

case "$(uname -s)" in
  Darwin)
    BASE="$HOME/Library/Application Support"
    DIRS=("$BASE/Google/Chrome" "$BASE/Google/Chrome Beta" "$BASE/Chromium" "$BASE/BraveSoftware/Brave-Browser" "$BASE/Microsoft Edge")
    ;;
  Linux)
    BASE="$HOME/.config"
    DIRS=("$BASE/google-chrome" "$BASE/google-chrome-beta" "$BASE/chromium" "$BASE/BraveSoftware/Brave-Browser" "$BASE/microsoft-edge")
    ;;
  *)
    echo "Only macOS and Linux are supported." >&2
    exit 1
    ;;
esac

registered=0
for dir in "${DIRS[@]}"; do
  [ -d "$dir" ] || continue
  mkdir -p "$dir/NativeMessagingHosts"
  cat > "$dir/NativeMessagingHosts/$NAME.json" <<EOF
{
  "name": "$NAME",
  "description": "Webapp Reviewer: saves reviews to ~/.claude/reviews",
  "path": "$LAUNCHER",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
EOF
  echo "Registered the native host for $(basename "$dir")"
  registered=1
done
if [ "$registered" = 0 ]; then
  echo "No Chrome, Chromium, Brave or Edge profile folder found." >&2
  exit 1
fi

SKILLS="$HOME/.claude/skills"
LINK="$SKILLS/webapp-reviewer"
mkdir -p "$SKILLS"
if [ -L "$LINK" ] || [ ! -e "$LINK" ]; then
  ln -sfn "$ROOT" "$LINK"
  echo "Linked the skill: $LINK -> $ROOT"
elif [ "$(cd "$LINK" && pwd -P)" != "$(cd "$ROOT" && pwd -P)" ]; then
  echo "$LINK already exists and is not a link to this folder; left it alone." >&2
fi

if [ ! -f "$ROOT/.env" ]; then
  echo "SONIOX_KEY=" > "$ROOT/.env"
  chmod 600 "$ROOT/.env"
  echo "Created $ROOT/.env: add your Soniox API key there for voice."
fi

cat <<EOF

Next, load the extension once:
  1. Open chrome://extensions and turn on Developer mode
  2. Load unpacked: $ROOT/extension
  3. Check that its ID is $EXT_ID
EOF
