# Pinned Hypeman runtime

Stack owns the Hypeman installer in `packages/browse/src/system.ts`. Funk and
AgentStart invoke Stack setup; they do not maintain another Hypeman installer.
Reviewed platform artifacts are declared in `packages/browse/src/hypeman-artifact.ts`.

For the temporary macOS source build, pin an exact upstream commit and the exact
hosted build that contains it. Native builds run in GitHub Actions. The fork's
verification workflow must demonstrate retained control connections with the old
keep-alive behavior, passing lifecycle regressions with the fix, and a clean
application-source diff from the selected upstream revision. It packages both
`hypeman-api` and `hypeman-token` with `source-provenance.json`.

Before changing an artifact pin, verify the successful run's source and build
commits, architecture, archive SHA-256, and individual binary SHA-256 values.
Use a durable, versioned artifact URL; an expiring Actions download is not an
installation source. Keep the upstream source revision, build revision and run
identity in the pin and the installation receipt. Never substitute a moving
`main` URL or silently compile natively on the installation machine.

The installer verifies the archive before extraction and checks source provenance
and both binary hashes before signing or executing either binary. It records
post-signing binary digests and checks them on repeated installation. A receipt
for another build requires an explicit upgrade; it never silently downgrades or
overwrites an independently installed runtime. Installation does not select or
start Hypeman.

## Current macOS pin

- Upstream application source: `kernel/hypeman@567335f2effa35c9bea6721767b2960ae6609d20`, including the transient VZ connection fix from PR 482.
- Fork build revision: `4e412b332c1c67b86e9ea766261afa873879c6ea`; only CI configuration differs from upstream.
- [Successful macOS 15 ARM64 build and regression evidence](https://github.com/possibilities/hypeman/actions/runs/40554826201).
- [Versioned source-build distribution](https://github.com/possibilities/hypeman/releases/tag/source-567335f2effa-4e412b3), clearly marked as a fork prerelease.
- Archive SHA-256: `7c741e923633235d9361f7535f1faddd13b0192a1ae5a30accff2b2d9fb23fb4`.

The temporary source pin applies to macOS ARM64. Linux keeps its previously
reviewed v0.3.0 artifact; this VZ repair does not change Linux installation.
Updating the Hypeman binary does not require restarting the whole Stack server
or rebuilding its live UI. The updated installer source takes effect when that
Stack package is next built and loaded.

## Existing installation and rollback

An upgrade is separate from fresh installation. Record the running API and VM
helper identities and states first. Preserve the old binaries and their SHA-256
values. Keep the exact configuration, JWT/token, connection descriptor, VM disks,
browser profile volumes, and Brain database in place. Historical
`agentstack-install.json` is legacy evidence, not permission to replace arbitrary
contents at that path.

Verify the new archive and source metadata, apply the existing macOS signing
entitlements to the replacement API, and record the installed binary hashes.
Replace only the reviewed binaries and provenance/installation receipt. Restart
the API through its existing Stack owner. VZ helpers are designed to survive API
restarts; do not stop or recreate them just to install a client-side connection
fix. Caddy may restart with the API depending on the existing configuration.

Confirm API readiness, unchanged VM identities and expected states, and stable
descriptor counts across repeated queries spanning several five-second state
cache expirations. Distinguish preexisting Unknown instances from new failures.
If the replacement fails, restore the recorded old binaries and corresponding
receipt and restart the API through the same owner. Do not reset disks, profiles,
credentials or databases as a repair step.

## Returning to an official release

A new upstream tag is a reason to ask the operator about switching back, not
automatic approval. After approval, verify that the release contains the selected
fix and supports the installed data/configuration, validate the platform artifact
and checksum, update the artifact pin and this runbook, and repeat the guarded
upgrade and live connection checks. Retain the source build and rollback record
until the official release has been verified on the machine.
