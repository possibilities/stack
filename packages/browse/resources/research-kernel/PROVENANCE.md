# Research guest owner matching

`xt_owner.c` is unmodified GPL-2.0-only Linux source from
[Kernel's matching guest release](https://github.com/kernel/linux/blob/ch-6.12.8-kernel-3.0-202605291/net/netfilter/xt_owner.c).
Its license is retained in `LICENSE.GPL-2.0`. This is a loadable module built
against the published kernel headers, not a patched kernel or Hypeman fork.

The bundled `xt_owner-aarch64.ko` targets Hypeman's ARM64 `6.12.8+` kernel,
release `ch-6.12.8-kernel-3.0-202605291`, with module-version checks enabled.
The official kernel omits owner matching but permits loading it. The module
is used only when the running guest does not already support owner matching.
A failed or incompatible load prevents research browser startup.

Inputs and output:

| Artifact | SHA-256 |
| --- | --- |
| `xt_owner.c` | `5c0d62eced61655c81a97f7ca20abc17faa1d75e874c59e9a9db102383eabeef` |
| Published `kernel-headers-aarch64.tar.gz` | `783449d93f9529fa251f9aa9c413a63cbd4fd054c98cb5c5136104a56bd45e7c` |
| Bundled module | `a1c904ff34b1a415ad3058b9ba357be27eea53812e69b8b620348b5e8fdc797f` |

The module was built with Ubuntu's `aarch64-linux-gnu-gcc` 11.4.0
(`11.4.0-1ubuntu1~22.04.3`) against headers produced with GCC 12.2.0. The
module-version check and an actual load on the matching guest succeeded.
Rebuild with [`build-research-module.sh`](../../scripts/build-research-module.sh)
in an explicitly authorized Linux build environment. The script creates no VM
and installs no tools. Review compiler changes and update the embedded digest
in [`research-runtime.ts`](../../src/research-runtime.ts) only after checking
the resulting module in the guest.

Research uses the official `onkernel/chromium-headful` image from commit
`6f92f2c`, linux/amd64 manifest
`sha256:a92a8393467ce662b9c76d0c4c51e3836bd5ada5a1ceea37375d616a6526d887`.
That image supplies Python and legacy `iptables`/`ip6tables`. The image must
be explicitly imported into the selected Hypeman installation before use;
research acquisition never downloads or installs a runtime. General Browser
profiles retain their existing image pin.
