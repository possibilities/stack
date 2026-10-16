# Standalone (non-Bot) browsers: findings and design

Status: investigation, 2026-10-16. Author: Grok Bot for Mike Bannister. Tested on greybird (macOS arm64; `stack serve` running since Tue; Hypeman via the `vz` hypervisor).

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

1. **Agent access is Bot-gated.** The MCP `browser_*` ops require a verified live Bot launch (`profiles.ts` ~L527–536, "profile is not exclusively assigned to this Bot"). Only the operator socket/WebSocket can see unassigned profiles. A non-Bot agent (Major Briggs) has no sanctioned identity.
2. **CDP relay URLs are not stable:** they change on restart ("old relay URLs are not durable identities"). Callers must re-read `browser_profile_list`.
3. **No name/lookup:** profiles are UUIDs with a free label. No `get-by-name`, no start/stop (profiles are always running), no CLI.
4. **Docs say attaching a separate CDP client is outside the managed controller contract** (no handoff draining or ref invalidation for it).
5. **Coupling sites:** `profiles.ts tick()` (~L400–410) auto-creates a `Default` profile per Bot and un-assigns on Bot deletion; `create/select/delete` ownership checks (~L520–540); `bots/src/supervisor.ts` ~L479 injects `AGENT_BROWSER_*` only into Bot launches; the MCP identity in `api/src/bot-mcp-identity.ts` / `mcp-authority.ts`.

## Proposed design: first-class "standalone browsers"

**Model:** a `Browser` = a durable profile with `owner: {kind:"bot", botId} | {kind:"standalone", name}`. `name` is a unique slug (e.g. `major-briggs`). Same VM/volume machinery, no new runtime.

**Package API (browse socket/WebSocket/MCP), new ops:**
- `browser_standalone_create {name, label?}` / `_list` / `_get {name}` → `{id, name, state, cdpUrl, wsUrl, observation}`
- `browser_standalone_stop {name}` / `_start {name}` (clean Chrome flush then VM stop; today profiles are always on)
- `browser_standalone_delete {name, confirm:"delete"}`
- `browser_standalone_extensions_set {name, extensions:[{id, path|crx}]}` (see below)
- Optional page facade for agents without agent-browser: `browser_page_open/snapshot/act {name, session, …}`, implemented by spawning the private agent-browser toolchain (`browser/toolchain`) against the profile's CDP. That reuses agent-browser rather than re-implementing snapshots.

**MCP server:** expose the above via the existing MCP transport (`api.yaml` `mcp.operations`) under a new authority: a **standalone grant**, i.e. an operator-issued token bound to one browser name (`stack browse grant major-briggs`), checked in `mcp-authority.ts`. That's the piece that makes non-Bot agents first-class without operator-wide access.

**CLI (`packages/browse/cli.ts`):** `stack browse ls | create NAME | start NAME | stop NAME | rm NAME | cdp NAME | ab NAME -- <agent-browser args>`. The last one resolves the current relay, writes a per-name agent-browser config (`browser/controllers/standalone-NAME.json`, `--cdp` plus `--session NAME`) and execs the private toolchain, which avoids stale ports.

**agent-browser:** direct CDP via `stack browse ab NAME …` (fast, full agent-browser feature set). Register it as a managed controller (reuse `browser_controller_launch` internals with a standalone principal) so handoffs and ref invalidation keep working.

**Password manager (Bitwarden, free):** the image runs headful Chrome for Testing, which still honors `--load-extension` (branded Chrome dropped it). Plan: keep an unpacked Bitwarden build in the profile volume (`/home/kernel/extensions/bitwarden`) and append `--load-extension=…` to `CHROMIUM_FLAGS` in `backend.ts` (~L358) when the profile has extensions configured. Vault login happens once per profile, by a human via the Neko viewer/handoff (`browser_handoff_*` already exists). After that the extension state persists in user-data. Agents then trigger autofill through the extension UI or a keyboard shortcut. Alternatives: Bitwarden CLI (`bw`) on the host feeding `fill` commands (no extension; secrets transit the agent, so it's worse), or self-hosted Vaultwarden.

**Rough size:** owner model, ledger migration and tick changes ~150 LOC; API ops plus schemas ~250; MCP standalone grant ~150; CLI ~150; extension flag plus volume provisioning ~80; tests ~300. About 1–1.5k LOC, 2–3 days.

## Where we get / might get stuck

| Risk | Fix |
|---|---|
| Non-Bot agents can't use MCP browser ops | standalone grant authority (above) |
| CDP port changes after restart | `stack browse cdp/ab NAME` resolves on each call |
| Separate CDP clients bypass handoff draining | register standalone controllers via controller internals |
| Extension loading untested in the Kernel image | prototype: one profile with the `--load-extension` flag; check `chrome://extensions` via CDP target list |
| Vault unlock needs a human; the session may time out | set the Bitwarden vault timeout to "never"/on-restart lock, plus a handoff for re-unlock |
| VM is linux/amd64 on arm64 (emulated/vz), so it's slowish | acceptable; check vcpus/size |
| Max 16 native reservations; ≥12 GB free disk per new profile | keep profile count small |
| Stale failed profile `f3a9e7b8` ("browser target changed") | operator recovery or delete via `browser_profile_delete` after review |
| `mbtest` test profile `160eba7e` (label apply-test) left running | delete when done: `browser_profile_delete {profileId, confirm:"delete"}` |
