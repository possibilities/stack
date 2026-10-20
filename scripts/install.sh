#!/bin/bash
set -euo pipefail

repo_root=$(cd -P -- "$(dirname -- "$0")/.." && pwd)
bin_dir="${STACK_INSTALL_BIN_DIR:-$HOME/.local/bin}"
runtime_installer="$repo_root/scripts/install-codex.py"
mode="${1:---check}"
if [ "$#" -gt 1 ]; then mode=invalid; fi
case "$mode" in
    --check)
        python3 "$runtime_installer" --check
        printf 'Build Stack and link %s/stack. No services started or restarted.\n' "$bin_dir"
        printf 'Remote UI stays disabled until STACK_ACCESS_HOST, STACK_ACCESS_UI_ORIGIN, TLS key/cert and distinct Access ports are configured.\n'
        exit 0
        ;;
    --install) ;;
    *) printf 'Usage: scripts/install.sh [--check|--install]\n' >&2; exit 64 ;;
esac
[ "$(id -u)" -ne 0 ] || { printf 'Run as the target user, not root.\n' >&2; exit 1; }
target="$bin_dir/stack"
if [ -e "$target" ] || [ -L "$target" ]; then
    [ -L "$target" ] && [ "$(readlink "$target")" = "$repo_root/bin/stack" ] || {
        printf 'Refusing to replace an independent command: %s\n' "$target" >&2
        exit 1
    }
fi
expected_runtime="$HOME/.local/libexec/stack/codex/codex"
python3 "$runtime_installer" --install
[ -f "$expected_runtime" ] && [ -x "$expected_runtime" ] || {
    printf 'Required runtime was not installed: %s\n' "$expected_runtime" >&2
    exit 1
}
cd "$repo_root"
pnpm install --frozen-lockfile
pnpm build
mkdir -p "$bin_dir"
ln -sfn "$repo_root/bin/stack" "$target"
printf 'Installed Stack with its pinned official Codex runtime. Running processes were not restarted.\n'
