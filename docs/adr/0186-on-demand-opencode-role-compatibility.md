# 0186 — Check OpenCode Role launch capabilities on demand

Status: accepted, 2026-10-20. Amends the OpenCode launch contract of
[ADR 0123](0123-role-injection-for-native-clis.md).

The OpenCode Role launcher checks the selected native command's help for the
exact `--server` option before starting its private host. Interactive launches
check root help; `run` and `mini` check their own help. A missing capability
fails before the host opens the native database. The launcher no longer
requires the CLI to report the host libraries' exact release number.

The private host's pinned `@opencode/core` and `@opencode/server` dependencies
remain build dependencies. Their service customization excludes ambient
capabilities while retaining native credential persistence. That internal
coupling does not establish a need to reject a different CLI release that
supports the host connection protocol.

Behavioral evidence belongs in tests. The default Role integration test uses
a different reported CLI release with the production host, checks isolation
and credential persistence, and verifies that missing selected-command support
refuses before host construction. An opt-in installed-CLI test
(`STACK_NATIVE_ROLE_OPENCODE_PROBE=1`) verifies authenticated configuration
reading and session creation against the production host in a disposable
profile, with no credentials or model turn.

Advertising `--server` is a bounded preflight, not a guarantee about every
future protocol or database change. Host startup and native CLI errors remain
errors; Stack does not replay an invocation, rehearse a session during ordinary
launch, or require a per-release certification registry.
