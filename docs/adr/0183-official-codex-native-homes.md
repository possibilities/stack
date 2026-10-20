# 183. Use official Codex packages and persistent native Bot homes

Status: accepted, 2026-10-19. Supersedes [ADR 0003](0003-required-codexnk-runtime.md)
and the fork-specific launch transport in [ADR 0004](0004-codex-account-state.md),
[ADR 0018](0018-unbound-server-launch.md), [ADR 0027](0027-default-capabilities-bundle.md),
[ADR 0030](0030-single-role-package.md), [ADR 0031](0031-role-resources.md),
[ADR 0034](0034-explicit-project-trust-for-role-bots.md),
[ADR 0052](0052-private-experimental-inference.md),
[ADR 0123](0123-role-injection-for-native-clis.md),
[ADR 0141](0141-role-bot-personality-and-orientation.md), and
[ADR 0152](0152-independent-client-bootstrap-and-ui-handoffs.md).
Also supersedes [ADR 0015](0015-remove-test-input-observation-api.md)'s retained
input-middleware helper. Other lifecycle, admission and account fences remain.

## Decision

Stack consumes a complete official `openai/codex` release, without a carried
runtime patch or dependency on the workshop installer. The reviewed version,
source commit, platform assets, sizes and SHA-256 digests live together in
[`scripts/codex-release.json`](../../scripts/codex-release.json). Stack's installer
checks the archive, extracts only ordinary files and directories, verifies the
package layout and native companions, then atomically selects an immutable
release under `~/.local/libexec/stack/codex`. The fixed executable is
`~/.local/libexec/stack/codex/codex`. It never replaces another consumer's runtime
or restarts a process. Client bundles carry this installer and its adjacent pin;
their contract names the exact official version and source commit.
`roles inject -- codex` also binds this executable instead of resolving a
possibly fork-backed terminal shim through `PATH`; its existing private operator
invocation home and ordinary file-auth selection remain independent of Bots.

Each Bot conversation generation owns a persistent native `CODEX_HOME`, using
its existing private history path. Native session files, SQLite stores and
other conversation state survive process exit. Stack pins the SQLite location
to that home and preserves the OS `HOME`. Reset still retires the whole
generation; it does not put multiple Bots into one native home.

Every launch captures its Role. Native `config.toml` contains the rendered
Fragments and `bot.md` as `developer_instructions`, enabled internal and Role MCP
definitions, and the matching explicit project trust entries. The conversation
home links this config and its `skills/` directory for the launch. Empty
instructions are explicit, so clearing a Role also clears the next launch's
developer instructions. Existing exact-root resume and superseding developer
context remain; no extra orientation or user turn is admitted on restart.

Account credentials use enforced native file storage. The home's `auth.json`
links to a retained private launch copy, and credential environment overrides
are removed. Unbound Bots have no credential file. Native refresh writes remain
available after exit for the existing stable-read, timestamp and credential
generation checks. Verified stop removes exact launch links before a later
account can reuse the launch directory. Invalid or conflicting credentials
remain recoverable. Concurrent Bots sharing one account still have independent
native refresh locks: reconciliation is best effort, not centralized provider
token rotation.

The Role supplies invocation skills and MCPs but is not an exclusive capability
allowlist. Official Codex may discover repository, home-level and system skills
and applicable native configuration layers. This is the explicit tradeoff for
removing fork maintenance. Stack's private config and credentials remain
separate from the person's ordinary Codex home. Trusted project configuration
can contain more than MCP definitions, as before.

## History and compatibility

Existing private rollout homes are reused. A legacy shared store is copied on a
stopped Bot's next launch, selecting only its sanctioned root and descendants.
The original files are preserved, legacy date partitions acquire the native
`sessions/` prefix, and a durable marker recovers publication interrupted
between directory rename and the ownership update. Conflicting lineage or an
unrecognized destination stops migration. Rollouts can rehydrate native thread
history; databases already discarded by an older runtime cannot be recovered.

`chat_search` accepts an omitted `botId` to aggregate the current sanctioned Bot
histories in Stack's read index. Every hit retains its owning `botId`; an explicit
Bot remains scoped to that lineage. Other top-level native threads are excluded.
This gives unified search without a shared writable native home. The existing
Bot chat UI remains scoped; a dedicated aggregate-search control is separate UI
work.

The unused input-middleware library and its fork protocol tests are removed.
Stack no longer selects fork flags, paths, installation pins or config schema
provenance. Historical ADR text stays as decision history with supersession
links. Existing processes keep their loaded executable until a separately
authorized stop/start; installation alone changes no running Bot or Server.

## Verification boundary

Installer checks exercise complete-package installation, immutable reuse,
foreign executable refusal, corrupt bytes, missing companions and unsafe archive
entries. Native app-server checks use the pinned executable with a local model
fixture to verify Role instructions, exact-root restart, cleared instructions,
retained refresh reconciliation and rollout-only migration. Sanctioned-lineage
and aggregation checks cover unrelated roots, pagination and lost ownership.
These checks do not claim live provider refresh coordination or model quality.
