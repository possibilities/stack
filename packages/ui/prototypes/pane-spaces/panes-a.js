/* PROTOTYPE — pane renderers, part A. One entry per existing WindowDef; bodies are synthetic. */
window.PANES = window.PANES || {};
(() => {
  const P = window.PANES, { chip, dot, sec, kv, btn, input, meter, sw, orb, esc } = H;
  const pri = (p) => (p === "urgent" ? chip("Urgent", { cls: "bad" }) : p === "high" ? chip("High", { cls: "warn" }) : "");
  const att = (a) => (a === "human" ? `<span title="Marked for a human" class="muted">${I("hand")}</span>` : a === "agent" ? `<span title="Marked for an agent" class="muted">${I("bot")}</span>` : "");
  const sel = (key, val, cur) => `data-sel="${key}=${val}" data-row="${val}" class="r click ${cur === val ? "sel" : ""}"`;

  /* ───────── HUD ───────── */
  P["hud-attention"] = {
    title: "Needs attention", icon: "hand", count: () => 7,
    body: ({ S }) => {
      const groups = [["For you", "human"], ["In review", "review"], ["Blocked", "blocked"], ["For agents", "agent"], ["Waiting", "waiting"]];
      return `<div class="lanes adapt">${groups.map(([label, k]) => `<div class="lane-col">${sec(label, D.attention[k].length)}${D.attention[k].map((it) => `
        <div ${sel("hud.item", it.id, S.sel["hud.item"])}><div class="lead">${H.workState(D.work.find((w) => w.id === it.id).state)}</div>
        <div class="grow"><div class="t">${esc(it.title)}</div><div class="s">${esc(it.why)}</div></div>${pri(it.pri)}</div>`).join("")}</div>`).join("")}</div>
        ${sec("Recent results and decisions")}${D.attention.recent.map((n) => `<div class="r compact ${n.old ? "dim" : ""}">${chip(n.tag, { cls: n.tag === "Decision" ? "solid" : "" })}<div class="grow"><div class="t">${esc(n.text)}</div><div class="s">${n.who}${n.old ? " · earlier scope" : ""}</div></div><span class="m">${n.at}</span></div>`).join("")}`;
    },
  };
  P["hud-work"] = {
    title: "Work", icon: "tree", count: () => 11, views: ["Open", "Needs a look", "All"], actions: ["search", "filter"],
    foot: () => `<button class="fbtn">${I("plus")} New work item</button><span class="fresh">1 completed row hidden by Open</span>`,
    body: ({ S }) => D.work.filter((w) => w.state !== "completed").map((w) => `
      <div ${sel("hud.item", w.id, S.sel["hud.item"])} style="--d:${w.depth}"><span class="tree-i"></span><div class="lead">${H.workState(w.state)}</div>
      <div class="grow"><div class="t" style="display:flex;gap:6px;align-items:center">${esc(w.title)} ${w.kids ? `<span class="muted num" style="font-weight:400;font-size:11.5px">${w.open}/${w.kids}</span>` : ""}</div>
      <div class="s">${H.word(w.state)}${w.next ? ` · ${esc(w.next)}` : ""}${w.deps ? ` · <span style="color:var(--destructive)">${w.deps} unmet dependency</span>` : ""}</div></div>
      <div style="display:flex;gap:6px;align-items:center">${pri(w.pri)}${att(w.att)}</div></div>`).join(""),
  };
  P["hud-item"] = {
    title: "Work item", icon: "file", rec: ({ S }) => D.work.find((w) => w.id === S.sel["hud.item"])?.title, node: "work-item", actions: ["focus"],
    foot: () => `<button class="fbtn">${I("plus")} Add a child</button><span class="fresh">rev ${D.item.rev} · scope ${D.item.scope}</span>`,
    body: ({ S }) => {
      const w = D.work.find((x) => x.id === S.sel["hud.item"]) || D.work[1], it = w.id === "w2" ? D.item : { ...D.item, title: w.title, state: w.state, pri: w.pri, next: w.next || "No next action recorded", objective: "Objective for “" + w.title + "”.", summary: "No summary yet", links: [], labels: [] };
      return `<div class="pad stack-v" style="gap:12px">
        <div class="muted" style="font-size:12px">${esc(it.parent)} › <span class="num">${it.order}</span></div>
        <div style="font-size:17px;font-weight:600;letter-spacing:-0.02em;line-height:1.3">${esc(it.title)}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${chip(H.workState(it.state) + H.word(it.state) + " " + I("down"))}${chip((it.pri === "high" ? "High" : H.word(it.pri)) + " " + I("down"))}${chip(I("hand") + " For a human " + I("down"))}</div></div>
        ${sec("Objective")}<div class="pad" style="padding-top:0">${esc(it.objective)}</div>
        ${sec("Next action")}<div class="pad" style="padding-top:0;font-weight:500">${esc(it.next)}</div>
        ${sec("Summary")}<div class="pad muted" style="padding-top:0">${esc(it.summary)}</div>
        ${sec("Readiness")}${kv([["Children", "None"], ["Dependencies", "None"], ["Blocks", `<span class="goto" data-sel="hud.item=w4">Port Fleet and Workers to panes</span>`]])}
        ${sec("Links", it.links.length, `<span class="goto">${I("plus")} Add</span>`)}<div class="pad" style="padding-top:0;display:flex;gap:6px;flex-wrap:wrap">${it.links.map((l) => chip(`<span class="muted">${l.rel}</span> ${esc(l.label)}`, { go: l.kind === "bot" ? "fleet|bots|fleet.bot=bot-1" : l.kind === "worker" ? "workers|worker|workers.sel=7f3a" : "content|content-artifacts|", title: l.label })).join("") || '<span class="muted">No links.</span>'}</div>
        ${sec("Labels")}<div class="pad" style="padding-top:0;display:flex;gap:6px">${it.labels.map((l) => chip(l)).join("") || '<span class="muted">No labels.</span>'}</div>
        ${sec("Record")}${kv([["Revision", it.rev], ["Scope revision", it.scope], ["Created", it.created], ["Last edited", it.edited], ["ID", `<span class="mono">83cc2bc0</span>`]])}
        <div class="pad"><div class="r" style="border:1px dashed var(--border);border-radius:9px"><span class="muted">{ }</span><div class="grow">Agent metadata</div><span class="m">read only when open</span></div></div>`;
    },
  };
  P["hud-timeline"] = {
    title: "Timeline", icon: "history", count: () => D.timeline.length,
    foot: () => `<button class="fbtn">${I("plus")} Add note</button><span class="seg" style="height:24px;margin-left:auto"><button aria-pressed="true" style="height:20px">Result</button><button style="height:20px">Decision</button><button style="height:20px">Handoff</button></span>`,
    body: () => D.timeline.map((e) => `<div class="r ${e.scope ? "dim" : ""}"><div class="lead muted">${I(e.kind === "note" ? "pen" : e.kind === "focus" ? "eye" : "history")}</div><div class="grow">
      <div class="t" style="font-weight:${e.kind === "note" ? 500 : 400}">${e.tag ? chip(e.tag, { cls: e.tag === "Decision" ? "solid" : "" }) + " " : ""}${esc(e.text)}</div>
      ${e.before ? `<div class="s"><s>${esc(e.before)}</s> → ${esc(e.after)}</div>` : ""}<div class="s">${e.who}${e.scope ? " · recorded for scope 2" : ""}</div></div><span class="m">${e.at}</span></div>`).join(""),
  };
  P["hud-resources"] = {
    title: "Resources", icon: "network",
    body: () => `${sec("Declared")}${D.item.links.map((l) => `<div class="r compact"><span class="chip" style="min-width:76px;justify-content:center">${l.rel}</span><div class="grow t"><span class="goto" data-goto="${l.kind === "bot" ? "fleet|bots|fleet.bot=bot-1" : l.kind === "worker" ? "workers|worker|workers.sel=7f3a" : "content|content-artifacts|"}">${esc(l.label)}</span></div><span class="m">${l.kind}</span></div>`).join("")}
      ${sec("Chat focus", null, "a saved selection, not liveness")}<div class="r compact"><div class="tile-n">1${dot("ok")}</div><div class="grow"><div class="t">bot-1 · main chat</div><div class="s">Focused on this item · 40m ago</div></div>${btn("Clear", { sm: true })}</div>
      <div class="pad">${btn("Focus bot-2’s main chat here", { sm: true, icon: "eye" })}</div>
      ${sec("Captured Worker turns")}<div class="r compact click" data-goto="workers|worker|workers.sel=7f3a"><div class="lead">${dot("ok pulse")}</div><div class="grow"><div class="t mono">stack · 7f3a</div><div class="s">turn 3 · running · latest · turns 1–2 completed</div></div><span class="m">${I("right")}</span></div>
      <div class="r compact"><div class="lead">${dot()}</div><div class="grow"><div class="t mono">stack · a811</div><div class="s">turn 2 on this item · its latest turn is on other work</div></div><span class="m">34m</span></div>
      <div class="pad muted" style="font-size:12px">Account usage and process resources belong to their owners and are never split per item.</div>`,
  };

  /* ───────── Fleet ───────── */
  const botRow = (b, cur) => `<div ${sel("fleet.bot", b.id, cur)}><div class="tile-n">${b.id.split("-")[1]}${dot(b.state === "running" ? "ok" : "ring")}</div>
    <div class="grow"><div class="t" style="display:flex;gap:8px;align-items:center"><span class="mono" style="font-weight:600">${b.id}</span><span class="st muted">${b.state}</span>${b.onCall ? chip(I("phone") + "On call", { cls: "ok" }) : ""}${b.handoff ? chip(I("life") + "Handoff waiting", { cls: "warn", go: "browse|browse-handoffs|browse.handoff=h-0c1f" }) : ""}</div>
    <div class="s" style="display:flex;gap:6px;align-items:center">${orb(b.account)}<span class="goto" data-goto="accounts|accounts|accounts.sel=${b.account}">${b.account}</span></div>
    <div class="meta">${chip(I("sparkles") + `${b.model} · ${b.effort}`)}${chip(I("folder") + b.cwd, { mono: true })}${chip(I("msgs") + b.thread, { mono: true })}${b.workers ? chip(`${b.workers} workers`, { go: "workers|workers|" }) : ""}${b.schedules ? chip(`${b.schedules} schedules`, { go: "proc|proc-schedules|" }) : ""}</div>
    <div class="meta" style="margin-top:8px">${btn(b.state === "running" ? "Stop…" : "Start…", { sm: true, icon: b.state === "running" ? "stop" : "play" })}${btn("Chat", { sm: true, icon: "term" })}${b.state === "running" ? btn("Call", { sm: true, icon: "phone" }) : ""}${btn("Tools", { sm: true, icon: "wrench" })}<button class="ib" aria-label="More">${I("more")}</button></div></div></div>`;
  P["bots"] = {
    title: "Bots", icon: "bot", count: () => D.bots.length, actions: ["settings"],
    foot: () => `<button class="fbtn">${I("plus")} Create Bot</button>`,
    body: ({ S }) => D.bots.map((b) => botRow(b, S.sel["fleet.bot"])).join(""),
  };
  P["bot-state"] = {
    title: "Bot state", icon: "hdd", rec: () => "bot-1", views: ["Overview", "Workspace", "Conversation", "Queue", "Uploads", "Launch", "Log", "Recovery"],
    body: () => `<div class="toolbar">${chip("bot-1 " + I("down"), { cls: "link" })}<span class="muted" style="font-size:12px">incarnation 9e41 · generation 3</span></div>
      ${sec("Stored categories")}${[["Workspace", "~/code/stack · external", "read only"], ["Conversation", "3 generations", "412 KB"], ["Queue", "2 receipts", "content-free"], ["Uploads", "4 files", "18 MB"], ["Launch", "digest 7c1e…", "values hidden"], ["Log", "rev 1882", "2.1 MB"]].map(([a, b, c]) => `<div class="r compact"><div class="grow"><div class="t">${a}</div><div class="s">${b}</div></div><span class="m">${c}</span></div>`).join("")}
      ${sec("Cleanup blockers")}<div class="r compact"><span class="lead">${dot("warn")}</span><div class="grow"><div class="t">3 open Workers</div><div class="s">Resolve in <span class="goto" data-goto="workers|workers|">Workers</span>; nothing closes implicitly</div></div></div><div class="r compact"><span class="lead">${dot("warn")}</span><div class="grow"><div class="t">2 Proc schedules</div><div class="s"><span class="goto" data-goto="proc|proc-schedules|">Proc schedules</span></div></div></div>`,
  };
  const chatBody = (botId) => {
    const c = D.chats[botId]; if (!c.turns.length) return `<div class="empty"><div><b>${botId} is stopped</b>Start it from Bots to read its main thread.</div></div>`;
    return `<div class="pane-body" style="flex:1"><div class="tx">${c.turns.map((t) => `<div class="you">${esc(t.you)}</div><div class="ai">${t.reply.map((p) => p.startsWith("```") ? `<pre>${esc(p.replace(/```\w*\n?/g, ""))}</pre>` : `<p>${H.md(p).replace(/^<p>|<\/p>$/g, "")}</p>`).join("")}${t.streaming ? '<span class="cursor"></span>' : ""}</div>${t.dur ? `<div class="done">▣ ${t.dur} · ${t.at}</div>` : ""}`).join("")}</div></div>
      <div class="txstatus">${dot(botId === "bot-1" ? "ok pulse" : "warn")}<span class="grow trunc">${esc(c.status)}</span><span>follows end</span></div>
      <div class="composer"><span>Message ${botId}…</span><span class="kbd">⏎</span></div>`;
  };
  P["chat"] = {
    title: "Chat", icon: "term", flush: true, actions: ["newpane", "pin"],
    rec: ({ S, inst }) => (inst || S.sel["fleet.bot"]) + " ▾",
    body: ({ S, inst }) => chatBody(inst || S.sel["fleet.bot"]),
  };

  /* ───────── Accounts ───────── */
  P["accounts"] = {
    title: "Accounts", icon: "key", count: () => D.accounts.length,
    foot: () => `<button class="fbtn">${I("plus")} Add account ${I("down")}</button>`,
    body: ({ S }) => {
      const row = (a) => `<div ${sel("accounts.sel", a.id, S.sel["accounts.sel"])}>${orb(a.id)}<div class="grow"><div class="t mono" style="font-size:12px">${a.label}</div><div class="s">${a.kind === "bot" ? "Bot account" : "Worker account"}${a.bots ? ` · used by ${a.bots.map((b) => `<span class="goto" data-goto="fleet|bots|fleet.bot=${b}">${b}</span>`).join(", ")}` : ""}</div></div>${a.ready ? chip("Ready", { cls: "ok" }) : chip("Needs sign-in", { cls: "warn" })}<button class="ib" aria-label="More">${I("more")}</button></div>`;
      const codex = D.accounts.filter((a) => a.provider === "codex" && a.kind === "bot");
      return `${sec("Codex", 4)}${codex.map((a) => `<div style="margin:0 8px 8px;border:1px solid var(--line);border-radius:10px;overflow:hidden">${row(a)}${row(D.accounts.find((w) => w.id === a.pair))}</div>`).join("")}
        ${sec("Claude", 1)}${row(D.accounts.find((a) => a.provider === "claude"))}${sec("Devin", 1)}${row(D.accounts.find((a) => a.provider === "devin"))}
        <div class="banner warn">${I("alert")}<div><b>codex-worker-account-2 needs sign-in.</b><div class="acts">${btn("Sign in", { sm: true, primary: true })}</div></div></div>`;
    },
  };
  P["usage"] = {
    title: "Usage", icon: "gauge", count: () => D.usage.length, actions: ["refresh"],
    foot: () => `<button class="fbtn">Clear local measurements…</button><span class="fresh">Read 2m ago</span>`,
    body: () => `<div class="two-col">${D.usage.map((u) => `<div class="pad" style="border-bottom:1px solid var(--line)"><div style="display:flex;align-items:center;gap:8px">${orb(u.id)}<span class="mono trunc" style="font-size:12px;font-weight:500">${u.id}</span>${chip(u.plan)}<b style="margin-left:auto;font-size:16px" class="num">${u.windows[0].left}%</b></div>
      ${u.windows.map((w) => `<div style="display:grid;grid-template-columns:56px 1fr 36px 78px;gap:8px;align-items:center;margin-top:8px;font-size:12px"><span class="muted">${w.label}</span>${meter(w.left)}<span class="num">${w.left}%</span><span class="muted num" style="text-align:right">${w.resets}</span></div>`).join("")}
      ${u.credits || u.warn ? `<div class="s muted" style="margin-top:6px;font-size:12px">${u.credits || ""}${u.warn ? chip(u.warn, { cls: "warn" }) : ""}</div>` : ""}</div>`).join("")}</div>`,
  };
  P["model-catalogs"] = {
    title: "Models", icon: "tree", count: () => 4,
    body: () => `<div class="toolbar"><div class="filterchips">${["codex-worker-account-1 · 5", "claude-worker-account-1 · 4", "devin-worker-account-1 · 2"].map((t, i) => chip(t, { cls: i === 0 ? "solid" : "link" })).join("")}</div></div>
      <div class="pad" style="padding-bottom:4px">${input("Filter models")}</div><div class="pad muted" style="font-size:12px;padding-top:4px">observed just now · OpenCode 1.4.2</div>
      ${D.models.map((m) => `<div class="r compact"><div class="grow t mono" style="font-size:12px">${m.name}</div><span style="display:flex;gap:2px;align-items:flex-end;height:14px" title="${m.efforts.join(", ")}">${["low", "medium", "high", "xhigh", "max", "ultra"].map((e, i) => `<i style="width:4px;height:${5 + i * 2}px;border-radius:1px;background:${m.efforts.includes(e) ? "var(--accent)" : "color-mix(in oklab, var(--foreground) 10%, transparent)"}"></i>`).join("")}</span><span class="m">${m.efforts.length} efforts</span></div>`).join("")}`,
  };

  /* ───────── Lab ───────── */
  P["call-speech"] = {
    title: "Call speech", icon: "megaphone",
    body: () => `${sec("Open call")}${kv([["Bot", '<span class="goto" data-goto="fleet|bots|fleet.bot=bot-1">bot-1</span>'], ["Call", '<span class="mono">call_7f19</span>'], ["Thread", '<span class="mono">019a2c4e</span>'], ["State", `${dot("ok")} Connected · 02:14`]])}
      <div class="pad stack-v"><div class="textarea">Say on the call…</div><div style="display:flex;justify-content:space-between;align-items:center"><span class="muted" style="font-size:12px">⏎ sends once · ⇧⏎ new line</span>${btn("Speak", { primary: true, icon: "send", sm: true })}</div></div>
      ${sec("Submitted", 2, "accepted, not heard")}<div class="r compact click"><div class="grow">“The pane prototype is ready for review.”</div><span class="m">1m</span></div><div class="r compact click"><div class="grow">“I’ll start on Fleet after lunch.”</div><span class="m">12m</span></div>`,
  };
  P["inference"] = {
    title: "Inference", icon: "sparkles", count: () => 14,
    body: () => `<div class="pad stack-v"><div class="grid2">${chip("codex-bot-account-1 " + I("down"), { cls: "link" })}${chip("gpt-5.6-luna · low " + I("down"), { cls: "link" })}</div><div class="textarea" style="min-height:90px">Summarize the difference between a split tree and a scrolling strip in two sentences.</div><div style="display:flex;justify-content:flex-end">${btn("Submit", { primary: true, sm: true })}</div></div>
      ${sec("Requests", 14)}${[["completed", "gpt-5.6-luna · low", "1.2s", "1m"], ["running", "gpt-6-sol · medium", "—", "now"], ["unknown", "gpt-5.6-luna · low", "—", "22m"], ["completed", "gpt-5.6-terra · low", "3.4s", "1h"], ["failed", "gpt-5.5 · low", "30s", "2h"]].map(([s, m, d, a]) => `<div class="r compact click"><span class="lead">${dot(H.phaseTone(s))}</span><div class="grow"><div class="t">${H.word(s)}</div><div class="s mono">${m}</div></div><span class="m">${d} · ${a}</span></div>`).join("")}`,
  };

  /* ───────── System ───────── */
  const sys = D.system;
  P["server"] = {
    title: "Server", icon: "cpu", node: "server",
    body: () => `<div class="stats"><div class="stat"><b>${sys.server.children.filter((c) => c[1]).length}/${sys.server.children.length}</b><span>children running</span></div><div class="stat"><b>${sys.server.uptime}</b><span>uptime</span></div></div>
      ${kv([["PID", `<span class="mono">${sys.server.pid}</span>`], ["Runtime", `<span class="mono">${sys.server.node}</span>`], ["Version", sys.server.version], ["Started", sys.server.started]])}
      ${sec("Children")}${sys.server.children.map(([n, r, pid]) => `<div class="r compact">${dot(r ? "ok" : "bad")}<div class="grow t">${n}</div><span class="m mono">${pid || "stopped"}</span></div>`).join("")}
      ${sec("Stack settings")}<div class="r"><div class="grow"><div class="t">Developer mode</div><div class="s">Developer tools and upstream harness releases</div></div>${sw(true)}</div>`,
  };
  P["packages"] = {
    title: "Packages", icon: "package", count: () => sys.packages.length,
    body: () => sys.packages.map(([n, ops, ch]) => `<div class="r compact">${dot(ch === "open" ? "ok" : "bad")}<div class="grow t mono" style="font-size:12px">${n}</div>${ch !== "open" ? chip("Reconnecting", { cls: "bad" }) : `<span class="m">${ops} ops</span>`}${chip("WS", { mono: true })}${chip("MCP", { mono: true })}</div>`).join(""),
  };
  P["resources"] = {
    title: "Resources", icon: "chart", views: ["Components", "Bots", "Accounts", "Runtimes"],
    body: () => `<div class="stats"><div class="stat"><b>24%</b><span>Stack CPU</span></div><div class="stat"><b>2.6 GB</b><span>Stack RSS</span></div><div class="stat"><b>5s</b><span>sampling</span></div></div>
      <div class="pad" style="padding-top:2px"><div class="legend"><span>CPU · last 2 min</span><span style="margin-left:auto">read just now</span></div>${H.spark(sys.cpu, { zero: true })}<div class="legend" style="margin-top:6px"><span>RSS</span></div>${H.spark(sys.rss, { color: "var(--pkg-codex)" })}</div>
      ${sec("Scopes", null, "overlapping; never summed")}${sys.scopes.map(([n, c, m]) => `<div class="r compact"><div class="grow t">${n}</div><span style="width:90px;display:flex">${meter(100 - c * 2)}</span><span class="m">${c}% · ${m}</span></div>`).join("")}`,
  };
  P["host"] = { title: "Host", icon: "server",
    body: () => `${kv([["Hostname", "studio.local"], ["Arch", "arm64 · Darwin 25.5.0"], ["CPU", "Apple M4 Max · 16 cores"], ["Uptime", "11d 2h"], ["Load", '<span class="num">3.12 2.84 2.40</span>']])}<div class="pad"><div class="legend"><span>Memory</span><span style="margin-left:auto" class="num">41.2 / 64 GB</span></div><div style="margin-top:6px;display:flex">${meter(36)}</div></div>` };
  P["codex-tools"] = { title: "Codex tools", icon: "wrench", actions: ["refresh"],
    body: () => sec("Connections") + [["codex-browser", "available"], ["codex-computer-use", "available"], ["codex-image", "available"], ["codex-search", "unavailable", "not offered by this account"], ["codex-files", "available"]].map(([n, s, w]) => `<div class="r compact">${dot(s === "available" ? "ok" : "ring")}<div class="grow"><div class="t mono" style="font-size:12px">${n}</div>${w ? `<div class="s">${w}</div>` : ""}</div><span class="m">${s}</span></div>`).join("") };
  P["processes"] = { title: "Processes", icon: "tree", count: () => sys.procs.length, actions: ["search"],
    body: () => `<div class="r compact muted" style="font-size:11px;letter-spacing:.06em;text-transform:uppercase"><div class="grow">Process</div><span style="width:56px;text-align:right">PID</span><span style="width:44px;text-align:right">CPU</span><span style="width:64px;text-align:right">RSS</span></div>${sys.procs.map(([d, n, pid, c, m]) => `<div class="r compact" style="--d:${d}"><span class="tree-i"></span><div class="grow t mono trunc" style="font-size:12px">${n}</div><span class="mono muted" style="width:56px;text-align:right;font-size:11.5px">${pid}</span><span class="num" style="width:44px;text-align:right;font-size:12px">${c}%</span><span class="num muted" style="width:64px;text-align:right;font-size:12px">${m}</span></div>`).join("")}` };
  P["sampling"] = { title: "Sampling", icon: "scan",
    body: () => `${kv([["Source", "ps + proc_pidinfo"], ["Interval", "5s"], ["Stale after", "15s"], ["Last collection", "1s ago"], ["Retention", "2h · 1,440 samples"]])}${sec("Attempts")}<div class="pad" style="padding-top:0"><span class="strip">${"cccccccccccccccccccccccxc".split("").map((c) => `<i class="${c === "x" ? "x" : ""}"></i>`).join("")}</span></div>${sec("Capabilities")}<div class="pad" style="padding-top:0;display:flex;gap:4px;flex-wrap:wrap">${["RSS", "CPU time", "CPU%", "Threads"].map((c) => chip(c, { cls: "ok" })).join("")}${["GPU", "Disk I/O"].map((c) => chip(c + " unavailable")).join("")}</div>` };
  P["activity"] = { title: "Activity", icon: "activity", count: () => sys.activity.length, actions: ["filter"],
    body: () => sys.activity.map(([t, p, e]) => `<div class="r compact"><span class="mono muted" style="font-size:11.5px">${t}</span>${chip(p)}<div class="grow mono trunc" style="font-size:12px">${e}</div></div>`).join("") };
  P["state"] = { title: "State", icon: "db", count: () => 5, actions: ["refresh"],
    body: () => `<div class="toolbar">${chip("All owners " + I("down"), { cls: "link" })}${chip("All kinds " + I("down"), { cls: "link" })}<span style="margin-left:auto;display:flex;gap:6px;align-items:center;font-size:12px" class="muted">Measure ${sw(false)}</span></div>
      ${[["auth", "2 loaded", "ok"], ["bots", "2 loaded · 1 issue", "warn"], ["serve", "1 loaded", "ok"], ["usage", "0 loaded", "ok"], ["xcom", "unavailable", "bad"]].map(([o, s, t]) => `<div class="r">${dot(t)}<div class="grow"><div class="t mono" style="font-size:12px">${o}</div><div class="s">${s}${t === "bad" ? " · a gap, not an empty store" : ""}</div></div><span class="m goto">Open owner</span></div>`).join("")}` };
  P["subscriptions"] = { title: "Subscriptions", icon: "cable", views: ["Watches", "Occurrences", "History"], actions: ["refresh"],
    body: () => [["brain.jobs_changed", "ingest", "error", "alpha thread 019a2c4e · never delivered"], ["hud.hud_changed", "work_tree", "active", "alpha thread 019a31f0 · delivered 1m ago"], ["source.watch:wt-1", "github_watch_read", "active", "bot-1 · delivered 22m ago"]].map(([t, r, s, d]) => `<div class="r">${dot(s === "active" ? "ok" : "bad")}<div class="grow"><div class="t mono" style="font-size:12px">${t}</div><div class="s">${r} · ${d}</div><div class="meta">${btn("Reveal arguments", { sm: true, icon: "eye" })}${btn("Remove…", { sm: true, danger: true })}</div></div><span class="m">rev 1</span></div>`).join("") };
  P["access"] = { title: "Access", icon: "lock", count: () => 3,
    body: () => `${sec("Ingress")}${kv([["UI origin", '<span class="mono">https://studio.tail9.ts.net</span>'], ["Pairing", "manual · QR"]])}
      ${sec("Clients", 3)}${[["Pixel 9", "phone", "ui:view · brain:share", "2m"], ["Chrome · laptop", "extension", "brain:share", "1h"], ["Desk", "desktop", "ui:control", "Thu"]].map(([n, k, s, a]) => `<div class="r compact">${I(k === "phone" ? "monitor" : "monitor", "muted")}<div class="grow"><div class="t">${n}</div><div class="s">${s}</div></div><span class="m">${a}</span></div>`).join("")}
      ${sec("Remote UI sessions", 1)}<div class="r compact">${dot("ok")}<div class="grow"><div class="t">Desk · ui:control</div><div class="s">expires in 3m · refresh lineage 4</div></div>${btn("Revoke", { sm: true, danger: true })}</div>
      ${sec("Manual pairing approvals")}<div class="pad muted" style="padding-top:0">None waiting.</div>` };
  P["xcom-state"] = { title: "Xcom", icon: "archive", views: ["Posts", "Article attempts", "Checkpoint"],
    body: () => `${kv([["Archive", "1,284 posts"], ["Following", "212 accounts"], ["Checkpoint", "Oct 10 14:02"]])}${sec("Clear archive data")}<div class="pad muted" style="padding-top:0">Select what to clear, then prepare a plan. Nothing is cleared until you apply it.</div>` };
  P["developer"] = { title: "Developer", icon: "hammer", actions: ["refresh"],
    body: () => `${sec("Harness releases")}${[["OpenCode", "—", "Not checked"], ["Codex", "0.50.0", "Observed"], ["Claude Code", "2.8.14", "Changed upstream"], ["Devin CLI", "—", "Failed"]].map(([n, v, s]) => `<div class="r compact">${dot(s === "Observed" ? "ok" : s === "Failed" ? "bad" : s === "Changed upstream" ? "acc" : "ring")}<div class="grow t">${n}</div><span class="mono muted" style="font-size:11.5px">${v}</span><span class="m">${s}</span></div>`).join("")}<div class="pad muted" style="font-size:12px">Checks every 6 h · next in 4h</div>` };

  /* ───────── Roles ───────── */
  const R = D.roles;
  P["role-catalog"] = {
    title: "Roles", icon: "users", count: () => R.list.length,
    foot: () => `<button class="fbtn">${I("plus")} Create role</button>`,
    body: ({ S }) => R.list.map((r) => `<div ${sel("roles.role", r.name, S.sel["roles.role"])}><div class="grow"><div class="t" style="display:flex;gap:6px;align-items:center">${r.name}${r.def ? chip("Default", { cls: "solid" }) : ""}${r.fixed ? chip("Worker Role") : ""}</div><div class="s">rev ${r.rev}${r.bots ? ` · ${r.bots} Bot${r.bots > 1 ? "s" : ""} launched` : ""}${r.workers ? ` · ${r.workers} Workers` : ""}</div></div></div>`).join(""),
  };
  P["role-instructions"] = {
    title: "Instructions", icon: "scroll", count: () => 7, actions: ["search"],
    foot: () => `<button class="fbtn">${I("plus")} New fragment</button><button class="fbtn">${I("plus")} New category</button>`,
    body: ({ S }) => R.categories.map((c) => `<div class="sec" style="padding-top:14px">${sw(c.on)}<span style="margin-left:4px">${c.name}</span><span class="aside num">${c.frags.reduce((n, f) => n + f[2], 0)} tok</span></div>
      ${c.frags.map(([t, on, tok, draft]) => `<div ${sel("roles.rec", t, S.sel["roles.rec"])} style="${!on || !c.on ? "opacity:.55" : ""}">${sw(on)}<div class="grow"><div class="t">${t}${draft ? ` <span class="dot acc" title="Unsaved draft"></span>` : ""}</div><div class="s">${!c.on ? "Category off" : on ? "Renders" : "Off"}</div></div><span class="m num">${tok} tok</span></div>`).join("")}`).join(""),
  };
  P["role-editor"] = {
    title: "Editor", icon: "pen", rec: ({ S }) => S.sel["roles.rec"],
    foot: () => `${btn("Save", { primary: true, sm: true })}${btn("Discard draft", { sm: true })}<span class="fresh">Draft · started from rev 14</span>`,
    body: ({ S }) => `<div class="pad stack-v" style="gap:10px"><label style="font-size:12px" class="muted">Title</label>${input("Title", "", S.sel["roles.rec"])}
      <label style="font-size:12px" class="muted">Category</label><div>${chip("Working " + I("down"), { cls: "link" })} ${chip("Condition: always " + I("down"), { cls: "link" })}</div>
      <label style="font-size:12px" class="muted">Text Bots receive</label><div class="code" style="min-height:220px">Author every repository change in a task-owned worktree on a task branch, including small fixes, documentation, prompts, configuration, and generated files.

