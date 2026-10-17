# Standalone (non-Bot) browsers: findings and design

Status: implemented on feat/standalone-browsers. The implementation contract and verification limits are in [standalone-browsers-ui-handoff.md](standalone-browsers-ui-handoff.md).

## Implementation notes and deviations

- Ownership is represented additively by `name` plus the existing `botId`, rather than an owner union; old ledgers default to unnamed, running-intent profiles.
- Start/stop/delete and provider attach/detach are implemented with lifecycle serialization, durable stop intent, exact native ownership checks and separate standalone controller receipts. Stop failure never authorizes supervision to restart the browser.
- All eight standalone operations are exposed on socket, MCP and WebSocket. Exact shared MCP role-policy exceptions allow every authorized caller; the legacy read-only Worker disclosure remains list/get only.
- Existing UI record types and state rendering are maintained. New standalone controls are left to the UI team. Health observations are not a last-used audit; CLI list reports state/URL/error, not last page activity.
- The real isolated-owner page/cookie e2e was deferred to the supervisor at the human's instruction after host guest-network restrictions. The temporary owner and its exact VM/volume were cleaned up; live `stack-qa` readiness and CDP were checked read-only. No extension support was added.

The findings and proposed design below are retained as the approved scope and investigation record.

## Product delta

- **Today:** every Bot automatically gets one browser. Anything else (a browser for Major Briggs or a script) is only possible through low-level operator calls, with unnamed profiles, a CDP port that changes after restarts, and no start/stop.
- **After:** any agent that can run `stack` or call the browse API/MCP can create a browser with a name (`major-briggs`), list, start, stop and remove it, and drive it with plain agent-browser through Stack's existing provider (`AGENT_BROWSER_STACK_BROWSER=major-briggs agent-browser …`), just as Bots already do. Logins and cookies persist in that browser's own profile. Bot browsers keep working as they do now.

## How it works today (verified)

- "@serve/bot / @serve/browse" are the `bots` and `browse` Package APIs in this repo (`packages/bots`, `packages/browse`), supervised by `node packages/cli/dist/src/main.js serve`.
- **Transport:** each Package API is a line-delimited JSON-RPC Unix socket at `~/.local/state/stack/sockets/<pkg>.sock`. Methods: `tools/list`, `tools/call {name, arguments}`, `events/subscribe {topics}`. The same operations are also on the WebSocket gateway (`ws://127.0.0.1:8744/websocket`, operator bearer header, frames `{id, method, params:{package, name, arguments}}`) and on HTTP MCP (port 8743, see `serve_status`).
- **The browser** is not a local Chrome. `browse` drives local **Hypeman** (`browser/hypeman/bin/hypeman-api`, 127.0.0.1:4975), which boots one Linux VM per profile from the pinned `onkernel/chromium-headful` image (headful Chrome 152 plus Neko WebRTC viewer). The profile is a 2 GB Hypeman volume mounted at `/home/kernel` (user-data at `/home/kernel/user-data`), under `~/.local/state/stack/browser/hypeman/data/volumes`. Ledger: `browser/profiles.json` and `browser/sessions.json`.
- **CDP** is exposed per profile as a loopback relay (`cdpUrl`, e.g. `http://127.0.0.1:49744`). The Bot doesn't proxy page commands; agent-browser talks CDP directly (Bots get a managed `AGENT_BROWSER_CONFIG` with provider `stack`).

### Working example (socket)

```sh
cat > /tmp/sc.mjs <<'JS'
import net from "node:net";
const [sock, method, params] = process.argv.slice(2);
const c = net.createConnection(sock); let b = "";
c.on("connect", () => c.write(JSON.stringify({ id: 1, method, params: JSON.parse(params || "{}") }) + "\n"));
c.on("data", d => { b += d; if (b.includes("\n")) { console.log(b.trim()); c.end(); } });
JS
S=~/.local/state/stack/sockets/browse.sock
node /tmp/sc.mjs $S tools/call '{"name":"browser_profile_create","arguments":{"botId":null,"label":"apply-test"}}'
# -> {"id":1,"result":{"id":"160eba7e-…","botId":null,"label":"apply-test","state":"starting",…}}
node /tmp/sc.mjs $S tools/call '{"name":"browser_profile_list","arguments":{}}'
# -> … {"label":"apply-test","state":"ready","cdpUrl":"http://127.0.0.1:49744",…}
```

