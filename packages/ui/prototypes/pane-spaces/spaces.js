/* PROTOTYPE — spaces, rail groups and layout presets.
   Tree DSL: R(...) row split, C(...) column split, T(...) a tabbed stack, "id" a single pane; [node, size] sets a share. */
(() => {
  const kids = (c) => c.map((x) => (Array.isArray(x) ? { n: wrap(x[0]), s: x[1] } : { n: wrap(x), s: 1 }));
  const wrap = (x) => (typeof x === "string" ? { t: "stack", p: [x], a: 0 } : x);
  const R = (...c) => ({ t: "row", c: kids(c) });
  const C = (...c) => ({ t: "col", c: kids(c) });
  const T = (...p) => ({ t: "stack", p, a: 0 });

  window.GROUPS = [
    { id: "work", label: "Work", spaces: ["hud", "inbox", "signal"] },
    { id: "agents", label: "Agents", spaces: ["fleet", "workers", "roles", "accounts", "browse"] },
    { id: "knowledge", label: "Knowledge", spaces: ["content", "brain", "scrape"] },
    { id: "machine", label: "Machine", spaces: ["proc", "source", "system", "lab"] },
  ];

  window.SPACES = {
    hud: {
      title: "HUD", key: "h", icon: "hud", accent: "--pkg-hud",
      description: "What we’re trying to accomplish, where each piece stands and what needs someone next",
      attention: { n: 3, reasons: ["2 items marked for you", "1 item in review"] },
      presets: [
        { name: "Triage", tree: R([C(["hud-attention", 0.42], ["hud-work", 0.58]), 0.3], ["hud-item", 0.38], [C(["hud-timeline", 0.58], ["hud-resources", 0.42]), 0.32]) },
        { name: "Focus", tree: R(["hud-work", 0.27], ["hud-item", 0.43], [T("hud-timeline", "hud-resources", "hud-attention"), 0.3]) },
        { name: "Board", tree: C(["hud-attention", 0.38], [R(["hud-work", 0.34], ["hud-item", 0.38], [T("hud-timeline", "hud-resources"), 0.28]), 0.62]) },
      ],
      notes: "<b>Mini-app:</b> a project tracker — find, read, act, with evidence on the right. <b>Triage</b> (default) keeps what needs you above the hierarchy so the landing space answers “what now?” before “what exists?”. <b>Focus</b> trades the attention list for a wide item editor. <b>Board</b> gives Needs attention the full width, where it re-flows into five lanes (For you · In review · Blocked · For agents · Waiting) — the same pane, rendered for its size.",
    },
    inbox: {
      title: "Inbox", key: "6", icon: "inbox", accent: "--pkg-notify",
      description: "Notifications to send, read, answer and dismiss",
      attention: { n: 4, reasons: ["4 open notifications"] },
      presets: [
        { name: "Mail", tree: R(["notify-inbox", 0.37], [T("notify-detail", "notify-compose"), 0.63]) },
        { name: "Reading pane below", tree: C(["notify-inbox", 0.46], [T("notify-detail", "notify-compose"), 0.54]) },
        { name: "Three-up", tree: R(["notify-inbox", 0.32], ["notify-detail", 0.38], ["notify-compose", 0.3]) },
      ],
      notes: "<b>Mini-app:</b> a mail client. <b>Mail</b> (default) is list + reading pane; Compose is a tab behind the reading pane and the Inbox’s compose action brings it forward. <b>Reading pane below</b> suits tall or narrow windows. <b>Three-up</b> is today’s bench arrangement for people who compose often. Choosing a row still never dismisses.",
    },
    signal: {
      title: "Signal", key: "7", icon: "radar", accent: "--pkg-events",
      description: "What conversations ask of you, and how it was interpreted",
      attention: { n: 0, dot: true, reasons: ["Run r310 outcome unknown"] },
      presets: [
        { name: "Attention", tree: R(["signal", 0.24], ["attention", 0.43], [T("attention-messages", "attention-runs", "attention-changes"), 0.33]) },
        { name: "Trace", tree: R([T("attention", "signal"), 0.3], ["attention-runs", 0.42], [T("attention-messages", "attention-changes"), 0.28]) },
        { name: "Operate", tree: R(["signal", 0.34], [C(["attention-runs", 0.56], ["attention-changes", 0.44]), 0.66]) },
      ],
      notes: "<b>Mini-app:</b> an inbox with its evidence. <b>Attention</b> (default) runs left→right in the order the space is used: the switch and health, what is asked, then the evidence. <b>Trace</b> is for judging an interpretation — runs get the width their traces need. <b>Operate</b> is the maintenance view: processing, runs, the change log.",
    },
    fleet: {
      title: "Fleet", key: "1", icon: "bot", accent: "--pkg-bots",
      description: "Bots and their controls",
      attention: { n: 0, reasons: [] },
      presets: [
        { name: "Chat", tree: R([T("bots", "bot-state"), 0.28], ["chat", 0.72]) },
        { name: "Tiled chats", tree: R(["bots", 0.24], [R(["chat", 0.5], [C(["chat:bot-2", 0.5], ["chat:bot-3", 0.5]), 0.5]), 0.76]) },
        { name: "State", tree: R(["bots", 0.32], ["bot-state", 0.68]) },
      ],
      notes: "<b>Mini-app:</b> a multiplexer for agents — the most literal tmux space. <b>Chat</b> (default): Bots beside the following chat pane. ⌘-click a Bot’s Chat to split a pinned chat pane (the old “additional chat window”). <b>Tiled chats</b> watches several main threads at once (tmux’s main-vertical). <b>State</b> gives Bot state’s eight views room.",
    },
    workers: {
      title: "Workers", key: "9", icon: "hammer", accent: "--pkg-worker",
      description: "What Workers started by Bots are doing, and their saved model settings",
      attention: { n: 2, reasons: ["agentvoice · 19c2: awaiting a permission answer", "agentbrain · 55e0: needs recovery"] },
      presets: [
        { name: "Follow", tree: R([C(["workers", 0.74], ["worker-runtimes", 0.26]), 0.3], ["worker", 0.7]) },
        { name: "Compare", tree: R(["workers", 0.24], ["worker", 0.38], ["worker:19c2", 0.38]) },
      ],
      notes: "<b>Mini-app:</b> an agent console with code review. <b>Follow</b> (default): the list drives one wide following Worker pane. <b>Compare</b> pins a second Worker beside it — the old “additional Worker window” becomes a split you can zoom. Still read-only apart from managed settings.",
    },
    roles: {
      title: "Roles", key: "5", icon: "roles", accent: "--pkg-roles",
      description: "Named Roles, their instructions and launch resources, and the commands that launch them",
      attention: { n: 0, reasons: [] },
      presets: [
        { name: "Editor", tree: R([C(["role-catalog", 0.32], [T("role-instructions", "role-skills", "role-mcp-servers", "role-projects"), 0.68]), 0.26], ["role-editor", 0.42], [T("role-preview", "role-shims"), 0.32]) },
        { name: "Resources", tree: R(["role-catalog", 0.22], [C(["role-skills", 0.3], ["role-mcp-servers", 0.44], ["role-projects", 0.26]), 0.34], ["role-editor", 0.44]) },
        { name: "Review", tree: R(["role-instructions", 0.36], ["role-preview", 0.64]) },
      ],
      notes: "<b>Mini-app:</b> an IDE — explorer, editor, preview. <b>Editor</b> (default): Roles and an explorer stack (Instructions, Skills, MCP servers, Trusted projects) on the left, the single Editor in the middle, Preview on the right. <b>Resources</b> shows the three launch-resource lists at once. <b>Review</b> reads the assembled instructions against their sources.",
    },
    accounts: {
      title: "Accounts", key: "2", icon: "key", accent: "--pkg-auth",
      description: "Accounts, usage limits, and model catalogs",
      attention: { n: 1, reasons: ["codex-worker-account-2 needs sign-in"] },
      presets: [
        { name: "Overview", tree: R(["accounts", 0.34], ["usage", 0.36], ["model-catalogs", 0.3]) },
        { name: "Usage", tree: C(["usage", 0.56], [R(["accounts", 0.5], ["model-catalogs", 0.5]), 0.44]) },
      ],
      notes: "<b>Mini-app:</b> a quota dashboard. <b>Overview</b> (default) puts the three peers side by side. <b>Usage</b> gives meters the full width, where the Usage pane switches to two columns of accounts.",
    },
    browse: {
      title: "Browse", key: "b", icon: "monitor", accent: "--pkg-browse",
      description: "Bot browser profiles, human handoffs and the browser toolchain",
      attention: { n: 1, reasons: ["bot-2-default: a handoff awaits you"] },
      presets: [
        { name: "Handoff", tree: R([C(["browse-handoffs", 0.38], [T("browse-profiles", "browse-controllers", "browse-toolchain"), 0.62]), 0.27], ["viewer", 0.73]) },
        { name: "Watch", tree: R(["browse-handoffs", 0.22], ["viewer", 0.39], ["viewer:bot-1-default", 0.39]) },
        { name: "Manage", tree: R([C(["browse-handoffs", 0.5], ["browse-controllers", 0.5]), 0.33], ["browse-profiles", 0.33], ["browse-toolchain", 0.34]) },
      ],
      notes: "<b>Mini-app:</b> a remote-desktop client with a request queue. <b>Handoff</b> (default): the viewer gets three quarters of the space because it is a live browser; zoom it (z) while you type a 2FA code. <b>Watch</b> pins a second viewer. <b>Manage</b> drops the viewer — and its stream — for profile and toolchain work.",
    },
    content: {
      title: "Content", key: "8", icon: "notebook", accent: "--pkg-content",
      description: "Vault documents, collections, files and Artifacts",
      attention: { n: 0, reasons: [] },
      presets: [
        { name: "Write", tree: R([T("content-documents", "content-library", "content-artifacts", "content-storage"), 0.26], ["content-editor", 0.4], ["content-preview", 0.34]) },
        { name: "Library", tree: R([C(["content-library", 0.6], ["content-artifacts", 0.4]), 0.56], [T("content-preview", "content-documents"), 0.44]) },
        { name: "Read", tree: R(["content-documents", 0.3], ["content-preview", 0.7]) },
      ],
      notes: "<b>Mini-app:</b> a notes app with a file browser. <b>Write</b> (default): a sources stack, the one Editor and a live Preview — the classic three-pane writing setup. <b>Library</b> is Finder-like. <b>Read</b> hides the editor entirely.",
    },
    brain: {
      title: "Brain", key: "n", icon: "brain", accent: "--pkg-brain",
      description: "Search and read collected research, submit material, and follow ingestion and sources",
      attention: { n: 3, reasons: ["2 jobs need a decision", "1 stale lease", "HN front page unhealthy"] },
      presets: [
        { name: "Research", tree: R(["brain-search", 0.33], ["brain-reader", 0.42], [T("brain-jobs", "brain-ingest", "brain-sources"), 0.25]) },
        { name: "Read", tree: R(["brain-search", 0.3], ["brain-reader", 0.7]) },
        { name: "Ingestion", tree: R(["brain-ingest", 0.26], ["brain-jobs", 0.44], ["brain-sources", 0.3]) },
      ],
      notes: "<b>Mini-app:</b> a search engine with a reader. <b>Research</b> (default) runs find → read, with the ingestion stack at hand. <b>Read</b> is for long documents. <b>Ingestion</b> is the operator’s view of the ledger and sources.",
    },
    scrape: {
      title: "Scrape", key: "0", icon: "globe", accent: "--pkg-scrape",
      description: "Extraction, feeds, presets and their health, and the scrape-to-file queue",
      attention: { n: 1, reasons: ["scrape reconnecting"] },
      presets: [
        { name: "Workbench", tree: R([T("scrape-extract", "scrape-feeds", "scrape-convert"), 0.54], [C(["scrape-queue", 0.5], [T("scrape-presets", "scrape-checks", "scrape-status"), 0.5]), 0.46]) },
        { name: "Health", tree: C([R(["scrape-presets", 0.5], ["scrape-checks", 0.5]), 0.62], [R(["scrape-status", 0.5], ["scrape-queue", 0.5]), 0.38]) },
      ],
      notes: "<b>Mini-app:</b> a request workbench (think Postman for URLs). <b>Workbench</b> (default): the three tools share one large tabbed pane; queue and preset health stay visible. <b>Health</b> is a 2×2 dashboard for preset drift and canaries.",
    },
    proc: {
      title: "Proc", key: "p", icon: "clock", accent: "--pkg-proc",
      description: "What agents scheduled and ran on this machine, and what it printed",
      attention: { n: 2, reasons: ["cleanup.sh is unattributed", "brain-sync’s latest execution failed"] },
      presets: [
        { name: "Runs", tree: C([R([T("proc-runs", "proc-schedules"), 0.27], ["proc-run", 0.45], ["proc-schedule", 0.28]), 0.66], ["proc-timeline", 0.34]) },
        { name: "Schedules", tree: C([R(["proc-schedules", 0.34], ["proc-schedule", 0.66]), 0.6], ["proc-timeline", 0.4]) },
        { name: "Logs", tree: R(["proc-runs", 0.24], ["proc-run", 0.38], ["proc-run:r-9030", 0.38]) },
      ],
      notes: "<b>Mini-app:</b> a cron dashboard with a log viewer. <b>Runs</b> (default): lists, a wide log and the schedule definition, over a full-width Timeline — the gantt finally gets the width it was designed for. <b>Schedules</b> reviews definitions against history. <b>Logs</b> tiles two run logs, like two tmux panes tailing output.",
    },
    source: {
      title: "Source", key: "s", icon: "tower", accent: "--pkg-source",
      description: "Signed webhook receivers, the deliveries that arrived and their original payloads",
      attention: { n: 0, reasons: [] },
      presets: [
        { name: "Ledger", tree: R([T("source-receivers", "source-catalog"), 0.25], ["source-deliveries", 0.37], ["source-delivery", 0.38]) },
        { name: "Watches", tree: R(["source-watches", 0.42], [T("source-delivery", "source-deliveries"), 0.58]) },
        { name: "Setup", tree: R(["source-receivers", 0.55], ["source-catalog", 0.45]) },
      ],
      notes: "<b>Mini-app:</b> a webhook inspector. <b>Ledger</b> (default): where deliveries come from, what arrived, the one selected — evidence first, as ADR 0164 intended, now all on screen at once. <b>Watches</b> pairs a watch inbox with the delivery it points at. <b>Setup</b> is the local operator’s receiver work.",
    },
    system: {
      title: "System", key: "4", icon: "cpu", accent: "--pkg-server",
      description: "Server and Stack settings, processes, packages, host resources, owner state, subscriptions and activity",
      attention: { n: 2, reasons: ["hypeman stopped", "scrape reconnecting"] },
      presets: [
        { name: "Health", tree: R([C(["server", 0.56], ["packages", 0.44]), 0.27], [C(["resources", 0.54], ["processes", 0.46]), 0.43], [C([T("activity", "sampling", "host"), 0.5], [T("access", "state", "subscriptions", "codex-tools", "xcom-state", "developer"), 0.5]), 0.3]) },
        { name: "Admin", tree: R(["access", 0.34], ["state", 0.33], [C(["subscriptions", 0.6], [T("codex-tools", "xcom-state", "developer"), 0.4]), 0.33]) },
        { name: "Monitor", tree: C([R(["server", 1], ["resources", 1.4], ["host", 1]), 0.5], [R(["processes", 1.4], ["sampling", 1], ["activity", 1]), 0.5]) },
      ],
      notes: "<b>Mini-app:</b> Activity Monitor plus settings. Thirteen windows never fit one screen, so stacks do the work. <b>Health</b> (default) keeps live vitals visible and tucks admin panes into one tabbed stack. <b>Admin</b> is Access, State and Subscriptions side by side. <b>Monitor</b> is tmux’s tiled layout: six live panes, nothing hidden.",
    },
    lab: {
      title: "Lab", key: "3", icon: "flask", accent: "--pkg-events",
      description: "Experimental windows for tinkering",
      attention: { n: 0, reasons: [] },
      presets: [
        { name: "Bench", tree: R(["call-speech", 0.4], ["inference", 0.6]) },
        { name: "Inference", tree: C(["inference", 0.7], ["call-speech", 0.3]) },
      ],
      notes: "<b>Mini-app:</b> a scratch bench. Two experiments side by side; new experiments arrive as panes in the same layout without a new space.",
    },
  };

  /* Every space's full pane inventory, so closed panes can be reopened from the picker. */
  window.SPACE_PANES = {};
  for (const [id, sp] of Object.entries(SPACES)) {
    const seen = new Set();
    const walk = (n) => (n.t === "stack" ? n.p.forEach((p) => seen.add(p)) : n.c.forEach((c) => walk(c.n)));
    sp.presets.forEach((p) => walk(p.tree));
    SPACE_PANES[id] = [...seen];
  }
  window.SPACE_ORDER = GROUPS.flatMap((g) => g.spaces);
  window.TREE = { R, C, T };
})();
