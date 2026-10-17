# 182. Verify research browser capabilities in the shipped guest

Status: accepted, 2026-10-17. Amends the guest-runtime requirements in
[ADR 0112](0112-research-network-egress.md).

The original research launch contract assumed capabilities absent from the
installed runtime: the general Browser image has no firewall tools, and
Hypeman's ARM64 kernel has neither IPv6 nor the `REJECT` target or owner
matching. Blocking guest loopback also blocks the image's own CDP proxy.
Research therefore failed before extraction despite passing launch fixtures.

Research uses a separate pinned official Kernel image containing legacy
netfilter tools. It installs an IPv4 OUTPUT default-deny policy before Chrome.
For IPv6, only an `AF_INET6` socket creation failure with `EAFNOSUPPORT`
establishes that the family is unavailable. When socket creation succeeds,
every IPv6 firewall command must succeed. Other probe errors abort launch.
Denied ranges use `DROP`, which the guest kernel supports.

Only root-owned connections to `127.0.0.1` TCP ports 9222 and 9223 may bypass
the loopback denial, for the image's CDP proxy and readiness checks. Chrome
continues to run as the unprivileged `kernel` user; page traffic receives no
such exception. Other guest-private traffic still requires an exact Research
egress grant. Public TCP, fixed-resolver DNS and replies to inbound management
connections retain their existing policy. Five-minute expiry removes all
allow rules, including management exceptions.

When owner matching is absent, the guest loads the unmodified upstream
`xt_owner` module compiled against its published, matching kernel headers.
The small bundled module has a verified digest, retained source and license,
and a rebuild recipe in
[the module provenance](../../packages/browse/resources/research-kernel/PROVENANCE.md).
Loading a module affects only that disposable guest. We do not maintain a
patched kernel or Hypeman fork. Integrity, ABI, module loading or firewall
failures prevent Chrome from starting. An explicit runtime update must
revalidate this dependency; a changed kernel is not silently accepted when it
lacks owner matching.

This changes no transport or exposure and adds no UI controls. Research still
uses fresh disposable profiles, never an unrestricted or signed-in Browser
profile. General Browser profiles retain their image pin. The research image
must be imported explicitly into the selected Hypeman installation; admission
never installs a runtime as a side effect.

Verification must include actual guest behavior, not only generated-command
fixtures: public TCP succeeds, private and loopback listeners remain
unreachable to the page user, root CDP connections succeed, UDP is denied,
and an exact private grant permits only its endpoint. Startup tests also
cover an unavailable IPv6 family, failed IPv6 policy installation and an
unverifiable capability probe. Full browser extraction remains a separate
integration check.