### agent-browser end to end (verified, agent-browser 0.38.1)

```sh
echo '{}' > /tmp/ab-empty.json   # avoid the apply-queue/stack provider config
A(){ AGENT_BROWSER_CONFIG=/tmp/ab-empty.json agent-browser --session mb-test --cdp 49744 "$@"; }
A open https://example.com; A snapshot -i   # link "Learn more" [ref=e1]
A click @e1; A get url                       # https://www.iana.org/help/example-domains
```

### Persistence (verified)

I set a cookie (httpbin `mbtest=persist1`), then sent CDP `Browser.close`. Kernel's supervisor restarted Chrome (new browser target id), and the cookie was still there. Profile state lives on the VM volume, so it should survive VM restarts and `stack serve` restarts too (the docs say "Profiles remain on disk"). A full VM stop/start wasn't tested here because that needs the Hypeman token directly.

## Can browse run standalone already? Mostly yes

`browser_profile_create {botId:null}` already creates a **retained unassigned profile** with its own VM, volume and CDP relay, supervised and health-checked like Bot profiles. What's missing for first-class status:

1. **Agent access is Bot-gated.** The MCP `browser_*` ops require a verified live Bot launch (`profiles.ts` ~L527–536, "profile is not exclusively assigned to this Bot"). Only the operator socket/WebSocket can see unassigned profiles, so non-Bot agents (e.g. Major Briggs) have no MCP path today.
2. **CDP relay URLs are not stable:** they change on restart ("old relay URLs are not durable identities"). Callers must re-read `browser_profile_list`.
3. **No name/lookup:** profiles are UUIDs with a free label. No `get-by-name`, no start/stop (profiles are always running), no CLI.
4. **Docs say attaching a separate CDP client is outside the managed controller contract** (no handoff draining or ref invalidation for it).
5. **Coupling sites:** `profiles.ts tick()` (~L400–410) auto-creates a `Default` profile per Bot and un-assigns on Bot deletion; `create/select/delete` ownership checks (~L520–540); `bots/src/supervisor.ts` ~L479 injects `AGENT_BROWSER_*` only into Bot launches; the MCP identity in `api/src/bot-mcp-identity.ts` / `mcp-authority.ts`.

## Proposed design: first-class named standalone browsers

**Model:** a durable profile gets an owner: `{kind:"bot", botId}` or `{kind:"standalone", name}`. `name` is a unique slug (`[a-z0-9-]{1,40}`, e.g. `major-briggs`). It reuses the existing VM/volume/CDP-relay/supervision machinery; no new runtime.

**Access model:** no formal permission step. Any agent that can call the stack CLI, the browse socket/WebSocket, or the browse MCP server can create its own named browser and use it. Standalone ops are added to the browse MCP exposure for all MCP callers (Bot, Worker and other MCP clients). Bot-default-profile ownership rules stay as they are for Bot profiles. The trust boundary is the existing local one (same user on greybird).

**Package API ops (socket, WebSocket and MCP):**
- `browser_standalone_create {name, label?}` returns `{id, name, state, cdpUrl, observation}` (idempotent by name)
- `browser_standalone_list {}` / `browser_standalone_get {name}`
- `browser_standalone_start {name}` / `browser_standalone_stop {name}` (clean Chrome shutdown, then VM stop; profile kept)
- `browser_standalone_delete {name, confirm:"delete"}` (discards VM and volume)
- Event topic `browser_standalone_changed` for state changes

**Existing agent-browser provider (verified 2026-10-16).** Stack already ships an agent-browser provider plugin: `packages/browse/src/provider.ts` (50 LOC), registered as plugin `stack` with capability `browser.provider`. Each Bot launch gets a private config in `browser/controllers/<namespace>.json` (`provider: "stack"`, `namespace`, `idleTimeout: 0`, plugin args = a signed `browser-identity?bot=…&instance=…&proof=…` URL) through `AGENT_BROWSER_CONFIG`/`AGENT_BROWSER_NAMESPACE`. On launch the plugin calls `browser_controller_launch {identity, session}` on `browse.sock` and returns that controller's CDP URL. Profile choice is **by Bot identity plus `--session`**: the Bot's default profile, or whatever `browser_controller_select` set for that session. So for a Bot, connecting is just `agent-browser --session work open URL`, with no ports. Without a Bot identity it refuses ("browser provider requires a private Bot launch configuration"). I confirmed this: the global `browser/agent-browser.json` and `--provider stack` both fail with `Plugin 'stack' returned success=false`. My earlier test used `--cdp` with an empty config, which bypassed the provider entirely.