Do not author changes in the canonical checkout or directly on main. A clean checkout does not grant an exception.<span class="cursor"></span></div>
      <div class="muted" style="font-size:12px">410 tokens · reaches later launches only</div></div>`,
  };
  P["role-preview"] = {
    title: "Preview", icon: "file", views: ["Instructions", "Launch"],
    body: () => `<div class="pad"><div class="legend"><span>2,690 of 12,000 tokens</span></div><div style="display:flex;margin-top:6px">${meter(78)}</div></div>
      <div class="pad" style="padding-top:0">${R.categories.filter((c) => c.on).map((c) => c.frags.filter((f) => f[1]).map(([t, , tok]) => `<div style="border-left:2px solid color-mix(in oklab, var(--accent) 50%, transparent);padding:4px 0 6px 10px;margin-bottom:8px"><div class="muted" style="font-size:11px;font-weight:600">${c.name} › ${t} · ${tok} tok</div><div class="mono" style="font-size:11.5px;color:var(--muted-foreground);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t === "Who you are" ? "You are a Bot in the Stack fleet, working with the operator…" : "…"}</div></div>`).join("")).join("")}</div>
      ${sec("Launched")}${[["bot-1", "Default r14", "current"], ["bot-2", "Default r14", "current"], ["bot-3", "Researcher r3", "another Role"]].map(([b, r, s]) => `<div class="r compact"><span class="mono">${b}</span><div class="grow muted" style="font-size:12px">${r}</div>${chip(s, { cls: s === "current" ? "ok" : "" })}</div>`).join("")}`,
  };
  P["role-skills"] = { title: "Skills", icon: "blocks", count: () => R.skills.length,
    body: () => R.skills.map(([n, on]) => `<div class="r compact">${sw(on)}<div class="grow t mono" style="font-size:12px">${n}</div>${chip("all harnesses")}</div>`).join("") };
  P["role-mcp-servers"] = { title: "MCP servers", icon: "plug", count: () => R.mcp.length + R.internal.length,
    body: () => `${sec("Stack servers", `${R.internal.filter((x) => x[1]).length} on`)}${R.internal.map(([n, on]) => `<div class="r compact">${sw(on)}<div class="grow t mono" style="font-size:12px">${n}</div></div>`).join("")}${sec("Role servers")}${R.mcp.map(([n, t, on]) => `<div class="r compact">${sw(on)}<div class="grow t mono" style="font-size:12px">${n}</div>${chip(t)}</div>`).join("")}` };
  P["role-projects"] = { title: "Trusted projects", icon: "lock", count: () => R.projects.length,
    body: () => R.projects.map(([p, on, b]) => `<div class="r compact">${sw(on)}<div class="grow"><div class="t mono" style="font-size:12px">${p}</div><div class="s">${b} Bot working directories inside</div></div></div>`).join("") + `<div class="banner warn">${I("alert")}<div>Trust admits the project’s whole <span class="mono">.codex</span> configuration.</div></div>` };
  P["role-shims"] = { title: "Shims", icon: "term", count: () => R.shims.length,
    body: () => R.shims.map(([c, p, r]) => `<div class="r"><div class="grow"><div class="t mono" style="font-size:12px">${p}</div><div class="s">launches ${c} as ${r}</div></div>${btn("Remove", { sm: true })}</div>`).join("") };

  /* ───────── Inbox ───────── */
  P["notify-inbox"] = {
    title: "Inbox", icon: "inbox", count: () => D.notifications.filter((n) => n.open).length, views: ["Open", "Dismissed", "All"], actions: ["compose"],
    foot: () => `<button class="fbtn">Dismiss all…</button><span class="fresh">↑↓ move · D dismiss</span>`,
    body: ({ S }) => `<div class="toolbar">${chip("All sources " + I("down"), { cls: "link" })}</div>` + D.notifications.map((n) => `<div ${sel("inbox.sel", n.id, S.sel["inbox.sel"])}><span class="lead" style="padding-top:5px">${n.open ? dot("acc") : dot("ring")}</span><div class="grow"><div class="t" style="${n.open ? "" : "font-weight:400"}">${esc(n.title)}</div><div class="s">${esc(n.sub)}${!n.open ? ` · ${n.outcome}` : ""}</div></div><span class="m" style="display:flex;gap:4px;align-items:center">${n.q ? I("msgs") : ""}${n.link ? I("ext") : ""}${n.at}</span></div>`).join(""),
  };
  P["notify-detail"] = {
    title: "Notification", icon: "bell", rec: ({ S }) => D.notifications.find((n) => n.id === S.sel["inbox.sel"])?.title,
    body: ({ S }) => {
      const n = D.notifications.find((x) => x.id === S.sel["inbox.sel"]) || D.notifications[0];
      return `<div class="pad stack-v" style="gap:6px"><div style="font-size:17px;font-weight:600;letter-spacing:-0.02em">${esc(n.title)}</div><div class="muted">${esc(n.sub)} · ${n.at} ago</div></div>
        <div class="md" style="padding-top:4px">${H.md(n.body || "No message.")}</div>
        ${sec("Details")}${kv([["Source", n.src], ["ID", `<span class="mono">${n.id}-6c1e</span>`], ["Group", "—"]])}
        <div class="pad stack-v">${n.open ? `${n.actions ? `<div style="display:flex;gap:6px;flex-wrap:wrap">${n.actions.map((a, i) => btn(a, { primary: i === 0 })).join("")}</div>` : ""}${n.reply ? `<div class="textarea">Reply… <span class="kbd" style="float:right">⌘⏎</span></div>` : ""}${n.link ? btn("Open link", { icon: "ext" }) : ""}<div>${btn("Dismiss", {})}</div><div class="muted" style="font-size:12px">Choosing or reading never dismisses; only these controls do, once.</div>` : `<div class="banner">${I("check")}<div>Dismissed · ${n.outcome}</div></div>`}</div>`;
    },
  };
  P["notify-compose"] = {
    title: "Compose", icon: "send",
    foot: () => `${btn("Review", { sm: true })}${btn("Send", { sm: true, primary: true, icon: "send" })}<span class="fresh">Draft saved</span>`,
    body: () => `<div class="pad stack-v" style="gap:10px"><div class="seg"><button aria-pressed="false">Notice</button><button aria-pressed="true">Question</button><button aria-pressed="false">Reply prompt</button></div>
      ${input("Title", "", "Ship the pane shell this week?")}<div class="textarea" style="min-height:90px">The prototype covers every space. I’d like your go-ahead before porting Fleet.</div>
      <div class="muted" style="font-size:12px">Choices</div><div style="display:flex;gap:6px;flex-wrap:wrap">${chip("Go ahead")}${chip("Wait")}${chip(I("plus") + "Add", { cls: "link" })}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${chip("No Bot watch (operator send)")}${chip("UUID 2f81…c09a", { mono: true })}</div></div>`,
  };
})();
