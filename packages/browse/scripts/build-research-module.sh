#!/bin/sh
# Build an unmodified upstream module; this does not create or start a VM.
set -eu
test "$(uname -s)" = Linux || { echo 'Use an authorized Linux build environment with make, curl, tar and gcc-aarch64-linux-gnu.' >&2; exit 1; }
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
resource_dir="$script_dir/../resources/research-kernel"
mkdir -p "$HOME/scratch"
build_dir=$(mktemp -d "$HOME/scratch/stack-research-module.XXXXXX")
trap 'rm -rf "$build_dir"' EXIT HUP INT TERM
mkdir "$build_dir/headers" "$build_dir/module"
curl --fail --location --silent --show-error \
  https://github.com/kernel/linux/releases/download/ch-6.12.8-kernel-3.0-202605291/kernel-headers-aarch64.tar.gz \
  -o "$build_dir/headers.tar.gz"
printf '783449d93f9529fa251f9aa9c413a63cbd4fd054c98cb5c5136104a56bd45e7c  %s\n' "$build_dir/headers.tar.gz" | sha256sum -c -
printf '5c0d62eced61655c81a97f7ca20abc17faa1d75e874c59e9a9db102383eabeef  %s\n' "$resource_dir/xt_owner.c" | sha256sum -c -
tar -xzf "$build_dir/headers.tar.gz" -C "$build_dir/headers"
cp "$resource_dir/xt_owner.c" "$build_dir/module/xt_owner.c"
printf 'obj-m := xt_owner.o\n' > "$build_dir/module/Makefile"
make -C "$build_dir/headers" M="$build_dir/module" ARCH=arm64 CROSS_COMPILE=aarch64-linux-gnu- modules
cp "$build_dir/module/xt_owner.ko" "$resource_dir/xt_owner-aarch64.ko"
sha256sum "$resource_dir/xt_owner-aarch64.ko"
