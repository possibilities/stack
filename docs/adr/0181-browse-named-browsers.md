# 181. Named standalone browsers in the Browse space

Status: accepted, 2026-10-16. Adds a pane to the Browse space of [ADR 0108](0108-browse-space.md) within the
tiled hosts of [ADR 0180](0180-tiled-pane-spaces.md), for the named standalone browsers of
[the standalone browser contract](../standalone-browsers-ui-handoff.md). Leaves remote UIX policy of
[ADR 0101](0101-remote-uix-through-access.md) unchanged: `browse` stays local.

## Decision

**Browsers** (`browse-browsers`) lists `browser_standalone_list` by name, as its own read, re-read on
every `browser_standalone_changed`. That notice accompanies every profile-ledger save, health observations
included, so it is a silent invalidation: the paired `browser_profiles_changed` already reaches the activity
log. Each standalone write re-reads the named list, profiles, controllers and the toolchain whichever way
it settles.

Each row shows the name, a label that differs from it, state, observation time, short profile ID, the current
CDP relay URL with a copy control, the latest error, a held marker and the existing maintenance fence. `stopped`
is intent, not proof: beside `failed` the row reads **Stop failed** and says the VM may still be running.
Non-ready states explain themselves; `starting` is never shown as ready.

- **Start** is offered for `stopped` and `failed`; **Stop** for `ready`, `starting`, `recovering` and
  `failed` (**Stop again** after an unconfirmed stop). Neither is offered while stopping or deleting. A
  maintenance fence or an unresolved handoff disables every action with its reason, deletion included. A
  start that answers `failed` is a result, not a transport error; the row shows its error.
- **Create** takes a name checked against the API's exact `[a-z0-9-]{1,40}` rule without trimming or case
  folding, and an optional label of up to 128 characters. An existing name is not offered, since creation
  would return it unchanged. The form shows how many of the 16 durable profiles are in use, Bot profiles
  included, and refuses at the limit. Success is admission: the new row reads Starting.
- **Delete** requires typing the name. Names can be reused, so the dialog reads `browser_standalone_get`
  first and refuses when the name now refers to a different profile ID; only then does it send
  `{name, confirm: "delete"}`.
- **Connect** discloses copyable commands that go through Stack's provider: `stack browse drive NAME -- …` and
  `AGENT_BROWSER_STACK_BROWSER=NAME agent-browser --session NAME …`, with the note that a running session keeps
  its browser. The raw CDP URL is labelled as a current relay that bypasses managed admission. Provider
  attach and detach remain agent-browser's; the UI never calls them.
- **View** opens the existing profile viewer when the browser is ready.

`standalone-browser` is a new node kind keyed by name, with its home in this pane. Its inspector links to the
exact `browser-profile` incarnation. Profiles lists named browsers in their own group, linked to their
Browsers row, and routes their lifecycle there instead of offering profile deletion. A failed named browser
already asks for attention through its profile. Browse gains a **Browsers** preset beside the viewer; Handoff
and Manage include the pane.

Timeouts and dropped connections are unknown outcomes, as elsewhere in Browse: the error says so and nothing
is resent. The WebSocket gateway forwards start, attach and stop with 120-second budgets, since start waits for
its VM and CDP readiness and stop drains, closes Chrome and confirms the VM stopped.

## Consequences

Remote sessions see the pane but no data. Extensions, renaming, adoption of legacy unassigned profiles and a
standalone controller list remain outside the UI, as they are outside the API.
