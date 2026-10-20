# 0185 — Check native purge compatibility only when requested

## Status

Accepted. Supersedes the native release allowlist in
[0153](0153-exact-worker-state-maintenance.md); its lifecycle, exact scope and
receipt decisions remain.

## Context

An installed Devin update blocked session purge and the default test suite even
though the deletion command and storage contract still worked. Exact release
allowlists require a source edit for every native update, including installations
that never use purge. A runtime rehearsal would add another lifecycle to an
optional maintenance action.

## Decision

Native-session plan/apply checks compatibility on demand. OpenCode and Devin must
advertise the deletion command's required target and offline/noninteractive option.
Their private stores must expose the fields used to identify selected sessions,
descendants, sibling payloads and credentials. Runtime checks use the existing
macOS offline guard and isolated account environment. They do not run at startup,
installation, ordinary Worker admission or inventory reads.

Release numbers are observations, not eligibility. Plans bind the resolved
executable path and file identity as well as the version and selected store.
Application rechecks that revision and executes the resolved binary; a changed
installation requires a fresh plan. The pinned Claude SDK remains a build
dependency, without a separate release allowlist.

Behavioral compatibility with installed harnesses belongs in the opt-in
`STACK_NATIVE_STATE_PROBE=1` integration test. It uses disposable profiles, no
live credentials or paid turns, and checks actual exact-session deletion,
descendants and sibling/credential preservation. Deterministic default tests
cover capability/schema refusal, executable changes and failed deletion
verification without requiring installed native harnesses.

## Consequences

Compatible releases need no Stack source edit. Missing commands/options or
unreadable/incompatible stores block the requested purge. Neither command help
nor a readable schema proves all provider behavior; the integration test supplies
that behavioral evidence without becoming a production certification registry.
Runtime postchecks still verify disappearance and sibling/credential retention.
An admitted effect that cannot be verified remains partial/unknown and is never
replayed. All other restrictions in [0153](0153-exact-worker-state-maintenance.md)
remain.

Run the integration test explicitly after building:

```sh
pnpm --filter @stack/worker... build
STACK_NATIVE_STATE_PROBE=1 node --test packages/worker/dist/test/native-state.test.js
```
