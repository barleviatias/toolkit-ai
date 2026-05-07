#!/usr/bin/env bash
#
# toolkit-ai installer (no npm required).
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/barleviatias/toolkit-ai/main/install.sh | bash
#
# Optional:
#   AI_TOOLKIT_VERSION=v2.1.6     curl ... | bash    # pin a specific release
#   AI_TOOLKIT_BIN_DIR=~/bin       curl ... | bash    # install to a custom dir
#   AI_TOOLKIT_DOWNLOAD_URL=https://...  ... | bash   # mirror or local file://
#
# Requires: bash, curl, node >= 20 on PATH. The toolkit ships as a single
# bundled .mjs file with a #!/usr/bin/env node shebang — node executes it
# directly, no install step beyond drop-it-in-PATH and chmod +x.

set -euo pipefail

REPO="barleviatias/toolkit-ai"
ASSET="ai-toolkit.mjs"
VERSION="${AI_TOOLKIT_VERSION:-latest}"
MIN_NODE_MAJOR=20

err() { printf '\033[31m✘\033[0m %s\n' "$*" >&2; exit 1; }
info() { printf '\033[36m▸\033[0m %s\n' "$*"; }
ok() { printf '\033[32m✔\033[0m %s\n' "$*"; }

# ---------- Node check -------------------------------------------------------
command -v node >/dev/null 2>&1 || err "node is not on PATH. Install Node ${MIN_NODE_MAJOR}+ first (https://nodejs.org or via nvm/asdf/volta/mise)."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt "$MIN_NODE_MAJOR" ]; then
  err "node $NODE_MAJOR is too old; need $MIN_NODE_MAJOR or newer."
fi

# ---------- Pick install dir -------------------------------------------------
# Order: explicit env var > ~/.local/bin (XDG-style) > /usr/local/bin.
# We prefer ~/.local/bin so the install is a no-sudo single-user op.
if [ -n "${AI_TOOLKIT_BIN_DIR:-}" ]; then
  BIN_DIR="$AI_TOOLKIT_BIN_DIR"
elif [ -d "$HOME/.local/bin" ] || mkdir -p "$HOME/.local/bin" 2>/dev/null; then
  BIN_DIR="$HOME/.local/bin"
else
  BIN_DIR="/usr/local/bin"
fi

mkdir -p "$BIN_DIR" || err "Cannot create $BIN_DIR. Set AI_TOOLKIT_BIN_DIR to a writable directory."
[ -w "$BIN_DIR" ] || err "$BIN_DIR is not writable. Run with sudo or set AI_TOOLKIT_BIN_DIR=~/bin."

# ---------- Resolve download URL --------------------------------------------
if [ -n "${AI_TOOLKIT_DOWNLOAD_URL:-}" ]; then
  URL="$AI_TOOLKIT_DOWNLOAD_URL"
elif [ "$VERSION" = "latest" ]; then
  URL="https://github.com/$REPO/releases/latest/download/$ASSET"
else
  URL="https://github.com/$REPO/releases/download/$VERSION/$ASSET"
fi

# ---------- Download to temp, atomic move -----------------------------------
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

info "Downloading $ASSET ($VERSION) from GitHub Releases…"
curl -fsSL "$URL" -o "$TMP" || err "Download failed: $URL"

# Sanity check: the file must start with the Node shebang the bundle ships with.
head -c 19 "$TMP" | grep -q '#!/usr/bin/env node' || err "Downloaded file doesn't look like the toolkit-ai bundle (shebang mismatch)."

# ---------- Install ----------------------------------------------------------
TARGET="$BIN_DIR/ai-toolkit"
mv "$TMP" "$TARGET"
chmod +x "$TARGET"

# Friendly aliases so `toolkit` and `toolkit-ai` work too (matches the npm bin entries).
ln -sf "$TARGET" "$BIN_DIR/toolkit"
ln -sf "$TARGET" "$BIN_DIR/toolkit-ai"

INSTALLED_VERSION="$("$TARGET" --version 2>/dev/null || echo unknown)"
ok "Installed $INSTALLED_VERSION → $TARGET"

# ---------- PATH check -------------------------------------------------------
case ":$PATH:" in
  *":$BIN_DIR:"*) ok "Run: ai-toolkit" ;;
  *)
    printf '\n'
    printf '\033[33m!\033[0m %s is not on your PATH.\n' "$BIN_DIR"
    printf '  Add it by appending this line to your shell rc (~/.zshrc, ~/.bashrc):\n\n'
    printf '    export PATH="%s:$PATH"\n\n' "$BIN_DIR"
    printf '  Then re-open your terminal and run: ai-toolkit\n'
    ;;
esac
