/* PROTOTYPE — synthetic Stack state for the pane-spaces design study. Nothing here is live.
   Shapes follow lib/stack/types.ts loosely so densities and labels are honest. */
window.D = (() => {
  const bots = [
    { id: "bot-1", state: "running", account: "codex-bot-account-1", model: "gpt-6-sol", effort: "medium", cwd: "~/code/stack", thread: "019a2c4e", pid: 48211, role: "Default r14", onCall: true, workers: 3, schedules: 2 },
    { id: "bot-2", state: "running", account: "codex-bot-account-2", model: "gpt-6-astra", effort: "high", cwd: "~/code/agentvoice", thread: "019a31f0", pid: 48377, role: "Default r14", handoff: "h-0c1f", workers: 1, schedules: 1 },
    { id: "bot-3", state: "stopped", account: "codex-bot-account-1", model: "gpt-5.6-terra", effort: "low", cwd: "~/code/agentbrain", thread: "019a0b77", pid: null, role: "Researcher r3", workers: 0, schedules: 0 },
  ];

  const chats = {
    "bot-1": {
      status: "Working · Reading packages/ui/lib/stack/geometry.ts · 1m 12s",
      turns: [
        { you: "Compare the open bench geometry with a split-tree layout. What would we delete?", at: "14:02", dur: "48s",
          reply: ["`lib/stack/geometry.ts` owns packing, settling and camera restore. A split tree removes **settleWindows**, **reconcileBench**, `fitBounds` and the camera entirely.", "What stays: window registrations (`WindowDef`), node destinations and every window body — they never depended on bench geometry."] },
        { you: "Draft the pane model as a type and keep destination storage keys.", at: "14:06", dur: "1m 31s",
          reply: ["```ts\ntype Layout = Split | Stack;\ntype Split = { axis: \"row\" | \"col\"; children: Array<{ node: Layout; size: number }> };\ntype Stack = { panes: string[]; active: number };\n```", "Storage stays under `uix.layout.v1.<space>` inside the destination namespace, so ADR 0167 isolation is unchanged."] },
        { you: "Now port Fleet. Keep the primary chat following the Bots selection.", at: "14:11", streaming: true,
          reply: ["Reading `components/canvas/spaces.tsx` and `chat-window.tsx`. The primary chat becomes the **following** pane; extra chat windows become **pinned** panes that keep their Bot"] },
      ],
    },
    "bot-2": {
      status: "Waiting for a browser handoff · 4m",
      turns: [
        { you: "Publish the voice filament build notes to the vault.", at: "13:40", dur: "2m 05s",
          reply: ["Published `voice-filament-build-notes` (rev 3). The Android capture still needs a signed-in GitHub session to attach the release."] },
        { you: "Go ahead and attach it.", at: "13:51", dur: "—",
          reply: ["I asked for a **browser handoff** on profile `bot-2-default`: GitHub wants a 2FA code. I'll continue once you finish it in Browse."] },
      ],
    },
    "bot-3": { status: "Stopped", turns: [] },
  };

  const accounts = [
    { id: "codex-bot-account-1", kind: "bot", provider: "codex", label: "codex-bot-account-1", ready: true, plan: "Pro", bots: ["bot-1", "bot-3"], pair: "codex-worker-account-1" },
    { id: "codex-bot-account-2", kind: "bot", provider: "codex", label: "codex-bot-account-2", ready: true, plan: "Pro", bots: ["bot-2"], pair: "codex-worker-account-2" },
    { id: "codex-worker-account-1", kind: "worker", provider: "codex", label: "codex-worker-account-1", ready: true },
    { id: "codex-worker-account-2", kind: "worker", provider: "codex", label: "codex-worker-account-2", ready: false },
    { id: "claude-worker-account-1", kind: "worker", provider: "claude", label: "claude-worker-account-1", ready: true, plan: "Max" },
    { id: "devin-worker-account-1", kind: "worker", provider: "devin", label: "devin-worker-account-1", ready: true, plan: "Team" },
  ];

  const usage = [
    { id: "codex-bot-account-1", provider: "Codex", plan: "Pro", windows: [{ label: "5 hours", left: 64, resets: "in 2h 41m" }, { label: "Weekly", left: 81, resets: "Tue 09:00" }], credits: "2 reset credits" },
    { id: "codex-bot-account-2", provider: "Codex", plan: "Pro", windows: [{ label: "5 hours", left: 23, resets: "in 58m" }, { label: "Weekly", left: 57, resets: "Tue 09:00" }] },
    { id: "claude-worker-account-1", provider: "Claude", plan: "Max", windows: [{ label: "5h", left: 50, resets: "in 4h 28m" }, { label: "Weekly", left: 33, resets: "Mon 00:00" }], warn: "Extra usage on" },
    { id: "devin-worker-account-1", provider: "Devin", plan: "Team", windows: [{ label: "Daily", left: 72, resets: "in 9h" }, { label: "Weekly", left: 55, resets: "Sun" }], credits: "72 / 100 credits" },
  ];

  const models = [
    { name: "gpt-6-sol", efforts: ["low", "medium", "high", "xhigh", "max", "ultra"] },
    { name: "gpt-6-astra", efforts: ["low", "medium", "high", "xhigh", "max", "ultra"] },
    { name: "gpt-5.6-terra", efforts: ["low", "medium", "high", "xhigh", "max", "ultra"] },
    { name: "gpt-5.6-luna", efforts: ["low", "medium", "high", "xhigh", "max"] },
    { name: "gpt-5.5", efforts: ["low", "medium", "high", "xhigh"] },
  ];

  const work = [
    { id: "w1", depth: 0, title: "Ship pane-based spaces", state: "active", pri: "high", att: "human", next: "Choose a shell direction", kids: 4, open: 4 },
    { id: "w2", depth: 1, title: "Design the shell and pane grammar", state: "review", pri: "high", att: "human", next: "Review the prototype", kids: 0, open: 0, sel: true },
    { id: "w3", depth: 1, title: "Re-tile transition between spaces", state: "active", pri: "normal", att: "agent", next: "Measure view-transition cost", kids: 0, open: 0 },
    { id: "w4", depth: 1, title: "Port Fleet and Workers to panes", state: "blocked", pri: "normal", att: "none", next: "Waits on the shell design", kids: 0, open: 0, deps: 1 },
    { id: "w5", depth: 1, title: "Migrate layout storage per destination", state: "planned", pri: "low", att: "none", next: "", kids: 0, open: 0 },
    { id: "w6", depth: 0, title: "Brain ingestion reliability", state: "active", pri: "normal", att: "agent", next: "Retry the two blocked jobs", kids: 3, open: 2 },
    { id: "w7", depth: 1, title: "Recover stale leases", state: "blocked", pri: "urgent", att: "human", next: "Decide: exclude job #4471?", kids: 0, open: 0 },
    { id: "w8", depth: 1, title: "Alert on unhealthy sources", state: "waiting", pri: "normal", att: "none", next: "Waiting for HN feed recovery", kids: 0, open: 0 },
    { id: "w9", depth: 1, title: "Backfill October share outbox", state: "completed", pri: "low", att: "none", next: "", kids: 0, open: 0 },
    { id: "w10", depth: 0, title: "Voice call dock polish", state: "paused", pri: "low", att: "none", next: "Resume after pane shell", kids: 2, open: 2 },
    { id: "w11", depth: 0, title: "Remote UI access audit", state: "planned", pri: "normal", att: "agent", next: "Inventory remote-hidden controls", kids: 0, open: 0 },
  ];

  const item = {
    id: "w2", title: "Design the shell and pane grammar", rev: 7, scope: 3, state: "review", pri: "high", att: "human",
    objective: "Replace the open bench with tiled panes: every space is a composed mini-app, panes are always fully visible, and moving between spaces keeps one frame.",
    next: "Review the prototype and pick a shell direction",
    summary: "Three shell directions prototyped (Tiles, Mux, Strip) with 2–3 layout presets per space. Recommendation drafted.",
    parent: "Ship pane-based spaces", order: "1 of 4", labels: ["design", "ui", "shell"],
    links: [{ rel: "lead", label: "bot-1", kind: "bot" }, { rel: "contributor", label: "Worker 7f3a · turn 3", kind: "worker" }, { rel: "output", label: "pane-spaces prototype", kind: "resource" }],
    created: "Operator · Thu", edited: "bot-1 · 6m ago",
  };

  const timeline = [
    { kind: "note", who: "bot-1", at: "6m", tag: "Result", text: "Prototype covers all 15 spaces; Tiles reads best at 1440px, Mux at 1920px." },
    { kind: "edit", who: "bot-1", at: "9m", text: "State Active → Review", before: "Active", after: "Review" },
    { kind: "focus", who: "bot-1", at: "40m", text: "Chat focus set on this item (main chat)" },
    { kind: "note", who: "Operator", at: "1h", tag: "Decision", text: "Keep space keys; panes get ⌥+arrows." },
    { kind: "edit", who: "Operator", at: "2h", text: "Next action changed", before: "Sketch three directions", after: "Review the prototype" },
    { kind: "note", who: "bot-1", at: "3h", tag: "Handoff", text: "Worker 7f3a builds the layout engine; I keep the design doc.", scope: true },
    { kind: "edit", who: "Operator", at: "Thu", text: "Created under Ship pane-based spaces" },
  ];

  const attention = {
    human: [
      { id: "w7", title: "Recover stale leases", why: "Decide: exclude job #4471?", pri: "urgent" },
      { id: "w1", title: "Ship pane-based spaces", why: "Choose a shell direction", pri: "high" },
    ],
    review: [{ id: "w2", title: "Design the shell and pane grammar", why: "Review the prototype", pri: "high" }],
    blocked: [{ id: "w4", title: "Port Fleet and Workers to panes", why: "Waits on Design the shell", pri: "normal" }],
    agent: [
      { id: "w3", title: "Re-tile transition between spaces", why: "Measure view-transition cost", pri: "normal" },
      { id: "w11", title: "Remote UI access audit", why: "Inventory remote-hidden controls", pri: "normal" },
    ],
    waiting: [{ id: "w8", title: "Alert on unhealthy sources", why: "Waiting for HN feed recovery", pri: "normal" }],
    recent: [
      { tag: "Result", text: "Prototype covers all 15 spaces", who: "bot-1", at: "6m" },
      { tag: "Decision", text: "Keep space keys; panes get ⌥+arrows", who: "Operator", at: "1h" },
      { tag: "Handoff", text: "Worker 7f3a builds the layout engine", who: "bot-1", at: "3h", old: true },
    ],
  };

  const workers = [
    { id: "7f3a", label: "stack · 7f3a", bot: "bot-1", account: "codex-worker-account-1", provider: "Codex", model: "gpt-6-sol", effort: "high", phase: "running", turn: 3, branch: "worktree/pane-engine", base: "f89c54f", repo: "stack", updated: "now", work: "Re-tile transition between spaces" },
    { id: "19c2", label: "agentvoice · 19c2", bot: "bot-2", account: "claude-worker-account-1", provider: "Claude", model: "claude-opus-4.6", effort: "high", phase: "awaiting_input", turn: 2, branch: "worktree/filament-notes", base: "a41d0e2", repo: "agentvoice", updated: "3m", perm: "Run `./gradlew assembleRelease`?" },
    { id: "55e0", label: "agentbrain · 55e0", bot: "bot-1", account: "devin-worker-account-1", provider: "Devin", model: "swe-1.6", effort: null, phase: "needs_recovery", turn: 1, branch: "worktree/lease-retry", base: "0c9b113", repo: "agentbrain", updated: "21m", issue: "Runtime restarted mid-turn" },
    { id: "a811", label: "stack · a811", bot: "bot-1", account: "codex-worker-account-1", provider: "Codex", model: "gpt-5.6-terra", effort: "medium", phase: "idle", turn: 5, branch: "worktree/layout-storage", base: "f89c54f", repo: "stack", updated: "34m" },
    { id: "c4d9", label: "stack · c4d9", bot: "Operator", account: "codex-worker-account-1", provider: "Codex", model: "gpt-6-sol", effort: "medium", phase: "idle", turn: 2, branch: "worktree/rail-icons", base: "e11a2f0", repo: "stack", updated: "1h" },
    { id: "03be", label: "agentvoice · 03be", bot: "bot-2", account: "claude-worker-account-1", provider: "Claude", model: "claude-sonnet-4.6", effort: "medium", phase: "closed", turn: 4, branch: "worktree/dock-polish", base: "77aa010", repo: "agentvoice", updated: "Thu" },
  ];

  const workerLog = [
    { k: "user", text: "Implement the split-tree layout engine in lib/stack/layout.ts with pure functions and tests." },
    { k: "agent", text: "I'll start from the existing geometry module and keep window registrations untouched." },
    { k: "tool", name: "read", detail: "packages/ui/lib/stack/geometry.ts", state: "completed" },
    { k: "tool", name: "read", detail: "packages/ui/components/canvas/spaces.tsx", state: "completed" },
    { k: "plan", items: [["done", "Model Split and Stack nodes"], ["done", "insert / remove / swap operations"], ["doing", "Directional focus from pane rectangles"], ["todo", "Persist under the destination namespace"]] },
    { k: "tool", name: "edit", detail: "packages/ui/lib/stack/layout.ts  +214 −0", state: "completed" },
    { k: "tool", name: "bash", detail: "pnpm --filter @stack/ui test", state: "running" },
    { k: "agent", text: "Tests for insert and remove pass. Directional focus needs rectangles from the DOM, so I'm keeping it in the shell and the math pure." },
  ];

  const runtimes = [
    { provider: "Codex", backend: "acp", state: "running", pid: 51022, model: "account" },
    { provider: "Claude", backend: "claude-sdk", state: "running", pid: 51190, model: "session" },
    { provider: "Devin", backend: "acp", state: "error", pid: null, model: "account", error: "exited 137" },
  ];

  const notifications = [
    { id: "n41", title: "Approve the pane migration plan?", sub: "bot-1 · HUD", src: "bot-1", at: "4m", open: true, q: true, actions: ["Approve", "Revise", "Hold"],
      body: "The plan replaces the bench with split-tree layouts per space and keeps window registrations, node destinations and destination storage. **Nothing ships without a rebuild and your restart.**\n\n1. Layout engine and tests\n2. Port Fleet, Workers, HUD\n3. Remaining spaces" },
    { id: "n40", title: "Browser handoff needs you", sub: "bot-2 · bot-2-default", src: "browse", at: "9m", open: true, link: true, body: "GitHub asks for a two-factor code to finish signing in." },
    { id: "n39", title: "Watch “Unlocked issues”: 3 new matches", sub: "source · owner/project", src: "source", at: "22m", open: true, body: "Deliveries #79–#81 matched." },
    { id: "n38", title: "Which branch should the fix base on?", sub: "bot-2", src: "bot-2", at: "41m", open: true, q: true, reply: true, body: "`main` moved twice since the bug report. Base on `main` or on the release tag `v0.14.2`?" },
    { id: "n37", title: "Nightly backup finished", sub: "proc · nightly-backup", src: "proc", at: "3h", open: false, outcome: "closed", body: "2.1 GB in 4m 12s." },
    { id: "n36", title: "Usage below 25% on codex-bot-account-2", sub: "usage", src: "usage", at: "5h", open: false, outcome: "opened", body: "5-hour window at 23%." },
    { id: "n35", title: "Worker 19c2 is waiting for a permission answer", sub: "worker", src: "worker", at: "Thu", open: false, outcome: "action: Open", body: "" },
    { id: "n34", title: "Brain source “HN front page” unhealthy", sub: "brain", src: "brain", at: "Thu", open: false, outcome: "replaced", body: "" },
  ];

  const signal = {
    enabled: true, model: "gpt-5.6-luna", effort: "low", lastScan: "1s", lastInference: "2m", backlog: { queued: 2, running: 1, failed: 0 },
    items: [
      { id: "a1", kind: "response", who: "bot-2", text: "Which branch should the fix base on: main or v0.14.2?", urgency: "high", age: "41m", deadline: null, explicit: true },
      { id: "a2", kind: "review", who: "bot-1", text: "Review the pane-spaces prototype before porting Fleet", urgency: "normal", age: "6m", deadline: "today", explicit: true },
      { id: "a3", kind: "action", who: "bot-2", text: "Finish the GitHub 2FA handoff on bot-2-default", urgency: "high", age: "9m", explicit: false },
      { id: "a4", kind: "awareness", who: "bot-1", text: "Worker 55e0 needs recovery after a runtime restart", urgency: "low", age: "21m", explicit: false },
    ],
    messages: [
      { id: "m88", who: "bot-2", text: "`main` moved twice since the bug report. Base on `main` or the release tag?", at: "41m", items: 1 },
      { id: "m87", who: "bot-1", text: "Prototype is up. Review before I port Fleet?", at: "6m", items: 1 },
      { id: "m86", who: "bot-2", text: "Asked for a browser handoff: GitHub 2FA.", at: "9m", items: 1, provisional: true },
      { id: "m85", who: "bot-1", text: "Worker 55e0 hit a runtime restart; recovery is on its Bot.", at: "21m", items: 1 },
      { id: "m84", who: "bot-1", text: "Merged the tooltip fix.", at: "1h", items: 0, superseded: true },
    ],
    runs: [
      { id: "r312", state: "completed", msg: "m88", model: "gpt-5.6-luna · low", ms: 1840, items: 1, at: "41m" },
      { id: "r311", state: "completed", msg: "m87", model: "gpt-5.6-luna · low", ms: 1210, items: 1, at: "6m" },
      { id: "r310", state: "unknown", msg: "m86", model: "gpt-5.6-luna · low", ms: null, items: 0, at: "9m", decide: true },
      { id: "r309", state: "completed", msg: "m85", model: "gpt-5.6-luna · low", ms: 990, items: 1, at: "21m" },
      { id: "r308", state: "failed", msg: "m84", model: "gpt-5.6-luna · low", ms: 30000, items: 0, at: "1h", error: "timeout" },
    ],
    changes: [
      ["14:31:02", "item_created", "a2 review · bot-1"], ["14:26:40", "run_completed", "r311 · 1 item"], ["14:12:09", "run_unknown", "r310 · needs decision"],
      ["14:08:51", "message_captured", "m86 provisional"], ["13:52:30", "item_created", "a1 response · bot-2"], ["13:40:18", "defaults_saved", "rev 6"],
    ],
  };

  const docs = [
    { slug: "pane-spaces-design", title: "Pane spaces design", tags: ["design", "ui"], at: "6m", snippet: "Every space is a composed mini-app; panes are always fully visible…" },
    { slug: "q4-roadmap", title: "Q4 roadmap", tags: ["plan"], at: "2h", snippet: "Panes, remote UI audit, Brain reliability, voice dock…" },
    { slug: "voice-filament-build-notes", title: "Voice filament build notes", tags: ["agentvoice", "android"], at: "41m", snippet: "Gradle release build signs with the upload key…" },
    { slug: "niri-scrolling-tiling", title: "niri: scrollable tiling", tags: ["research", "wm"], at: "Thu", snippet: "Columns on an infinite strip; the focused column scrolls into view…" },
    { slug: "tmux-swap-layouts", title: "Swap layouts in zellij", tags: ["research", "wm"], at: "Thu", snippet: "Layouts adapt to pane count; a key cycles them…" },
    { slug: "access-remote-ui", title: "Remote UI through Access", tags: ["security"], at: "Sep 30", snippet: "Five-minute sessions on a dedicated TLS origin…" },
    { slug: "brain-maintenance", title: "Brain maintenance invariants", tags: ["brain", "ops"], at: "Sep 28", snippet: "Read-only retrieval, fenced completion, full FTS row replacement…" },
  ];

  const docBody = `# Pane spaces design

Every Canvas space becomes a **composed mini-app** built from tiled panes. Panes are always fully visible at the viewport's size; there is no camera, no zoom and no fit.

## Principles

- One frame: the rail, status and drawer never move when the space changes.
- Panes are responsive to *their own* size.
- Links focus the destination pane and flash the row.

See [[tmux-swap-layouts]] and [[niri-scrolling-tiling]].`;

  const library = [
    { name: "rail-icons.svg", kind: "image", size: "14 KB", rev: 3, at: "1h", coll: "Design" },
    { name: "pane-grid.png", kind: "image", size: "212 KB", rev: 1, at: "2h", coll: "Design" },
    { name: "layout-presets.json", kind: "file", size: "3.1 KB", rev: 5, at: "2h", coll: "Design" },
    { name: "handoff-notes.md", kind: "document", size: "2.4 KB", rev: 2, at: "Thu", coll: null },
    { name: "voice-capture.m4a", kind: "file", size: "4.8 MB", rev: 1, at: "Thu", coll: "Voice" },
    { name: "filament-release.apk", kind: "file", size: "38 MB", rev: 1, at: "Wed", coll: "Voice" },
  ];
  const collections = [["All", 19], ["Ungrouped", 4], ["Design", 8], ["Voice", 5], ["Research", 2]];
  const artifacts = [
    { name: "pane-spaces-prototype", versions: 4, latest: "v·9c1e", at: "6m" },
    { name: "q30-probe", versions: 2, latest: "v·41aa", at: "Thu" },
    { name: "fleet-map", versions: 7, latest: "v·0d2f", at: "Sep 29", tomb: 1 },
  ];

  const scrape = {
    url: "https://github.com/niri-wm/niri",
    result: "# niri\n\nA scrollable-tiling Wayland compositor.\n\nWindows are arranged in columns on an infinite strip going to the right. Opening a new window never causes existing windows to resize.\n\n## Features\n\n- Scrollable tiling\n- Dynamic workspaces like in GNOME\n- An Overview that zooms out workspaces and windows",
    presets: [
      { name: "github-repo", host: "github.com", state: "healthy", last: "12m", canary: "pass" },
      { name: "x-post", host: "x.com", state: "healthy", last: "40m", canary: "pass" },
      { name: "chatgpt-share", host: "chatgpt.com", state: "drift", last: "2h", canary: "fail" },
      { name: "deepwiki", host: "deepwiki.com", state: "healthy", last: "1h", canary: "pass" },
      { name: "arxiv-abs", host: "arxiv.org", state: "healthy", last: "3h", canary: "pass" },
    ],
    queue: [
      { id: "j-2201", url: "arxiv.org/abs/2609.01234", state: "running", dest: "~/scratch/papers", at: "now" },
      { id: "j-2200", url: "github.com/niri-wm/niri", state: "done", dest: "~/scratch/wm", at: "4m" },
      { id: "j-2199", url: "chatgpt.com/share/6f1…", state: "failed", dest: "~/scratch/chats", at: "2h", error: "malformed_provider_output" },
      { id: "j-2198", url: "x.com/i/status/18…", state: "done", dest: "~/scratch/x", at: "3h" },
    ],
    feeds: [{ title: "niri releases", at: "Oct 8", url: "github.com/niri-wm/niri/releases/tag/v25.11" }, { title: "Zellij 0.44: swap layouts everywhere", at: "Oct 2", url: "zellij.dev/news/0.44" }, { title: "Hyprland 0.52", at: "Sep 27", url: "hyprland.org/news" }],
  };

  const browse = {
    handoffs: [
      { id: "h-0c1f", bot: "bot-2", profile: "bot-2-default", state: "awaiting_human", msg: "GitHub asks for a two-factor code to finish signing in.", tab: true, drained: true, at: "9m" },
      { id: "h-0bfe", bot: "bot-1", profile: "bot-1-research", state: "completed", msg: "Accept the cookie banner on arxiv.org", at: "Thu", resolved: true },
    ],
    profiles: [
      { name: "bot-1-default", bot: "bot-1", state: "ready", def: true, sel: true },
      { name: "bot-1-research", bot: "bot-1", state: "ready" },
      { name: "bot-2-default", bot: "bot-2", state: "ready", def: true, held: true, sel: true },
      { name: "scratch-unassigned", bot: null, state: "stopped" },
    ],
    controllers: [{ name: "bot-1 · main", profile: "bot-1-default", state: "connected" }, { name: "bot-2 · main", profile: "bot-2-default", state: "held" }],
  };

  const brain = {
    query: "tiling window manager",
    hits: [
      { id: "rd-881", title: "niri: a scrollable-tiling Wayland compositor", src: "github.com", kind: "article", score: 12.4, snippet: "Windows are arranged in <mark>columns</mark> on an infinite strip; opening a new <mark>window</mark> never resizes existing ones." },
      { id: "rd-874", title: "Zellij swap layouts", src: "zellij.dev", kind: "article", score: 10.1, snippet: "<mark>Swap layouts</mark> change how panes are arranged as their number grows." },
      { id: "rd-702", title: "i3 user guide: tree and containers", src: "i3wm.org", kind: "article", score: 9.6, snippet: "Every <mark>window</mark> lives in a container; containers split horizontally, vertically, or are tabbed." },
      { id: "rd-655", title: "PaperWM: tiling on a scrolling strip", src: "github.com", kind: "article", score: 8.2, snippet: "<mark>Tiling</mark> with a horizontal strip per workspace, inspired by paper." },
      { id: "rd-590", title: "Why tmux stays: panes, windows and sessions", src: "news.ycombinator.com", kind: "thread", score: 6.9, snippet: "The pane/<mark>window</mark>/session hierarchy is the whole mental model…" },
    ],
    jobs: { failed: 1, blocked: 1, retry: 2, active: 3, done: 1840, stale: 1 },
    jobRows: [
      { id: 4471, state: "blocked", src: "arxiv cs.HC", at: "2h", why: "egress grant missing" },
      { id: 4468, state: "failed", src: "HN front page", at: "3h", why: "timeout after 3 attempts" },
      { id: 4480, state: "running", src: "share · phone", at: "now" },
      { id: 4479, state: "retry_wait", src: "RSS · lobste.rs", at: "1m" },
      { id: 4477, state: "done", src: "share · chrome", at: "6m" },
    ],
    sources: [
      { name: "HN front page", health: "unhealthy", next: "in 4m", last: "3h", paused: false },
      { name: "arXiv cs.HC", health: "healthy", next: "in 2h", last: "4h", paused: false },
      { name: "lobste.rs", health: "healthy", next: "in 18m", last: "12m", paused: false },
      { name: "X list: wm-people", health: "paused", next: "—", last: "Thu", paused: true },
    ],
    reader: {
      title: "niri: a scrollable-tiling Wayland compositor", src: "https://github.com/niri-wm/niri", meta: "article · github.com · indexed Oct 8",
      body: ["Windows are arranged in columns on an infinite strip going to the right. Opening a new window never causes existing windows to resize.", "Every monitor has its own separate window strip. Windows can never \"overflow\" onto an adjacent monitor.", "Workspaces are dynamic and arranged vertically. Every monitor has an independent set of workspaces, and there's always one empty workspace present all the way down.", "The Overview zooms out workspaces and windows so you can see what's going on at a glance, navigate and drag windows around."],
    },
  };

  const proc = {
    schedules: [
      { id: "s1", label: "cleanup.sh", owner: "unattributed", cadence: "daily 03:30", next: "—", group: "needs", strip: "xxxxx·xxxxxx" },
      { id: "s2", label: "brain-sync", owner: "bot-1", cadence: "every 30m", next: "in 12m", group: "needs", strip: "ccccccccccxc", sel: true },
      { id: "s3", label: "report-weekly", owner: "bot-2", cadence: "Mon 09:00", next: "held · retry in 18m", group: "held", strip: "cccc?" },
      { id: "s4", label: "usage-snapshot", owner: "system", cadence: "every 5m", next: "in 2m", group: "upcoming", strip: "cccccccccccc" },
      { id: "s5", label: "nightly-backup", owner: "operator", cadence: "daily 02:00", next: "in 7h", group: "upcoming", strip: "cccccccccccc" },
      { id: "s6", label: "scrape-feeds", owner: "bot-1", cadence: "every 2h", next: "off", group: "off", strip: "cccccc" },
    ],
    runs: [
      { id: "r-9031", label: "pnpm test", owner: "bot-1", origin: "direct", state: "running", elapsed: "1m 12s", lines: 412 },
      { id: "r-9030", label: "brain-sync", owner: "bot-1", origin: "brain-sync", state: "failed", elapsed: "31s", lines: 88, exit: 1 },
      { id: "r-9027", label: "usage-snapshot", owner: "system", origin: "usage-snapshot", state: "completed", elapsed: "2s", lines: 6 },
      { id: "r-9019", label: "nightly-backup", owner: "operator", origin: "nightly-backup", state: "completed", elapsed: "4m 12s", lines: 1904 },
      { id: "r-9015", label: "agentbrain doctor", owner: "bot-1", origin: "direct", state: "unknown", elapsed: "—", lines: 12 },
    ],
    log: [
      ["o", "> @stack/ui@0.0.0 test"], ["o", "> node --test test/*.test.mjs"], ["o", ""],
      ["o", "▶ layout"], ["o", "  ✔ inserts a pane to the right of a leaf (0.8ms)"], ["o", "  ✔ removes a pane and collapses its split (0.4ms)"],
      ["o", "  ✔ swaps panes across stacks (0.5ms)"], ["e", "  ✖ keeps sizes when a stack empties (1.1ms)"], ["e", "    AssertionError: expected [0.5, 0.5] to equal [0.3, 0.7]"],
      ["o", "▶ destination storage"], ["o", "  ✔ namespaces layouts by server identity (0.6ms)"], ["o", "  ✔ quarantines unqualified keys (0.3ms)"],
      ["o", "▶ spaces"], ["o", "  ✔ every node kind has a home pane (2.4ms)"], ["o", "…"],
    ],
  };

  const source = {
    receivers: [
      { id: "rc-1", label: "Product repository", target: "owner/project", enabled: true, last: "just now", ping: "just now", acc: 58, dup: 0, rej: 0 },
      { id: "rc-2", label: "Org hooks", target: "org: owner", enabled: true, last: "2h", ping: "Thu", acc: 23, dup: 1, rej: 0 },
      { id: "rc-3", label: "Sponsors listing", target: "sponsors: owner", enabled: false, last: "none observed", ping: "none observed", acc: 0, dup: 0, rej: 2 },
    ],
    deliveries: [
      { seq: 81, event: "issues", action: "opened", repo: "owner/project", who: "human", title: "issue #81 · Pane focus ring too faint", size: "277 B", at: "1m" },
      { seq: 80, event: "pull_request", action: "synchronize", repo: "owner/project", who: "bot-1", title: "pull_request #412 · Pane layout engine", size: "1.9 KB", at: "4m", sel: true },
      { seq: 79, event: "push", action: null, repo: "owner/project", who: "bot-1", title: "worktree/pane-engine · 2 commits", size: "3.4 KB", at: "4m" },
      { seq: 78, event: "check_run", action: "completed", repo: "owner/project", who: "github-actions", title: "check_run · test · success", size: "2.2 KB", at: "9m" },
      { seq: 77, event: "issue_comment", action: "created", repo: "owner/project", who: "human", title: "issue #79 · comment", size: "640 B", at: "31m", cleared: true },
      { seq: 76, event: "ping", action: null, repo: "owner/project", who: "github", title: "hook #17 ping", size: "212 B", at: "2h" },
    ],
    watches: [
      { id: "wt-1", label: "Unlocked issues", notif: true, filter: ["event issues", "payload /issue/locked = false"], ack: 78, through: 81, pending: 3 },
      { id: "wt-2", label: "PRs by bots", notif: false, filter: ["event pull_request", "sender starts_with bot-"], ack: 80, through: 80, pending: 0 },
    ],
  };

  const roles = {
    list: [{ name: "Default", rev: 14, def: true, bots: 2, workers: 0 }, { name: "Researcher", rev: 3, bots: 1 }, { name: "Reviewer", rev: 1, bots: 0 }, { name: "Worker", rev: 6, fixed: true, workers: 4 }],
    categories: [
      { name: "Identity", on: true, frags: [["Who you are", true, 180], ["How you speak", true, 240]] },
      { name: "Working", on: true, frags: [["Worktrees for every change", true, 410, true], ["Verification before claims", true, 380], ["Delegation envelope", true, 920], ["Brain before search", false, 160]] },
      { name: "Voice", on: false, frags: [["Spoken receipts", true, 300]] },
    ],
    skills: [["code-review", true], ["prototype", true], ["diagnosing-bugs", true], ["brain", true], ["wiki", false]],
    mcp: [["agentbrain", "stdio", true], ["agentwiki", "stdio", true], ["linear", "http", false]],
    internal: [["hud", true], ["bots", true], ["worker", true], ["browse", true], ["source", false], ["roles", true]],
    projects: [["~/code", true, 3], ["~/source", false, 0]],
    shims: [["claude", "~/.local/bin/claude-researcher", "Researcher"], ["codex", "~/.local/bin/codex-reviewer", "Reviewer"]],
  };

  const system = {
    server: { pid: 48102, uptime: "3d 4h", node: "v26.10.0", version: "stack 0.14.2", started: "Tue 10:12", children: [["ui", true, 48140], ["inspector", true, 48151], ["docs-snapshot", true, 48163], ["codexnk", true, 48170], ["hypeman", false, null]] },
    packages: [["access", 14, "open"], ["auth", 22, "open"], ["bots", 61, "open"], ["brain", 33, "open"], ["browse", 29, "open"], ["content", 31, "open"], ["hud", 24, "open"], ["notify", 11, "open"], ["proc", 19, "open"], ["roles", 41, "open"], ["scrape", 18, "closed"], ["serve", 28, "open"], ["signal", 16, "open"], ["source", 37, "open"], ["usage", 6, "open"], ["worker", 43, "open"]],
    cpu: [12, 14, 13, 18, 22, 19, 16, 25, 31, 28, 22, 18, 17, 21, 26, 34, 29, 23, 19, 18, 20, 24, 27, 22],
    rss: [1.9, 1.9, 2.0, 2.0, 2.1, 2.1, 2.1, 2.2, 2.4, 2.4, 2.3, 2.3, 2.3, 2.3, 2.4, 2.6, 2.6, 2.5, 2.5, 2.5, 2.5, 2.6, 2.6, 2.6],
    scopes: [["bot-1", 31, "1.1 GB"], ["bot-2", 22, "820 MB"], ["Codex runtime", 9, "410 MB"], ["Claude runtime", 6, "350 MB"], ["ui (next)", 3, "290 MB"], ["serve", 2, "180 MB"]],
    procs: [[0, "node serve", 48102, 2.1, "180 MB"], [1, "next-server", 48140, 0.4, "290 MB"], [1, "codex app-server · bot-1", 48211, 18.2, "640 MB"], [2, "node ./mcp/hud", 48230, 0.1, "62 MB"], [2, "rg --json", 51877, 9.8, "24 MB"], [1, "codex app-server · bot-2", 48377, 11.4, "520 MB"], [1, "opencode acp", 51022, 6.3, "410 MB"], [1, "claude-sdk", 51190, 4.0, "350 MB"]],
    activity: [["14:31:02", "hud", "hud_changed"], ["14:30:58", "worker", "workers_changed"], ["14:30:41", "bots", "bots_changed"], ["14:29:12", "notify", "notify_changed"], ["14:28:40", "source", "github_deliveries_changed"], ["14:26:03", "brain", "jobs_changed"], ["14:24:19", "serve", "serve_settings_changed"]],
  };

  return { bots, chats, accounts, usage, models, work, item, timeline, attention, workers, workerLog, runtimes, notifications, signal, docs, docBody, library, collections, artifacts, scrape, browse, brain, proc, source, roles, system };
})();