**#4 (revised): connect by extending the existing provider.** Teach the `stack` provider to target a named standalone browser:
- `provider.ts`: accept a standalone target as well as Bot identity, read from `AGENT_BROWSER_STACK_BROWSER=<name>` (or a plugin arg `browser=<name>`). For a standalone target, call a new socket op `browser_standalone_attach {name, session}`, which starts the browser if it's stopped, registers a managed controller and returns the current `cdpUrl`. Bot behaviour is unchanged.
- `browse` ops: `browser_standalone_attach` (reusing `browser_controller_launch` internals with a standalone principal) and `browser_standalone_detach` (the close notice).
- Usage for any agent: `AGENT_BROWSER_CONFIG=~/.local/state/stack/browser/agent-browser.json AGENT_BROWSER_STACK_BROWSER=major-briggs agent-browser --session mb open https://example.com`, then `snapshot -i`, `click @e1`. That's no ports and no ceremony, and it works the same from the agent-browser MCP server. Optionally make the global config the user default so `--provider stack` alone works.
- **CLI:** `stack browse ls | create NAME | start NAME | stop NAME | rm NAME | cdp NAME`. `stack browse drive NAME -- <args>` becomes **optional thin sugar** that just sets the two env vars and execs agent-browser. There's no separate port resolution, because the provider does that on every launch.

**Deliverable: UI handoff doc.** When the build is done, the builder writes `docs/standalone-browsers-ui-handoff.md` for the UI team. It covers the data model (fields and types), every API/MCP/CLI operation with inputs and outputs, states and lifecycle (`starting/ready/stopping/stopped/failed/deleting`) with the events emitted, error codes/messages and their meaning, and limits (name rules, 16-reservation cap, disk requirement, relay URLs are not durable). It's information to design and build a UI from, not a UI design.

**Rough size:** owner model, ledger migration and tick changes ~150 LOC; API ops, schemas and event ~250; MCP exposure ~40; provider + attach/detach ~100; CLI (incl. thin `drive` sugar) ~120; start/stop lifecycle in the backend ~120; tests ~300; UI handoff doc. About 1k LOC, roughly 2 days (slightly less than before, since the provider already handles connect).

## Future / separate feature: browse extension support

A follow-up plan, useful beyond password managers (ad/cookie-banner blockers, automation helpers). Note: agent-browser also has `auth login --credential-provider <plugin>`, a credential-plugin hook worth evaluating for a Bitwarden CLI bridge. Sketch: per-profile extension list stored in the ledger; unpacked extensions on the profile volume (`/home/kernel/extensions/...`); `--load-extension=` appended to `CHROMIUM_FLAGS` in `backend.ts` (~L358; the image runs Chrome for Testing, which still honors the flag, untested); API op such as `browser_extensions_set`. The first use case is a free password manager (Bitwarden) unlocked once by a human through the existing handoff/Neko viewer. Risks: flag behaviour in the Kernel image, vault lock timeouts. Est. ~0.5–1 day.

## Where we get / might get stuck

| Risk | Fix |
|---|---|
| Non-Bot agents can't use MCP browser ops today | expose standalone ops to all MCP callers (no grant) |
| CDP port changes after restart | the provider resolves it on every launch (already true for Bots) |
| Separate CDP clients bypass handoff draining | standalone attach registers a managed controller; don't use raw `--cdp` |
| Profiles are always on today | add start/stop with a clean Chrome flush before VM stop |
| Name collisions / cleanup of abandoned browsers | names are unique; `ls` shows last use; manual `rm` |
| VM is linux/amd64 on arm64 (vz), so it's slowish | acceptable; tune vcpus/size |
| Max 16 native reservations; ≥12 GB free disk per new profile | surface in errors and limits; keep counts small |
| Stale failed profile `f3a9e7b8` ("browser target changed") | operator review, then `browser_profile_delete` |
| Test profile `160eba7e` (label apply-test) left running | delete when done |
