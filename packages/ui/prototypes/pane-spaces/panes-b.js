/* PROTOTYPE — pane renderers, part B. */
(() => {
  const P = window.PANES, { chip, dot, sec, kv, btn, input, meter, sw, orb, esc } = H;
  const sel = (key, val, cur) => `data-sel="${key}=${val}" data-row="${val}" class="r click ${String(cur) === String(val) ? "sel" : ""}"`;
  const tone = H.phaseTone;

  /* ───────── Signal ───────── */
  const G = D.signal;
  P["signal"] = {
    title: "Signal", icon: "radar", node: "signal",
    body: () => `<div class="r"><div class="grow"><div class="t">Processing</div><div class="s">Interprets new messages; spends Codex allowance</div></div>${sw(G.enabled)}</div>
      ${sec("Health")}${kv([["Baselines", "3 sources"], ["Last scan", G.lastScan + " ago"], ["Last interpretation", G.lastInference + " ago"], ["Unreadable sources", "none"]])}
      ${sec("Backlog")}<div class="stats" style="padding-top:0"><div class="stat"><b>${G.backlog.queued}</b><span>queued</span></div><div class="stat"><b>${G.backlog.running}</b><span>running</span></div><div class="stat"><b>${G.backlog.failed}</b><span>failed</span></div></div>
      ${sec("Defaults", null, "rev 6")}<div class="pad" style="padding-top:0;display:flex;gap:6px;flex-wrap:wrap">${chip("codex-bot-account-1 " + I("down"), { cls: "link" })}${chip(`${G.model} ${I("down")}`, { cls: "link" })}${chip(`${G.effort} ${I("down")}`, { cls: "link" })}</div>
      ${sec("Feedback")}<div class="pad muted" style="padding-top:0">2 entries this week · resolves nothing</div>`,
  };
  P["attention"] = {
    title: "Attention", icon: "msgs", count: () => 3,
    body: ({ S }) => `<div class="toolbar">${chip("Current " + I("down"), { cls: "link" })}${chip("Audience: human " + I("down"), { cls: "link" })}${chip("All Bots " + I("down"), { cls: "link" })}</div>
      ${G.items.filter((i) => i.kind !== "awareness").map((i) => `<div ${sel("signal.sel", i.id, S.sel["signal.sel"])}><div class="lead">${chip(H.word(i.kind), { cls: i.urgency === "high" ? "warn" : "" })}</div><div class="grow"><div class="t" style="${i.explicit ? "" : "color:var(--muted-foreground);font-style:italic"}">${esc(i.text)}</div><div class="s">${i.who}${i.explicit ? "" : " · inferred"}${i.deadline ? ` · due ${i.deadline}` : ""}</div><div class="meta">${btn("Open chat", { sm: true, icon: "term", attrs: `data-goto="fleet|chat|fleet.bot=${i.who}"` })}${btn("Feedback", { sm: true })}</div></div><span class="m">${i.age}</span></div>`).join("")}
      ${sec("For your information", 1)}<div class="r compact dim"><div class="lead">${chip("Awareness")}</div><div class="grow"><div class="t" style="font-style:italic">${esc(G.items[3].text)}</div></div><span class="m">${G.items[3].age}</span></div>`,
  };
  P["attention-messages"] = { title: "Messages", icon: "msgs", count: () => G.messages.length,
    body: () => G.messages.map((m) => `<div class="r ${m.superseded ? "dim" : ""}"><div class="grow"><div class="t" style="font-weight:400">${H.md(m.text).replace(/^<p>|<\/p>$/g, "")}</div><div class="s">${m.who} · ${m.items} item${m.items === 1 ? "" : "s"}${m.provisional ? " · provisional" : ""}${m.superseded ? " · superseded" : ""}</div></div><span class="m">${m.at}</span></div>`).join("") };
  P["attention-runs"] = { title: "Runs", icon: "history", count: () => G.runs.length,
    body: () => G.runs.map((r) => `<div class="r click"><span class="lead">${dot(tone(r.state))}</span><div class="grow"><div class="t"><span class="mono">${r.id}</span> · ${H.word(r.state)}${r.decide ? ` ${chip("Needs decision: replay?", { cls: "warn" })}` : ""}</div><div class="s mono">${r.model}${r.ms ? ` · ${(r.ms / 1000).toFixed(1)}s` : ""}${r.error ? ` · ${r.error}` : ""}</div></div><span class="m">${r.at}</span></div>`).join("") };
  P["attention-changes"] = { title: "Changes", icon: "activity", count: () => G.changes.length, actions: ["filter"],
    body: () => `<div class="pad muted" style="font-size:12px;padding-bottom:2px">Source-read polling hidden</div>` + G.changes.map(([t, k, d]) => `<div class="r compact"><span class="mono muted" style="font-size:11.5px">${t}</span><div class="grow"><span class="mono" style="font-size:12px">${k}</span> <span class="muted">${d}</span></div></div>`).join("") };

  /* ───────── Content ───────── */
  P["content-documents"] = {
    title: "Documents", icon: "notebook", count: () => D.docs.length, actions: ["search"],
    foot: () => `<button class="fbtn">${I("plus")} New document</button>`,
    body: ({ S }) => `<div class="toolbar">${input("Search the Vault")}<div class="filterchips">${["design", "research", "wm", "plan"].map((t) => chip(t, { cls: "link" })).join("")}</div></div>` + D.docs.map((d) => `<div ${sel("content.doc", d.slug, S.sel["content.doc"])}><div class="grow"><div class="t">${esc(d.title)}</div><div class="s trunc">${esc(d.snippet)}</div><div class="meta">${d.tags.map((t) => chip(t)).join("")}${d.slug === "pane-spaces-design" ? chip("Unsaved draft", { cls: "warn" }) : ""}</div></div><span class="m">${d.at}</span></div>`).join(""),
  };
  P["content-library"] = {
    title: "Library", icon: "library", count: () => 19,
    foot: () => `<button class="fbtn">${I("plus")} Upload</button><button class="fbtn">${I("plus")} Collection</button>`,
    body: () => `<div style="display:grid;grid-template-columns:150px 1fr;min-height:100%"><div style="border-right:1px solid var(--line);padding:6px 0">${D.collections.map(([n, c], i) => `<div class="r compact click ${i === 2 ? "sel" : ""}" style="border:0"><div class="grow t" style="font-weight:${i === 2 ? 600 : 400}">${n}</div><span class="m">${c}</span></div>`).join("")}</div>
      <div>${D.library.map((f) => `<div class="r compact click">${I(f.kind === "image" ? "eye" : f.kind === "document" ? "file" : "folder", "muted")}<div class="grow"><div class="t mono trunc" style="font-size:12px">${f.name}</div><div class="s">${f.kind} · ${f.size} · rev ${f.rev}</div></div><span class="m">${f.at}</span></div>`).join("")}</div></div>`,
  };
  P["content-editor"] = {
    title: "Editor", icon: "pen", flush: true, rec: ({ S }) => D.docs.find((d) => d.slug === S.sel["content.doc"])?.title,
    foot: () => `${btn("Save", { sm: true, primary: true })}${btn("History", { sm: true, icon: "history" })}<span class="fresh">Draft · digest 4be1… · [[ offers documents</span>`,
    body: () => `<div class="pane-body"><pre class="code" style="margin:10px;border-radius:9px;min-height:calc(100% - 20px);font-size:12px;line-height:1.7">${esc(D.docBody)}<span class="cursor"></span></pre></div>`,
  };
  P["content-preview"] = {
    title: "Preview", icon: "eye", rec: ({ S }) => D.docs.find((d) => d.slug === S.sel["content.doc"])?.title,
    body: () => `<div class="md">${H.md(D.docBody)}</div>${sec("Links")}<div class="pad" style="padding-top:0;display:flex;gap:6px;flex-wrap:wrap">${chip("→ tmux-swap-layouts", { cls: "link" })}${chip("→ niri-scrolling-tiling", { cls: "link" })}${chip("← q4-roadmap", { cls: "link" })}</div>`,
  };
  P["content-artifacts"] = { title: "Artifacts", icon: "boxes", count: () => D.artifacts.length,
    body: () => D.artifacts.map((a) => `<div class="r click"><div class="grow"><div class="t mono" style="font-size:12px">${a.name}</div><div class="s">${a.versions} versions · latest ${a.latest}${a.tomb ? ` · ${a.tomb} tombstoned` : ""}</div><div class="meta">${btn("Copy citation", { sm: true, icon: "copy" })}${btn("Copy latest path", { sm: true })}</div></div><span class="m">${a.at}</span></div>`).join("") };
  P["content-storage"] = { title: "Storage", icon: "hdd",
    body: () => `${sec("Upload stages")}<div class="pad muted" style="padding-top:0">None in flight.</div>${sec("Collection blobs")}${kv([["Blobs", "19 · 44.1 MB"], ["Unreferenced", "2 · 3.2 MB"]])}${sec("Temporary publications")}${kv([["Claimed", "1 · expires in 6h"]])}<div class="pad">${btn("Prepare collection…", { sm: true })}</div>` };

  /* ───────── Workers ───────── */
  const wRow = (w, cur) => `<div ${sel("workers.sel", w.id, cur)}><span class="lead" style="padding-top:5px">${dot(tone(w.phase))}</span><div class="grow"><div class="t mono" style="font-size:12px">${w.label}</div><div class="s">${H.word(w.phase)} · turn ${w.turn} · <span class="goto" data-goto="fleet|bots|fleet.bot=${w.bot}">${w.bot}</span> · ${w.model}</div>${w.perm ? `<div class="s" style="color:color-mix(in oklab, var(--warning) 50%, var(--foreground))">${H.md(w.perm).replace(/^<p>|<\/p>$/g, "")}</div>` : ""}${w.issue ? `<div class="s" style="color:var(--destructive)">${w.issue}</div>` : ""}</div><span class="m">${w.updated}</span></div>`;
  P["workers"] = {
    title: "Workers", icon: "hammer", count: () => D.workers.length, actions: ["settings"],
    body: ({ S }) => {
      const g = (label, f, collapsed) => { const ws = D.workers.filter(f); return ws.length ? sec(label, ws.length, collapsed ? I("right") : "") + (collapsed ? "" : ws.map((w) => wRow(w, S.sel["workers.sel"])).join("")) : ""; };
      return `<div class="toolbar">${chip("All Bots " + I("down"), { cls: "link" })}${chip("All accounts " + I("down"), { cls: "link" })}</div>${g("Needs attention", (w) => ["awaiting_input", "needs_recovery", "failed"].includes(w.phase))}${g("Running", (w) => w.phase === "running")}${g("Idle", (w) => w.phase === "idle")}${g("Closed", (w) => w.phase === "closed", true)}`;
    },
  };
  const workerBody = (id, view) => {
    const w = D.workers.find((x) => x.id === id) || D.workers[0];
    const head = `<div class="pad" style="border-bottom:1px solid var(--line)"><div style="display:flex;gap:8px;align-items:center"><span class="st">${dot(tone(w.phase))} ${H.word(w.phase)}</span><span class="muted" style="font-size:12px">turn ${w.turn} · ${w.phase === "running" ? "1m 12s" : "last turn completed · end_turn"}</span><span class="muted" style="margin-left:auto;font-size:12px">${I("lock")} Observe · settings · maintenance</span></div>
      <div class="meta">${chip(w.bot, { go: `fleet|bots|fleet.bot=${w.bot}` })}${chip(orb(w.account) + w.account, { mono: true, go: `accounts|accounts|accounts.sel=${w.account}` })}${chip(I("sparkles") + `${w.model}${w.effort ? " · " + w.effort : ""}`)}${chip(I("branch") + w.branch, { mono: true })}${chip("from " + w.base, { mono: true })}${chip("Worker r6")}${w.work ? chip(I("hud") + w.work, { go: "hud|hud-item|hud.item=w3" }) : ""}</div></div>`;
    const perm = w.perm ? `<div class="banner warn">${I("hand")}<div><b>Permission pending</b> — ${H.md(w.perm).replace(/^<p>|<\/p>$/g, "")}<div class="acts">${chip("Allow once")}${chip("Allow always")}${chip("Reject")}</div><div class="s muted" style="margin-top:6px">Waiting for its Bot to answer.</div></div></div>` : "";
    if (view === 1) return head + `<div class="pad muted" style="font-size:12px">worktree/pane-engine · 2 commits · +214 −18 · uncommitted changes</div>${[["M", "packages/ui/lib/stack/layout.ts", "+214 −0"], ["M", "packages/ui/lib/stack/geometry.ts", "+0 −18"], ["A", "packages/ui/test/layout.test.mjs", "+96 −0"]].map(([s, p, d]) => `<div class="r compact"><span class="mono" style="color:var(--success)">${s}</span><div class="grow mono trunc" style="font-size:12px">${p}</div><span class="m mono">${d}</span></div>`).join("")}<div class="diff" style="margin-top:6px"><div class="hunk">@@ -0,0 +1,12 @@</div><div class="add">+export type Layout = Split | Stack;</div><div class="add">+export type Split = { axis: "row" | "col"; children: Child[] };</div><div class="add">+export type Stack = { panes: string[]; active: number };</div><div class="add">+</div><div class="add">+export function insert(layout: Layout, target: string, side: Side, pane: string): Layout {</div><div class="add">+  return replaceLeaf(layout, target, (leaf) => wrap(leaf, side, pane));</div><div class="add">+}</div></div>`;
    return head + perm + `<div class="tx" style="font-size:12px">${D.workerLog.map((e) => e.k === "user" ? `<div class="you">${esc(e.text)}</div>` : e.k === "agent" ? `<div class="ai"><p>${esc(e.text)}</p></div>` : e.k === "tool" ? `<div class="ai" style="display:flex;gap:8px;align-items:center;color:var(--muted-foreground);margin-bottom:6px">${dot(e.state === "running" ? "ok pulse" : "ok")}<span style="color:var(--foreground)">${e.name}</span><span class="trunc">${esc(e.detail)}</span></div>` : `<div class="ai" style="margin:6px 0 10px">${e.items.map(([s, t]) => `<div style="color:${s === "todo" ? "var(--muted-foreground)" : "inherit"}">${s === "done" ? "☑" : s === "doing" ? "◐" : "☐"} ${t}</div>`).join("")}</div>`).join("")}</div>`;
  };
  P["worker"] = {
    title: "Worker", icon: "hammer", views: ["Conversation", "Changes", "Files", "Turns", "Tools", "Records", "Session", "Settings"], actions: ["newpane", "pin"],
    rec: ({ S, inst }) => D.workers.find((w) => w.id === (inst || S.sel["workers.sel"]))?.label,
    foot: ({ S, inst }) => `<span class="fresh" style="margin-left:0">${dot("ok")} Live</span><span class="fresh mono">${inst || S.sel["workers.sel"]}-0000 · updated now</span>`,
    body: ({ S, inst, view }) => workerBody(inst || S.sel["workers.sel"], view),
  };
  P["worker-runtimes"] = { title: "Runtimes", icon: "cpu", count: () => D.runtimes.length,
    body: () => D.runtimes.map((r) => `<div class="r compact">${dot(r.state === "running" ? "ok" : "bad")}<div class="grow"><div class="t">${r.provider} <span class="muted mono" style="font-size:11.5px">${r.backend}</span></div><div class="s">${r.error ? `<span style="color:var(--destructive)">${r.error}</span>` : `pid ${r.pid} · per ${r.model}`}</div></div><span class="m">${r.state}</span></div>`).join("") };

  /* ───────── Scrape ───────── */
  const SC = D.scrape;
  P["scrape-extract"] = {
    title: "Extract", icon: "globe", views: ["Page", "Links", "Rendered", "Markdown", "Relations", "Raw"],
    body: () => `<div class="toolbar" style="flex-wrap:nowrap">${input("URL", "globe", SC.url)}${btn("Extract", { primary: true })}</div><div class="toolbar">${chip("Preset: github-repo (auto)")}${chip("Direct HTTP")}${chip("Browser off")}<span class="muted" style="margin-left:auto;font-size:12px">ok · 412 ms · 1.8 KB</span></div><div class="md">${H.md(SC.result)}</div>${sec("Recent")}${["github.com/niri-wm/niri", "zellij.dev/documentation/swap-layouts", "i3wm.org/docs/userguide.html"].map((u, i) => `<div class="r compact click"><div class="grow mono trunc" style="font-size:12px">${u}</div><span class="m">${["now", "8m", "1h"][i]}</span></div>`).join("")}`,
  };
  P["scrape-feeds"] = { title: "Feeds", icon: "rss", views: ["Discover", "Parse"],
    body: () => `<div class="toolbar" style="flex-wrap:nowrap">${input("Site or feed URL", "rss", "github.com/niri-wm/niri/releases")}${btn("Discover", { primary: true })}</div>${sec("Result", 3, "Atom · validators kept")}${SC.feeds.map((f) => `<div class="r compact click"><div class="grow"><div class="t">${f.title}</div><div class="s mono trunc">${f.url}</div></div><span class="m">${f.at}</span></div>`).join("")}` };
  P["scrape-convert"] = { title: "Convert", icon: "arrows",
    body: () => `<div class="pad stack-v"><div class="muted" style="font-size:12px">HTML → Markdown</div><div class="code" style="min-height:80px">&lt;h1&gt;Swap layouts&lt;/h1&gt;&lt;p&gt;Layouts adapt as panes are added…&lt;/p&gt;</div><div style="display:flex;justify-content:flex-end">${btn("Convert", { primary: true, sm: true })}</div><div class="code"># Swap layouts\n\nLayouts adapt as panes are added…</div></div>` };
  P["scrape-presets"] = { title: "Presets", icon: "blocks", count: () => SC.presets.length,
    body: () => SC.presets.map((p) => `<div class="r compact click">${dot(tone(p.state))}<div class="grow"><div class="t mono" style="font-size:12px">${p.name}</div><div class="s">${p.host} · checked ${p.last} ago</div></div>${p.state === "drift" ? chip("Structure drift", { cls: "warn" }) : chip("canary " + p.canary, { cls: "ok" })}</div>`).join("") };
  P["scrape-status"] = { title: "Status", icon: "gauge",
    body: () => [["Browser runtime", "available", "agent-browser 0.31"], ["pandoc", "available", "3.7"], ["gh", "available", "2.81 · signed in"], ["Egress grants", "4 active", ""]].map(([n, s, v]) => `<div class="r compact">${dot("ok")}<div class="grow"><div class="t">${n}</div>${v ? `<div class="s mono">${v}</div>` : ""}</div><span class="m">${s}</span></div>`).join("") };
  P["scrape-checks"] = { title: "Checks", icon: "list",
    body: () => `${sec("Live canaries")}${SC.presets.slice(0, 4).map((p) => `<div class="r compact">${dot(p.canary === "pass" ? "ok" : "bad")}<div class="grow mono" style="font-size:12px">${p.name}</div><span class="m">${p.canary}</span></div>`).join("")}${sec("Corpus replay", null, "github-repo")}${kv([["Captures", "12 final"], ["Last replay", "40m · 12 / 12 match"]])}${sec("Route tools")}<div class="pad" style="padding-top:0">${btn("Replay corpus", { sm: true })}</div>` };
  P["scrape-queue"] = { title: "Queue", icon: "import", count: () => SC.queue.length,
    foot: () => `<button class="fbtn">${I("plus")} Scrape to file</button>`,
    body: () => SC.queue.map((j) => `<div class="r">${dot(tone(j.state === "running" ? "running" : j.state))}<div class="grow"><div class="t mono trunc" style="font-size:12px">${j.url}</div><div class="s">${H.word(j.state)} → <span class="mono">${j.dest}</span>${j.error ? ` · <span style="color:var(--destructive)">${j.error}</span>` : ""}</div>${j.state === "failed" ? `<div class="meta">${btn("Retry", { sm: true })}${btn("Discard", { sm: true })}</div>` : ""}</div><span class="m">${j.at}</span></div>`).join("") };

  /* ───────── Browse ───────── */
  const B = D.browse;
  P["browse-handoffs"] = {
    title: "Handoffs", icon: "life", count: () => 1,
    body: ({ S }) => B.handoffs.filter((h) => !h.resolved).map((h) => `<div ${sel("browse.handoff", h.id, S.sel["browse.handoff"])}><span class="lead" style="padding-top:5px">${dot("warn")}</span><div class="grow"><div class="t">${esc(h.msg)}</div><div class="s"><span class="goto" data-goto="fleet|bots|fleet.bot=${h.bot}">${h.bot}</span> · ${h.profile} · tab present · automation drained</div><div class="meta">${btn("Take control", { sm: true, primary: true })}${btn("Finish " + I("down"), { sm: true })}</div></div><span class="m">${h.at}</span></div>`).join("") + sec("History", 1, I("right")),
  };
  P["viewer"] = {
    title: "Viewer", icon: "monitor", flush: true, actions: ["newpane", "pin"],
    rec: ({ inst }) => (inst || "bot-2-default") + " ▾",
    body: ({ inst }) => {
      const p = inst || "bot-2-default";
      return `<div class="banner ${p === "bot-2-default" ? "warn" : ""}" style="margin:8px 10px 0">${I(p === "bot-2-default" ? "eye" : "monitor")}<div style="flex:1">${p === "bot-2-default" ? "<b>Observing</b> — follows the visible tab; delivery unverified. Take control from Handoffs to type." : "<b>Observing</b> bot-1-default"}</div></div>
        <div class="browser"><div class="bar"><span>●●●</span><span class="url">${p === "bot-2-default" ? "github.com/sessions/two-factor" : "arxiv.org/abs/2609.01234"}</span></div><div class="page">${p === "bot-2-default" ? `<div class="gh"><div class="logo"></div><h3>Two-factor authentication</h3><div class="box">Authentication code<div class="field">••• •••</div><div class="go">Verify</div></div></div>` : `<div class="gh" style="width:360px;text-align:left"><h3 style="font-size:16px">Spatial layouts for agent dashboards</h3><div class="muted" style="font-size:12px;line-height:1.6">Abstract — We compare free canvases, tiled layouts and scrolling strips for monitoring concurrent agents…</div></div>`}</div></div>`;
    },
  };
  P["browse-profiles"] = { title: "Profiles", icon: "hdd", count: () => B.profiles.length,
    foot: () => `<button class="fbtn">${I("plus")} Create profile</button>`,
    body: () => ["bot-1", "bot-2", null].map((bot) => sec(bot || "Unassigned") + B.profiles.filter((p) => p.bot === bot).map((p) => `<div class="r compact">${dot(tone(p.state))}<div class="grow"><div class="t mono" style="font-size:12px">${p.name}</div><div class="s">${p.state}${p.def ? " · default" : ""}${p.sel ? " · selected" : ""}</div></div>${p.held ? chip("Held by handoff", { cls: "warn" }) : ""}</div>`).join("")).join("") };
  P["browse-controllers"] = { title: "Controllers", icon: "cable", count: () => B.controllers.length,
    body: () => B.controllers.map((c) => `<div class="r compact">${dot(tone(c.state))}<div class="grow"><div class="t">${c.name}</div><div class="s mono">${c.profile}</div></div><span class="m">${c.state}</span></div>`).join("") + `<div class="pad muted" style="font-size:12px">Last observations; selection stays with each Bot.</div>` };
  P["browse-toolchain"] = { title: "Toolchain", icon: "wrench", actions: ["refresh"],
    body: () => `${sec("agent-browser")}${kv([["Installed", '<span class="mono">0.31.2</span>'], ["Latest", '<span class="mono">0.31.4</span>'], ["Update policy", "ask"]])}<div class="pad" style="padding-top:0;display:flex;gap:6px">${btn("Accept update", { sm: true, primary: true })}${btn("Check now", { sm: true })}</div>${sec("Hypeman")}${kv([["Selected", "local · 1.9.0"], ["Volumes", "6 owned · 41 GB"]])}` };

  /* ───────── Brain ───────── */
  const BR = D.brain;
  P["brain-search"] = {
    title: "Search", icon: "search", views: ["Results", "Context"],
    body: ({ S }) => `<div class="toolbar" style="flex-wrap:nowrap">${input("Search research", "search", BR.query)}<span class="seg" style="height:30px"><button aria-pressed="true">any</button><button>all</button><button>raw</button></span></div><div class="toolbar">${chip("tag " + I("down"), { cls: "link" })}${chip("source type " + I("down"), { cls: "link" })}${chip("updated " + I("down"), { cls: "link" })}<span class="muted" style="margin-left:auto;font-size:12px">5 of 38</span></div>` +
      BR.hits.map((h) => `<div ${sel("brain.hit", h.id, S.sel["brain.hit"])}><div class="grow"><div class="t">${esc(h.title)}</div><div class="s">${h.snippet}</div><div class="meta">${chip(h.src)}${chip(h.kind)}<span class="muted num" style="font-size:11.5px;margin-left:4px">${h.score}</span></div></div></div>`).join(""),
  };
  P["brain-reader"] = {
    title: "Reader", icon: "book", rec: () => BR.reader.title,
    body: () => `<div class="pad" style="padding-bottom:0"><div style="font-size:17px;font-weight:600;letter-spacing:-0.02em;line-height:1.3">${esc(BR.reader.title)}</div><div class="muted" style="font-size:12px;margin-top:4px">${BR.reader.meta} · <span class="goto mono">${BR.reader.src}</span></div></div>
      <div class="md" style="font-size:13.5px">${BR.reader.body.map((p, i) => `<p>${i === 0 ? `<mark>${esc(p)}</mark>` : esc(p)}</p>`).join("")}</div>
      ${sec("Links")}<div class="pad" style="padding-top:0;display:flex;gap:6px;flex-wrap:wrap">${chip("PaperWM: tiling on a scrolling strip", { cls: "link" })}${chip("i3 user guide", { cls: "link" })}</div><div class="pad">${btn("Delete…", { sm: true, danger: true })}</div>`,
  };
  P["brain-ingest"] = { title: "Ingest", icon: "import",
    body: () => `<div class="pad stack-v"><div class="seg"><button aria-pressed="true">URL</button><button>Text</button></div>${input("https://…", "globe", "https://zellij.dev/news/0.44")}${input("Title (optional)", "")}${input("Tags", "")}<div style="display:flex;justify-content:flex-end">${btn("Submit", { primary: true, sm: true })}</div></div>${sec("Submitted from this page", 2)}<div class="r compact">${dot("ok")}<div class="grow"><div class="t mono trunc" style="font-size:12px">zellij.dev/news/0.44</div><div class="s">admitted → indexed as rd-874</div></div><span class="m">2m</span></div><div class="r compact">${dot("ok pulse")}<div class="grow"><div class="t mono trunc" style="font-size:12px">github.com/paperwm/PaperWM</div><div class="s">admitted · job #4480 running</div></div><span class="m">now</span></div>` };
  P["brain-jobs"] = { title: "Jobs", icon: "list", count: () => BR.jobRows.length, views: ["Needs attention", "Active", "Done", "All"],
    body: () => `<div class="r compact">${dot("ok")}<div class="grow"><div class="t">Ingestion worker running</div><div class="s">lease heartbeat 2s · 1 stale lease</div></div></div><div class="stats">${[["failed", BR.jobs.failed], ["blocked", BR.jobs.blocked], ["retry wait", BR.jobs.retry], ["active", BR.jobs.active], ["done", BR.jobs.done.toLocaleString()]].map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join("")}</div>` + BR.jobRows.map((j) => `<div class="r click">${dot(tone(j.state === "retry_wait" ? "unknown" : j.state))}<div class="grow"><div class="t"><span class="mono">#${j.id}</span> · ${H.word(j.state)}</div><div class="s">${j.src}${j.why ? ` · ${j.why}` : ""}</div>${j.state === "blocked" || j.state === "failed" ? `<div class="meta">${btn("Retry", { sm: true })}${btn("Exclude…", { sm: true })}${btn("Reveal content…", { sm: true })}</div>` : ""}</div><span class="m">${j.at}</span></div>`).join("") };
  P["brain-sources"] = { title: "Sources", icon: "dish", count: () => BR.sources.length,
    foot: () => `<button class="fbtn">Preview due</button><button class="fbtn">Sync due</button>`,
    body: () => BR.sources.map((s) => `<div class="r">${dot(tone(s.health))}<div class="grow"><div class="t">${s.name}</div><div class="s">${s.health} · next ${s.next} · last run ${s.last}</div><div class="meta">${btn("Sync", { sm: true })}${btn("Preview", { sm: true })}${btn(s.paused ? "Resume…" : "Pause…", { sm: true })}</div></div></div>`).join("") };

  /* ───────── Proc ───────── */
  const PR = D.proc;
  const strip = (s) => `<span class="strip">${s.split("").map((c) => `<i class="${c === "x" ? "x" : c === "?" ? "q" : c === "·" ? "n" : ""}"></i>`).join("")}</span>`;
  P["proc-schedules"] = {
    title: "Schedules", icon: "clock", count: () => PR.schedules.length, actions: ["filter"],
    body: ({ S }) => [["Needs you", "needs"], ["Held", "held"], ["Upcoming", "upcoming"], ["Off", "off"]].map(([label, g]) => sec(label, PR.schedules.filter((s) => s.group === g).length) + PR.schedules.filter((s) => s.group === g).map((s) => `<div ${sel("proc.sched", s.id, S.sel["proc.sched"])}><div class="grow"><div class="t mono" style="font-size:12px">${s.label}</div><div class="s">${s.cadence} · ${s.next}</div><div class="meta">${chip(s.owner, s.owner.startsWith("bot") ? { go: `fleet|bots|fleet.bot=${s.owner}` } : { cls: s.owner === "unattributed" ? "warn" : "" })}${strip(s.strip)}</div></div></div>`).join("")).join(""),
  };
  P["proc-schedule"] = {
    title: "Schedule", icon: "clock", rec: ({ S }) => PR.schedules.find((s) => s.id === S.sel["proc.sched"])?.label,
    body: ({ S }) => { const s = PR.schedules.find((x) => x.id === S.sel["proc.sched"]) || PR.schedules[1]; return `${kv([["Target", '<span class="mono">brain.sources_sync</span>'], ["Authority", `${s.owner} · root thread`], ["Cadence", s.cadence], ["Next due", s.next], ["Revision", "4 · edited by bot-1"], ["Environment", '<span class="mono">BRAIN_TOKEN=••••••</span> <span class="goto">Reveal</span>']])}
      ${sec("Executions", 12)}${[["failed", "14:30", "exit 1 · 31s", "r-9030"], ["completed", "14:00", "0 · 28s"], ["completed", "13:30", "0 · 30s"], ["completed", "13:00", "0 · 27s"]].map(([st, t, d, run]) => `<div class="r compact ${run ? "click" : ""}" ${run ? `data-sel="proc.run=${run}"` : ""}>${dot(tone(st))}<div class="grow"><div class="t">${H.word(st)}</div><div class="s mono">${d}</div></div><span class="m">${t}</span></div>`).join("")}<div class="pad">${btn("Load older", { sm: true })}</div>`; },
  };
  P["proc-runs"] = {
    title: "Runs", icon: "term", count: () => PR.runs.length,
    body: ({ S }) => [["Running", ["running"]], ["Needs a look", ["failed", "unknown"]], ["Finished", ["completed"]]].map(([label, st]) => sec(label, PR.runs.filter((r) => st.includes(r.state)).length) + PR.runs.filter((r) => st.includes(r.state)).map((r) => `<div ${sel("proc.run", r.id, S.sel["proc.run"])}>${dot(tone(r.state))}<div class="grow"><div class="t mono" style="font-size:12px">${r.label}</div><div class="s">${H.word(r.state)}${r.exit ? ` · exit ${r.exit}` : ""} · ${r.owner} · ${r.origin}</div></div><span class="m">${r.elapsed} · ${r.lines} ln</span></div>`).join("")).join(""),
  };
  P["proc-run"] = {
    title: "Run", icon: "term", flush: true, actions: ["newpane", "pin"],
    rec: ({ S, inst }) => PR.runs.find((r) => r.id === (inst || S.sel["proc.run"]))?.label,
    body: ({ S, inst }) => { const r = PR.runs.find((x) => x.id === (inst || S.sel["proc.run"])) || PR.runs[0];
      return `<div class="toolbar"><span class="st">${dot(tone(r.state))} ${H.word(r.state)}</span><span class="mono muted" style="font-size:11.5px">pid <span class="goto" data-goto="system|processes|">51877</span> · ~/code/stack · ${r.elapsed}</span><span style="margin-left:auto;width:180px">${input("Find in output")}</span></div>
        <div class="pane-body"><div class="log">${PR.log.map(([k, t], i) => `<div class="${k === "e" ? "e" : ""}"><i>${i + 398}</i>${esc(t)}</div>`).join("")}</div></div><div class="txstatus">${dot(r.state === "running" ? "ok pulse" : "")} follows end · 412 lines kept · stderr marked in the gutter</div>`; },
  };
  P["proc-timeline"] = {
    title: "Timeline", icon: "gantt", views: ["6 h", "24 h"],
    body: () => { const lanes = [["brain-sync", [[8, "c"], [20, "c"], [33, "c"], [45, "x"], [57, "n"], [70, "n"], [82, "n"]]], ["usage-snapshot", [...Array(10)].map((_, i) => [4 + i * 5, "c"]).concat([[57, "n"], [62, "n"]])], ["nightly-backup", [[12, "c"], [93, "n"]]], ["report-weekly", [[30, "u"]]], ["cleanup.sh", [[22, "x"]]]];
      return `<div class="gantt"><div class="axis"><div></div><div><span>−6h</span><span>−3h</span><span>now</span><span>+3h</span><span>+6h</span></div></div>${lanes.map(([n, m]) => `<div class="lane"><span class="mono trunc" style="font-size:11.5px">${n}</span><div class="track"><span class="now" style="left:50%"></span>${m.map(([x, k]) => k === "x" ? `<span class="mk x" style="left:${x}%">×</span>` : `<span class="mk ${k === "u" ? "u" : k === "n" ? "next" : ""}" style="left:${x}%"></span>`).join("")}</div></div>`).join("")}<div class="lane"><span class="muted" style="font-size:11.5px">Direct runs</span><div class="track"><span class="now" style="left:50%"></span><span class="bar" style="left:44%;width:6%"></span><span class="bar" style="left:31%;width:2%;opacity:.6"></span></div></div></div>`; },
  };

  /* ───────── Source ───────── */
  const SO = D.source;
  P["source-receivers"] = {
    title: "Receivers", icon: "tower", count: () => SO.receivers.length,
    foot: () => `<button class="fbtn">${I("plus")} New receiver</button>`,
    body: () => `${sec("Intake")}${kv([["Loopback", '<span class="mono">127.0.0.1:8790</span>'], ["Newest", "#81"], ["Payloads", "76 of 10,000 · 370 KiB of 25 MiB"]])}
      ${sec("Receivers")}${SO.receivers.map((r) => `<div class="r"><span class="lead" style="padding-top:5px">${dot(r.enabled ? "ok" : "ring")}</span><div class="grow"><div class="t">${r.label} ${r.enabled ? "" : chip("Disabled")}</div><div class="s mono">${r.target}</div><div class="s">Last delivery ${r.last} · ping ${r.ping}</div><div class="meta">${chip(`${r.acc} accepted`)}${chip(`${r.dup} duplicate`)}${r.rej ? chip(`${r.rej} rejected`, { cls: "bad" }) : chip("0 rejected")}<span class="goto" style="font-size:12px;margin-left:4px">Setup facts ›</span></div></div></div>`).join("")}`,
  };
  P["source-catalog"] = { title: "Event catalog", icon: "bookmark", count: () => 75,
    body: () => `<div class="toolbar">${chip("GitHub Cloud " + I("down"), { cls: "link" })}${chip("Any hook type " + I("down"), { cls: "link" })}</div><div class="pad" style="padding-bottom:0">${input("issues, opened, review…")}</div><div class="pad muted" style="font-size:12px">Documentation only — unlisted events are still accepted.</div>${[["branch_protection_rule", 3], ["check_run", 4], ["check_suite", 3], ["issue_comment", 3], ["issues", 17], ["pull_request", 21], ["push", 1], ["workflow_run", 3]].map(([e, n]) => `<div class="r compact click">${I("right", "muted")}<div class="grow mono" style="font-size:12px">${e}</div><span class="m">${n} action${n > 1 ? "s" : ""}</span></div>`).join("")}` };
  P["source-deliveries"] = {
    title: "Deliveries", icon: "inbox", count: () => 81, actions: ["filter"],
    body: ({ S }) => `<div class="toolbar"><b style="font-size:12.5px">Snapshot through #81</b><span class="muted" style="font-size:12px">25 loaded</span>${chip("All accepted deliveries " + I("down"), { cls: "link" })}<span style="margin-left:auto">${btn("Fresh snapshot", { sm: true, icon: "refresh" })}</span></div>` +
      SO.deliveries.map((d) => `<div ${sel("source.del", d.seq, S.sel["source.del"])}><span class="mono muted num" style="font-size:12px;width:28px;padding-top:1px">#${d.seq}</span><div class="grow"><div class="t mono" style="font-size:12px;font-weight:600">${d.event}${d.action ? "." + d.action : ""}</div><div class="s"><span class="mono">${d.repo}</span> · by ${d.who}</div><div class="s" style="color:var(--foreground)">${esc(d.title)}</div><div class="s">${d.cleared ? "Original cleared" : "Original retained"} · ${d.size}</div></div><span class="m">${d.at}</span></div>`).join(""),
  };
  P["source-delivery"] = {
    title: "Delivery", icon: "json", rec: ({ S }) => "#" + S.sel["source.del"],
    body: ({ S }) => { const d = SO.deliveries.find((x) => x.seq == S.sel["source.del"]) || SO.deliveries[1]; return `${sec("Summary")}${kv([["Event", `<span class="mono">${d.event}${d.action ? "." + d.action : ""}</span>`], ["Receiver", '<span class="goto">Product repository</span>'], ["Delivery ID", '<span class="mono">72d3c180-a5f1-11f0</span>'], ["Received", d.at + " ago"]])}
      ${sec("Entities")}<div class="pad" style="padding-top:0;display:flex;gap:6px;flex-wrap:wrap">${chip("owner/project", { mono: true })}${chip(d.who)}${chip(esc(d.title.split(" · ")[0]), { mono: true })}</div>
      ${sec("Digest")}<div class="pad" style="padding-top:0"><span class="mono muted" style="font-size:11.5px">sha256:9c41…e07b</span> ${chip("Verified after full read", { cls: "ok" })}</div>
      ${sec("Original payload", null, "chunk 1 of 1 · escaped text")}<pre class="code" style="margin:0 12px 12px">{\n  "action": "${d.action || "push"}",\n  "number": 412,\n  "pull_request": {\n    "title": "Pane layout engine",\n    "head": { "ref": "worktree/pane-engine", "sha": "8d99222" },\n    "user": { "login": "${d.who}" }\n  },\n  "repository": { "full_name": "owner/project" }\n}</pre><div class="pad" style="padding-top:0">${btn("Clear original payload…", { sm: true })}</div>`; },
  };
  P["source-watches"] = {
    title: "Watches", icon: "eye", count: () => SO.watches.length,
    foot: () => `<button class="fbtn">${I("plus")} New watch</button>`,
    body: () => SO.watches.map((w) => `<div class="r"><div class="grow"><div class="t" style="display:flex;gap:8px;align-items:center">${w.label} <span class="muted" style="font-size:12px;font-weight:400">${w.notif ? `${dot("ok")} Notifications on` : "Notifications off"}</span></div><div class="meta">${w.filter.map((f) => chip(f, { mono: true })).join("")}</div>
      <div class="stats" style="padding:8px 0 0"><div class="stat"><b>#${w.ack}</b><span>acknowledged through</span></div><div class="stat"><b>#${w.through}</b><span>matched through</span></div><div class="stat"><b>${w.pending}</b><span>pending</span></div></div><div class="meta">${btn("Open inbox", { sm: true, icon: "right" })}</div></div></div>`).join(""),
  };
})();
