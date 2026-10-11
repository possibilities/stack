/* PROTOTYPE — the pane shell: layout engine, three shell directions, overview, drawer, palette and keys.
   Throwaway; state lives in memory and the URL only. */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const q = new URLSearchParams(location.search);
  const VARIANTS = [
    { key: "A", shell: "tiles", name: "Tiles", about: "Tiled panes with soft gaps, a rail of places grouped by job, and a header per space with layout presets. Moving between spaces re-tiles one layout into the next." },
    { key: "B", shell: "mux", name: "Mux", about: "A terminal multiplexer: edge-to-edge panes, hairline dividers, numbered panes and a status line listing every space. Keyboard first, with a ⌃B leader and which-key hints." },
    { key: "C", shell: "strip", name: "Strip", about: "The bench, tidied: every window keeps its registered width as a full-height column on a horizontal strip (windows that shared a bench column share a column). Spaces stack vertically; focus scrolls the strip." },
  ];
  /* Registered WindowDef width and column (components/canvas/spaces.tsx) — Strip reuses them verbatim. */
  const BENCH = {
    "hud-attention": [460, 0], "hud-work": [460, 0], "hud-item": [540, 1], "hud-timeline": [460, 2], "hud-resources": [460, 3],
    bots: [420, 0], "bot-state": [420, 0], chat: [640, 1], "chat:bot-2": [640, 2], "chat:bot-3": [640, 3],
    accounts: [380, 0], usage: [360, 1], "model-catalogs": [460, 2], "call-speech": [400, 0], inference: [440, 1],
    server: [400, 0], packages: [400, 0], developer: [400, 0], resources: [460, 1], host: [400, 1], "codex-tools": [460, 2], processes: [560, 2], sampling: [400, 3], activity: [400, 3], access: [460, 4], state: [500, 5], subscriptions: [460, 6], "xcom-state": [440, 6],
    "role-catalog": [380, 0], "role-instructions": [440, 1], "role-editor": [520, 2], "role-preview": [460, 3], "role-skills": [400, 4], "role-mcp-servers": [400, 4], "role-projects": [400, 4], "role-shims": [480, 5],
    "notify-inbox": [440, 0], "notify-detail": [480, 1], "notify-compose": [440, 2],
    signal: [400, 0], attention: [520, 1], "attention-messages": [460, 2], "attention-runs": [500, 3], "attention-changes": [500, 3],
    "content-documents": [420, 0], "content-library": [560, 0], "content-editor": [540, 1], "content-preview": [480, 2], "content-artifacts": [400, 3], "content-storage": [460, 4],
    workers: [420, 0], worker: [620, 1], "worker:19c2": [620, 2], "worker-runtimes": [380, 3],
    "scrape-extract": [580, 0], "scrape-feeds": [520, 1], "scrape-convert": [520, 1], "scrape-presets": [460, 2], "scrape-status": [460, 2], "scrape-checks": [440, 3], "scrape-queue": [480, 4],
    "browse-handoffs": [420, 0], viewer: [800, 1], "viewer:bot-1-default": [800, 2], "browse-profiles": [420, 3], "browse-controllers": [420, 3], "browse-toolchain": [420, 4],
    "brain-search": [520, 0], "brain-reader": [580, 1], "brain-ingest": [400, 2], "brain-jobs": [480, 3], "brain-sources": [460, 4],
    "proc-schedules": [440, 0], "proc-schedule": [520, 1], "proc-runs": [440, 2], "proc-run": [680, 3], "proc-run:r-9030": [680, 4], "proc-timeline": [760, 5],
    "source-receivers": [460, 0], "source-catalog": [460, 0], "source-deliveries": [620, 1], "source-delivery": [640, 2], "source-watches": [540, 3],
  };

  const S = {
    variant: VARIANTS.find((v) => v.key === (q.get("variant") || "A").toUpperCase()) || VARIANTS[0],
    theme: q.get("theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
    call: q.get("call") !== "0",
    space: SPACES[q.get("space")] ? q.get("space") : "hud",
    sp: {}, views: {}, overlay: null, menu: null, notes: q.get("notes") === "1", back: null, leader: false, paneNums: q.get("panenums") === "1", remote: q.get("remote") === "view", toast: null, pal: { q: "", i: 0 }, ov: 0,
    drawer: { open: Boolean(q.get("drawer")), pinned: q.get("pin") === "1", mode: q.get("drawer") === "reference" ? "reference" : "inspect" },
    sel: { "hud.item": "w2", "fleet.bot": "bot-1", "workers.sel": "7f3a", "inbox.sel": "n41", "source.del": 80, "proc.run": "r-9031", "proc.sched": "s2", "brain.hit": "rd-881", "content.doc": "pane-spaces-design", "roles.role": "Default", "roles.rec": "Worktrees for every change", "browse.handoff": "h-0c1f", "signal.sel": "a1", "accounts.sel": "codex-bot-account-1" },
  };
  const firstPane = (n) => (n.t === "stack" ? n.p[n.a] : firstPane(n.c[0].n));
  for (const id of Object.keys(SPACES)) { const tree = clone(SPACES[id].presets[0].tree); S.sp[id] = { preset: 0, tree, focus: firstPane(tree), zoom: null, closed: [] }; }
  if (q.get("preset")) setPresetRaw(S.space, +q.get("preset"));
  if (q.get("zoom")) S.sp[S.space].zoom = q.get("zoom");
  if (q.get("focus")) S.sp[S.space].focus = q.get("focus");
  if (q.get("overlay")) S.overlay = q.get("overlay");
  if (q.get("leader")) S.leader = true;
  if (q.get("shots")) document.documentElement.classList.add("shots");
  if (q.get("slow")) document.documentElement.style.setProperty("--vt", q.get("slow") === "1" ? "1600ms" : q.get("slow") + "ms");

  const kind = (id) => id.split(":")[0], inst = (id) => id.split(":")[1];
  const def = (id) => PANES[kind(id)];
  const cur = () => S.sp[S.space];
  const shell = () => S.variant.shell;
  const narrow = () => innerWidth < 900;
  const ctxFor = (id) => ({ S, inst: inst(id), view: S.views[id] || 0 });
  const titleOf = (id) => def(id)?.title || id;
  const recOf = (id) => def(id)?.rec?.(ctxFor(id));
  const countOf = (id) => def(id)?.count?.(ctxFor(id));

  /* ───────── Tree operations (pure-ish; callers clone first) ───────── */
  function walk(n, f, parent = null, i = -1) { f(n, parent, i); if (n.t !== "stack") n.c.forEach((c, j) => walk(c.n, f, n, j)); }
  function leaves(tree) { const out = []; walk(tree, (n) => n.t === "stack" && out.push(n)); return out; }
  function findLeaf(tree, id) { let r = null; walk(tree, (n, parent, i) => { if (n.t === "stack" && n.p.includes(id)) r = { leaf: n, parent, i }; }); return r; }
  function normalize(n) {
    if (n.t === "stack") return n.p.length ? n : null;
    n.c = n.c.map((c) => ({ ...c, n: normalize(c.n) })).filter((c) => c.n);
    if (!n.c.length) return null;
    if (n.c.length === 1) return n.c[0].n;
    n.c = n.c.flatMap((c) => (c.n.t === n.t ? c.n.c.map((g) => ({ n: g.n, s: (g.s / c.n.c.reduce((a, b) => a + b.s, 0)) * c.s })) : [c]));
    return n;
  }
  function removePane(tree, id) {
    const hit = findLeaf(tree, id); if (!hit) return tree;
    hit.leaf.p.splice(hit.leaf.p.indexOf(id), 1); hit.leaf.a = Math.max(0, Math.min(hit.leaf.a, hit.leaf.p.length - 1));
    return normalize(tree) || { t: "stack", p: [], a: 0 };
  }
  function insertPane(tree, target, side, id) {
    const hit = findLeaf(tree, target);
    if (!hit) return { t: "row", c: [{ n: tree, s: 2 }, { n: { t: "stack", p: [id], a: 0 }, s: 1 }] };
    if (side === "center") { hit.leaf.p.push(id); hit.leaf.a = hit.leaf.p.length - 1; return tree; }
    const axis = side === "left" || side === "right" ? "row" : "col", before = side === "left" || side === "top";
    const fresh = { t: "stack", p: [id], a: 0 };
    if (hit.parent && hit.parent.t === axis) {
      const share = hit.parent.c[hit.i].s / 2; hit.parent.c[hit.i].s = share;
      hit.parent.c.splice(before ? hit.i : hit.i + 1, 0, { n: fresh, s: share });
      return tree;
    }
    const wrapped = { t: axis, c: before ? [{ n: fresh, s: 1 }, { n: hit.leaf, s: 1 }] : [{ n: hit.leaf, s: 1 }, { n: fresh, s: 1 }] };
    if (!hit.parent) return wrapped;
    hit.parent.c[hit.i].n = wrapped; return tree;
  }
  function inTree(tree, id) { return Boolean(findLeaf(tree, id)); }
  function setPresetRaw(space, i) {
    const sp = S.sp[space], presets = SPACES[space].presets; i = (i + presets.length) % presets.length;
    sp.preset = i; sp.tree = clone(presets[i].tree); sp.zoom = null; sp.closed = [];
    if (!inTree(sp.tree, sp.focus)) sp.focus = firstPane(sp.tree);
  }

  /* ───────── Strip (C): bench columns at registered widths ───────── */
  function stripColumns(space) {
    const cols = new Map();
    for (const id of SPACE_PANES[space]) {
      if (cur().closed.includes(id) && space === S.space) continue;
      const [w, c] = BENCH[id] || [480, 9];
      if (!cols.has(c)) cols.set(c, { w: 0, panes: [] });
      const col = cols.get(c); col.w = Math.max(col.w, w); col.panes.push(id);
    }
    return [...cols.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  }

  /* ───────── Rendering ───────── */
  const iconBtn = (name, label, attrs = "") => `<button aria-label="${label}" title="${label}" ${attrs}>${I(name)}</button>`;
  const ACTIONS = { search: ["search", "Filter"], filter: ["filter", "Filters"], refresh: ["refresh", "Read again"], settings: ["settings", "Defaults"], compose: ["pen", "New notification", 'data-act="compose"'], focus: ["eye", "Focus a Bot’s chat here"], newpane: ["split", "Open a pinned pane beside", 'data-act="newpane"'], pin: ["pin", "Pin to this record", 'data-act="pin"'] };

  function paneFrame(leaf, slot) {
    const id = leaf.p[leaf.a], d = def(id); if (!d) return `<section class="pane"><div class="empty">Unknown pane ${id}</div></section>`;
    const ctx = ctxFor(id), sp = cur(), focused = sp.focus === id, tabs = leaf.p.length > 1;
    const count = (pid) => { const c = countOf(pid); return c !== undefined && c !== null && c !== "" ? `<span class="count">${c}</span>` : ""; };
    const rec = recOf(id);
    const views = d.views ? `<div class="views" role="group" aria-label="Views">${d.views.map((v, i) => `<button aria-pressed="${i === (S.views[id] || 0)}" data-view="${id}=${i}">${v}</button>`).join("")}</div>` : "";
    const head = `<div class="pane-head" data-drag="${id}"><span class="pnum">${slot + 1}</span>
      ${tabs ? `<div class="tabs" role="tablist">${leaf.p.map((p, i) => `<button role="tab" aria-selected="${i === leaf.a}" data-tab="${p}">${titleOf(p)}${count(p)}</button>`).join("")}</div>`
        : `<div class="title" data-title="${id}"${d.node || rec ? ' title="Inspect"' : ""}>${titleOf(id)}${count(id)}${rec ? `<span class="rec">${H.esc(rec)}</span>` : ""}</div>`}
      ${views}
      <div class="pane-acts">
        ${(d.actions || []).map((a) => iconBtn(ACTIONS[a][0], ACTIONS[a][1], ACTIONS[a][2] || "")).join("")}
        ${iconBtn(sp.zoom === id ? "unzoom" : "zoom", sp.zoom === id ? "Restore layout (z)" : "Zoom pane (z)", `data-act="zoom" data-pane-id="${id}"`)}
        ${iconBtn("more", "Pane menu", `data-act="menu" data-pane-id="${id}"`)}</div></div>`;
    const body = `<div class="pane-body ${d.flush ? "flush" : ""}" data-sk="${id}">${d.body(ctx)}</div>${S.paneNums ? `<div class="pane-num">${slot + 1}</div>` : ""}`;
    const foot = d.foot ? `<div class="pane-foot">${d.foot(ctx)}</div>` : "";
    return `<section class="pane ${focused ? "focus" : ""} ${tabs ? "tabbed" : ""}" data-pane="${id}" data-slot="${slot}" style="--vtn-pane:p-${id.replace(/[^a-z0-9]/gi, "-")};--vtn-slot:slot-${slot}" aria-label="${titleOf(id)}">${head}${views ? `<div class="viewbar">${views}</div>` : ""}${body}${foot}</section>`;
  }
  function renderNode(n, ctx) {
    if (n.t === "stack") return paneFrame(n, ctx.slot++);
    const sid = ctx.splits.push(n) - 1;
    return `<div class="split ${n.t}" data-sid="${sid}">${n.c.map((c, i) => `${i ? `<div class="divider" data-split="${sid}" data-i="${i - 1}" role="separator" aria-orientation="${n.t === "row" ? "vertical" : "horizontal"}"></div>` : ""}<div class="cell" style="flex:${c.s} 1 0">${renderNode(c.n, ctx)}</div>`).join("")}</div>`;
  }
  let SPLITS = [];
  function panesHTML() {
    const sp = cur(); const ctx = { slot: 0, splits: [] };
    if (shell() === "strip" && !narrow()) {
      const cols = stripColumns(S.space), W = $("#panes")?.clientWidth || innerWidth - 64;
      if (sp.zoom) return `<div class="split row" style="min-width:100%"><div class="cell" style="flex:1 1 0">${paneFrame({ p: [sp.zoom], a: 0 }, 0)}</div></div>`;
      const scale = Math.max(1, (W - 8) / cols.reduce((a, c) => a + c.w + 6, 0));
      SPLITS = [];
      return `<div class="split row">${cols.map((c, ci) => `${ci ? `<div class="divider" style="cursor:default"></div>` : ""}<div class="cell" data-col="${ci}" style="width:${Math.round(c.w * scale)}px">${c.panes.length === 1 ? paneFrame({ p: c.panes, a: 0 }, ctx.slot++) : `<div class="split col">${c.panes.map((p, i) => `${i ? '<div class="divider"></div>' : ""}<div class="cell" style="flex:1 1 0">${paneFrame({ p: [p], a: 0 }, ctx.slot++)}</div>`).join("")}</div>`}</div>`).join("")}</div>`;
    }
    if (sp.zoom || narrow()) {
      const target = sp.zoom || sp.focus; const hit = findLeaf(sp.tree, target) || { leaf: { p: [target], a: 0 } };
      const leaf = { ...hit.leaf, a: hit.leaf.p.indexOf(target) >= 0 ? hit.leaf.p.indexOf(target) : 0 };
      SPLITS = [];
      return `<div class="cell" style="flex:1 1 0">${paneFrame(leaf, leaves(sp.tree).indexOf(hit.leaf))}</div>${sp.zoom && !narrow() ? `<div class="zoom-chip">${I("zoom")} Zoomed · ${titleOf(target)} <button data-act="zoom" data-pane-id="${target}"><span class="kbd">z</span> restore</button></div>` : ""}`;
    }
    const html = sp.tree.t === "stack" ? `<div class="cell" style="flex:1 1 0">${renderNode(sp.tree, ctx)}</div>` : renderNode(sp.tree, ctx);
    SPLITS = ctx.splits; return html;
  }
  function mini(n, labels, focus) {
    if (n.t === "stack") return `<div class="mini ${n.p.length > 1 ? "tabs-mini" : ""} ${focus && n.p[n.a] === focus ? "foc" : ""}">${labels ? titleOf(n.p[n.a]) : ""}</div>`;
    return `<div class="split ${n.t}" style="gap:${labels ? 3 : 1.5}px">${n.c.map((c) => `<div class="cell" style="flex:${c.s} 1 0">${mini(c.n, labels, focus)}</div>`).join("")}</div>`;
  }
  const glyph = (tree) => `<span class="glyph" style="display:flex">${mini(tree, false).replace(/class="mini[^"]*"><\/div>/g, 'class="mini" style="flex:1;background:currentColor;opacity:.5;border-radius:1px;min-width:0;min-height:0"></div>')}</span>`;

  function railHTML() {
    const item = (id) => { const s = SPACES[id], a = s.attention, n = a.n;
      return `<button class="rail-item" data-space="${id}" aria-current="${id === S.space ? "page" : "false"}" style="--sp:var(${s.accent})" aria-label="${s.title}${a.reasons.length ? ", needs attention: " + a.reasons.join("; ") : ""}" data-hint="${s.title} · ${s.key}${a.reasons.length ? " — " + a.reasons[0] : ""}">${id === S.space ? '<span class="ind"></span>' : ""}${I(s.icon)}${n ? `<span class="att">${n}</span>` : a.reasons.length ? '<span class="att dot"></span>' : ""}</button>`; };
    return `<div class="mark" title="Stack server · 16 of 17 channels live · scrape reconnecting">S${H.dot("bad")}</div>${GROUPS.map((g) => `<div class="rail-group" role="group" aria-label="${g.label}">${g.spaces.map(item).join("")}</div>`).join('<div class="rail-sep"></div>')}
      <div class="rail-foot">${S.call ? `<button class="rail-call" data-act="call" title="On call · bot-1 · 02:14 — mute or hang up"><span class="lvl"><i style="height:4px"></i><i style="height:9px"></i><i style="height:6px"></i><i style="height:10px"></i></span>${I("phone")}<small>2:14</small></button>` : ""}
      <button class="rail-item" data-act="overview" data-hint="Overview · o" aria-label="Overview">${I("grid")}</button><button class="rail-item" data-act="help" data-hint="Keys · ?" aria-label="Keyboard shortcuts">${I("command")}</button></div>`;
  }
  function headHTML() {
    const s = SPACES[S.space], sp = cur();
    const presets = shell() === "strip" ? minimapHTML() : `<div class="seg" role="group" aria-label="Layout">${s.presets.map((p, i) => `<button aria-pressed="${i === sp.preset}" data-preset="${i}" title="${p.name} layout${i === sp.preset ? "" : " · [ ]"}">${glyph(p.tree)}${p.name}</button>`).join("")}</div>`;
    return `${S.back ? `<button class="back" data-act="back">${I("back")}${SPACES[S.back.space].title}</button>` : ""}
      <div class="sp-title">${narrow() ? `<button data-act="overview" class="sp-switch" aria-label="Spaces">` : ""}<h1>${s.title}${narrow() ? I("down") : `<span class="k">${s.key}</span>`}</h1>${narrow() ? "</button>" : ""}<p>${s.description}</p></div>
      <div class="head-tools">${S.space === "scrape" ? `<span class="sp-state" title="The scrape WebSocket closed; panes keep their last reads">${H.dot("bad")}Reconnecting · last read 40s ago</span>` : ""}${S.remote ? `<span class="sp-state remote" title="Editing controls require ui:control; sign-in, voice and browser handoff stay local">${I("lock")}Remote · view only</span>` : ""}${presets}<button class="tool" data-act="picker" title="Add or reopen a pane">${I("plus")}<span class="lbl">Pane</span></button>
      <button class="tool" data-act="palette">${I("search")}<span class="lbl">Search</span><kbd>⌘K</kbd></button>
      <button class="tool" data-act="reference" aria-pressed="${S.drawer.open && S.drawer.mode === "reference"}">${I("book")}<span class="lbl">API</span></button>
      <button class="tool" data-act="inspector" aria-pressed="${S.drawer.open && S.drawer.mode === "inspect"}" title="Inspector (i)">${I("panel")}</button></div>`;
  }
  function minimapHTML() {
    const cols = stripColumns(S.space), total = cols.reduce((a, c) => a + c.w, 0);
    const fcol = cols.findIndex((c) => c.panes.includes(cur().focus));
    return `<span class="minimap" title="Columns on this strip">${cols.map((c, i) => `<i data-mini="${i}" class="${i === fcol ? "foc" : ""}" style="width:${Math.max(6, Math.round((c.w / total) * 120))}px"></i>`).join("")}</span>`;
  }
  function statusHTML() {
    const sp = cur(), s = SPACES[S.space];
    return `<span class="sess">${I("layers")} stack</span><div class="wins">${SPACE_ORDER.map((id) => { const x = SPACES[id]; return `<button class="win" data-space="${id}" aria-current="${id === S.space ? "page" : "false"}" style="--sp:var(${x.accent})"><b>${x.key}</b>${x.title}${x.attention.n ? `<span class="a">•${x.attention.n}</span>` : x.attention.reasons.length ? '<span class="a">•</span>' : ""}</button>`; }).join("")}</div>
      <div class="mid"><span class="mode">${S.leader ? "LEADER" : sp.zoom ? "ZOOM" : "NORMAL"}</span><span>${s.presets[sp.preset].name} ${sp.preset + 1}/${s.presets.length}</span><span style="color:var(--destructive)">● 1 reconnecting</span>${S.call ? `<span class="call">${I("phone")} bot-1 02:14</span>` : ""}<span>^B ? keys</span><span>14:32</span></div>`;
  }
  function drawerHTML() {
    if (!S.drawer.open) return "";
    const ref = S.drawer.mode === "reference", sp = S.space;
    const rec = { hud: ["work-item", "Design the shell and pane grammar", [["id", "83cc2bc0-5d1e-4c1a-9f0e-1a7c2be9d4f1"], ["state", "review"], ["priority", "high"], ["attention", "human"], ["revision", "7"], ["scopeRevision", "3"], ["parentId", "1f02…"], ["labels", "design, ui, shell"]], ["work_get", "work_update", "work_note_add", "work_metadata_get"]], fleet: ["bot", "bot-1", [["id", "bot-1"], ["state", "running"], ["pid", "48211"], ["account", "codex-bot-account-1"], ["mainThreadId", "019a2c4e-…"], ["roleId", "Default"], ["roleRevision", "14"]], ["bot_get", "bot_stop", "voice_dial", "chat_main_items"]], workers: ["worker", "stack · 7f3a", [["id", "7f3a…"], ["phase", "running"], ["model", "gpt-6-sol"], ["effort", "high"], ["branch", "worktree/pane-engine"], ["baseCommit", "f89c54f"]], ["worker_get", "worker_read", "worker_diff"]] }[sp] || ["record", titleOf(cur().focus), [["id", "—"], ["kind", kind(cur().focus)]], ["read"]];
    const body = ref ? `<div class="pad"><div class="muted" style="font-size:12px">API reference › hud › work_update</div><div style="font-size:16px;font-weight:600;margin:6px 0">work_update</div>${H.chip("mutating")} ${H.chip("WebSocket · MCP")}<p style="font-size:12.5px;line-height:1.55">Edits one Work item against <span class="mono">expectedRevision</span>. A stale revision is refused; nothing is merged.</p></div>${H.sec("Input")}${H.kv([["id", '<span class="mono">string</span>'], ["expectedRevision", '<span class="mono">integer</span>'], ["patch", '<span class="mono">object</span>'], ["requestId", '<span class="mono">uuid</span>']])}${H.sec("Raw schema")}<pre class="code" style="margin:0 12px">{ "type": "object", "required": ["id", "expectedRevision", "patch", "requestId"], … }</pre>`
      : `<div class="pad"><div class="muted mono" style="font-size:11.5px">${rec[0]}</div><div style="font-size:16px;font-weight:600;margin-top:4px">${H.esc(rec[1])}</div><div class="meta">${H.btn("Show in pane", { sm: true, icon: "right" })}</div></div>${H.sec("Fields")}${H.kv(rec[2].map(([k, v]) => [`<span class="mono">${k}</span>`, `<span class="mono">${H.esc(v)}</span>`]))}${H.sec("Operations")}${rec[3].map((o) => `<div class="r compact click" data-act="reference"><span class="mono" style="font-size:12px">${o}</span><span class="m">${I("right")}</span></div>`).join("")}`;
    return `<div class="drawer-pane"><div class="pane-head" style="cursor:default"><div class="title">${ref ? "API reference" : "Inspector"}</div><div class="pane-acts">${ref ? "" : iconBtn("pin", S.drawer.pinned ? "Unpin: float over panes" : "Pin: dock as a column", `data-act="pin-drawer" style="${S.drawer.pinned ? "color:var(--foreground);background:var(--hover)" : ""}"`)}${iconBtn("x", "Close (Esc)", 'data-act="close-drawer"')}</div></div><div class="pane-body">${body}</div></div>`;
  }
  function overviewHTML() {
    return `<div id="overview"><div class="ov-head"><h2>Overview</h2><p>Every space, its current layout and what needs you. Arrows and ⏎, or a space key.</p></div><div class="ov-grid">${SPACE_ORDER.map((id, i) => { const s = SPACES[id], a = s.attention;
      return `<button class="ov-card ${id === S.space ? "cur" : ""} ${i === S.ov ? "on" : ""}" data-space="${id}" style="--sp:var(${s.accent})"><div class="top">${I(s.icon)}${s.title}<span class="kbd">${s.key}</span></div><div class="ov-mini">${mini(S.sp[id].tree, true, S.sp[id].focus)}</div><div class="ov-att ${a.reasons.length ? "" : "quiet"}">${a.reasons.length ? a.reasons.slice(0, 2).map((r) => `<span>● ${r}</span>`).join("") : "All quiet"}</div></button>`; }).join("")}</div></div>`;
  }

  function renderAll() {
    const root = document.documentElement; root.dataset.theme = S.theme; root.dataset.shell = shell();
    root.style.setProperty("--accent", `var(${SPACES[S.space].accent})`);
    const scroll = {}; $$("[data-sk]").forEach((el) => (scroll[el.dataset.sk] = el.scrollTop)); $$(".pane-body .pane-body").forEach((el) => (scroll[el.closest("[data-pane]").dataset.pane + ":in"] = el.scrollTop));
    const stripX = $("#panes")?.scrollLeft || 0;
    $("#app").innerHTML = `<nav id="rail" aria-label="Spaces">${railHTML()}</nav>
      <main id="main"><header id="head">${headHTML()}</header>${narrow() ? `<div class="pane-switch">${leaves(cur().tree).map((l) => l.p[l.a]).map((p) => `<button aria-pressed="${p === cur().focus}" data-focus="${p}">${titleOf(p)}</button>`).join("")}</div>` : ""}
      <div id="panes" class="${cur().zoom ? "zoomed" : ""}">${panesHTML()}</div>${S.overlay === "overview" ? overviewHTML() : ""}</main>
      <aside id="drawer" class="${S.drawer.open ? "open" : ""} ${S.drawer.open && !S.drawer.pinned && S.drawer.mode === "inspect" ? "float" : ""}" style="--drawer-w:${S.drawer.mode === "reference" ? 560 : 380}px">${drawerHTML()}</aside>
      <footer id="status">${statusHTML()}</footer>`;
    for (const [k, v] of Object.entries(scroll)) { if (k.endsWith(":in")) { const el = $(`[data-pane="${k.slice(0, -3)}"] .pane-body .pane-body`); if (el) el.scrollTop = v; } else { const el = $(`[data-sk="${k}"]`); if (el) el.scrollTop = v; } }
    if (shell() === "strip") $("#panes").scrollLeft = stripX;
    renderOverlay(); renderProto();
    if (S.leader) $("#panes").insertAdjacentHTML("beforeend", whichKeyHTML());
    if (loaded && !q.get("shots")) history.replaceState(null, "", `?variant=${S.variant.key}&space=${S.space}${S.theme === "dark" ? "&theme=dark" : ""}`);
    document.title = `Stack · ${SPACES[S.space].title} (prototype ${S.variant.key})`;
  }
  const whichKeyHTML = () => `<div class="whichkey"><span style="color:var(--accent);font-weight:600">⌃B</span><span><b>←↑↓→ hjkl</b>focus</span><span><b>⇧←↑↓→</b>swap</span><span><b>q</b>pane numbers</span><span><b>z</b>zoom</span><span><b>%</b>split right</span><span><b>"</b>split down</span><span><b>x</b>close</span><span><b>[ ]</b>layouts</span><span><b>0-9 h b n p s</b>spaces</span><span><b>o</b>overview</span><span><b>Esc</b>cancel</span></div>`;

  /* ───────── Overlays ───────── */
  function commands() {
    const sp = cur(), s = SPACES[S.space];
    return [
      ...SPACE_ORDER.map((id) => ({ g: "Spaces", label: `Go to ${SPACES[id].title}`, icon: SPACES[id].icon, key: SPACES[id].key, run: () => go(id) })),
      ...s.presets.map((p, i) => ({ g: `${s.title} layouts`, label: `Layout: ${p.name}`, icon: "grid", key: i === sp.preset ? "current" : "", run: () => setPreset(i) })),
      { g: "Pane", label: "Zoom focused pane", icon: "zoom", key: "z", run: () => toggleZoom(sp.focus) },
      { g: "Pane", label: "Split right…", icon: "split", key: "\\", run: () => openPicker("right") },
      { g: "Pane", label: "Split down…", icon: "splitd", key: "-", run: () => openPicker("bottom") },
      { g: "Pane", label: "Close focused pane", icon: "x", key: "x", run: () => closePane(sp.focus) },
      ...SPACE_PANES[S.space].filter((p) => !inTree(sp.tree, p)).map((p) => ({ g: "Pane", label: `Reopen ${titleOf(p)}`, icon: def(p).icon, run: () => addPane(p, "right") })),
      { g: "Records", label: "bot-1", icon: "bot", run: () => navigate("fleet|bots|fleet.bot=bot-1") },
      { g: "Records", label: "stack · 7f3a (Worker)", icon: "hammer", run: () => navigate("workers|worker|workers.sel=7f3a") },
      { g: "Records", label: "Approve the pane migration plan?", icon: "bell", run: () => navigate("inbox|notify-detail|inbox.sel=n41") },
      { g: "Records", label: "#80 pull_request.synchronize", icon: "json", run: () => navigate("source|source-delivery|source.del=80") },
      { g: "Shell", label: "Overview", icon: "grid", key: "o", run: () => toggleOverlay("overview") },
      { g: "Shell", label: "Open API reference", icon: "book", run: () => openDrawer("reference") },
      { g: "Shell", label: "Keyboard shortcuts", icon: "command", key: "?", run: () => toggleOverlay("help") },
    ];
  }
  function renderOverlay() {
    let el = $("#overlay"); if (!el) { el = document.createElement("div"); el.id = "overlay"; document.body.append(el); }
    const o = S.overlay;
    if (o === "palette") {
      const items = commands().filter((c) => c.label.toLowerCase().includes(S.pal.q.toLowerCase())); S.pal.i = Math.min(S.pal.i, Math.max(0, items.length - 1));
      let g = ""; el.innerHTML = `<div class="scrim" data-act="close-overlay"></div><div class="palette" role="dialog" aria-label="Command palette"><div class="q">${I("search")}<input id="palq" placeholder="Go to a space, record, layout or pane command…" value="${H.esc(S.pal.q)}" autocomplete="off"></div><div class="list">${items.map((c, i) => `${c.g !== g ? `<div class="grp">${(g = c.g)}</div>` : ""}<div class="it ${i === S.pal.i ? "on" : ""}" data-pal="${i}">${I(c.icon)}${c.label}${c.key ? `<span class="kbd">${c.key}</span>` : ""}</div>`).join("")}</div></div>`;
      el._items = items; const inp = $("#palq"); inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length);
    } else if (o === "help") {
      const k = (a, b) => `<div class="k"><span>${a}</span><span>${b}</span></div>`;
      el.innerHTML = `<div class="scrim" data-act="close-overlay"></div><div class="help" role="dialog" aria-label="Keyboard shortcuts"><h2>Keys</h2><p>Single keys work whenever focus is not in a text field (Esc leaves one). ⌃B is a tmux-style leader that works everywhere.</p><div class="cols">
        <h3>Places</h3>${k("Spaces", '<span class="kbd">h</span> <span class="kbd">1</span>–<span class="kbd">0</span> <span class="kbd">b</span> <span class="kbd">n</span> <span class="kbd">p</span> <span class="kbd">s</span>')}${k("Overview", '<span class="kbd">o</span>')}${k("Command palette", '<span class="kbd">⌘K</span>')}${k("Back to where a link came from", '<span class="kbd">⌘[</span>')}
        <h3>Panes</h3>${k("Focus pane", '<span class="kbd">⌥</span> + arrows')}${k("Swap with neighbour", '<span class="kbd">⌥⇧</span> + arrows')}${k("Zoom / restore", '<span class="kbd">z</span>')}${k("Close (undo in toast)", '<span class="kbd">x</span>')}${k("Split right / down", '<span class="kbd">\\</span> <span class="kbd">-</span>')}${k("Next / previous layout", '<span class="kbd">]</span> <span class="kbd">[</span>')}
        <h3>Tools</h3>${k("Inspector", '<span class="kbd">i</span>')}${k("Close overlay, restore zoom", '<span class="kbd">Esc</span>')}${k("This sheet", '<span class="kbd">?</span>')}${k("Leader, then a key", '<span class="kbd">⌃B</span>')}
        <h3>Pointer</h3>${k("Move a pane", "drag its title onto an edge or centre")}${k("Resize", "drag a gap · double-click to even out")}</div></div>`;
    } else if (o === "picker") {
      const missing = SPACE_PANES[S.space].filter((p) => !inTree(cur().tree, p));
      const dyn = { fleet: ["chat", "Pinned chat pane"], workers: ["worker", "Pinned Worker pane"], browse: ["viewer", "Pinned viewer"], proc: ["proc-run", "Pinned run pane"] }[S.space];
      el.innerHTML = `<div class="scrim" data-act="close-overlay" style="background:transparent;backdrop-filter:none"></div><div class="menu" style="top:${S.menuPos?.y || 60}px;left:${S.menuPos?.x || 400}px"><div class="lbl">${S.pickSide === "bottom" ? "Split down with" : "Open beside the focused pane"}</div>${missing.length ? missing.map((p) => `<button data-pick="${p}">${I(def(p).icon)}${titleOf(p)}${inst(p) ? ` <span class="muted">${inst(p)}</span>` : ""}</button>`).join("") : '<div class="lbl" style="text-transform:none;letter-spacing:0;font-weight:400">Every pane of this space is open.</div>'}${dyn ? `<hr><button data-pick="${dyn[0]}:new">${I("pin")}${dyn[1]}…</button>` : ""}</div>`;
    } else if (o === "menu") {
      const id = S.menu; const d = def(id);
      el.innerHTML = `<div class="scrim" data-act="close-overlay" style="background:transparent;backdrop-filter:none"></div><div class="menu" style="top:${S.menuPos.y}px;left:${S.menuPos.x - 220}px"><div class="lbl" style="text-transform:none;letter-spacing:0">${H.dot("ok")} Live · read 2s ago · ws://127.0.0.1:8743</div><hr>
        <button data-m="zoom">${I("zoom")}Zoom<span class="kbd">z</span></button><button data-m="right">${I("split")}Split right…<span class="kbd">\\</span></button><button data-m="bottom">${I("splitd")}Split down…<span class="kbd">-</span></button>
        ${["chat", "worker", "viewer", "proc-run"].includes(kind(id)) ? `<button data-m="pin">${I("pin")}${inst(id) ? "Follow the selection" : "Pin to this record"}</button>` : ""}${d.node || recOf(id) ? `<button data-m="inspect">${I("panel")}Inspect<span class="kbd">i</span></button>` : ""}<hr><button data-m="close">${I("x")}Close pane<span class="kbd">x</span></button></div>`;
    } else el.innerHTML = "";
    if (S.toast) el.insertAdjacentHTML("beforeend", `<div class="toast" role="status">${S.toast.text}${S.toast.undo ? ' <button data-act="undo">Undo</button>' : ""}</div>`);
  }
  function renderProto() {
    let el = $("#proto"); if (!el) { el = document.createElement("div"); el.id = "proto"; document.body.append(el); }
    el.innerHTML = `<div class="proto" role="toolbar" aria-label="Prototype controls"><button data-p="prev" aria-label="Previous shell">${I("left")}</button><span class="lbl">${S.variant.key} · ${S.variant.name}<small>shell ${VARIANTS.indexOf(S.variant) + 1}/3</small></span><button data-p="next" aria-label="Next shell">${I("right")}</button><span class="sep"></span>
      <button data-p="theme" aria-label="Theme">${I(S.theme === "dark" ? "sun" : "moon")}</button><button data-p="call" aria-pressed="${S.call}" aria-label="Simulated call">${I("phone")}</button><button data-p="notes" aria-pressed="${S.notes}">${I("info")} Notes</button></div>
      <div class="proto-tag">Prototype · synthetic data</div>
      ${S.notes ? `<div class="notes"><h3>${SPACES[S.space].title} — design notes</h3><p>${SPACES[S.space].notes}</p><h4>Shell ${S.variant.key} · ${S.variant.name}</h4><p>${S.variant.about}</p></div>` : ""}`;
  }

  /* ───────── Actions ───────── */
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  /* A newer transition skips the running one; only the latest may clear the naming flags, or rapid navigation loses its morph. */
  let vtToken = 0;
  function transition(kind, update, dir = 0) {
    if (!document.startViewTransition || reduced || kind === "none") { update(); return; }
    const app = $("#app"), html = document.documentElement, token = ++vtToken;
    app.dataset.vt = kind; html.classList.toggle("vt-down", dir > 0); html.classList.toggle("vt-up", dir < 0);
    const t = document.startViewTransition(() => { update(); $("#app").dataset.vt = kind; });
    t.finished.finally(() => { if (token !== vtToken) return; delete $("#app").dataset.vt; html.classList.remove("vt-down", "vt-up"); });
  }
  function go(space, opts = {}) {
    if (space === S.space && !opts.force) { S.overlay = null; renderAll(); return; }
    const from = S.space, dir = Math.sign(SPACE_ORDER.indexOf(space) - SPACE_ORDER.indexOf(from));
    const kindT = shell() === "tiles" ? "space" : shell() === "strip" ? "slide" : "none";
    if (!opts.keepBack) S.back = opts.back ? { space: from } : null;
    transition(S.overlay === "overview" ? "none" : kindT, () => { S.space = space; S.overlay = null; S.ov = SPACE_ORDER.indexOf(space); renderAll(); }, dir);
  }
  function navigate(spec) {
    const [space, pane, sel] = spec.split("|"), back = space !== S.space;
    if (sel) { const [k, v] = sel.split("="); S.sel[k] = isNaN(+v) || v === "" ? v : +v; }
    const finish = () => {
      const sp = cur(); let target = pane && SPACE_PANES[space].includes(pane) ? pane : null;
      if (target && !inTree(sp.tree, target)) { const hit = findLeaf(sp.tree, sp.focus); sp.tree = insertPane(sp.tree, sp.focus, "right", target); }
      if (target) { const hit = findLeaf(sp.tree, target); if (hit) hit.leaf.a = hit.leaf.p.indexOf(target); sp.focus = target; if (sp.zoom && sp.zoom !== target) sp.zoom = null; }
      renderAll();
      requestAnimationFrame(() => { const p = $(`[data-pane="${sp.focus}"]`); p?.classList.add("flash"); const v = sel?.split("=")[1]; const row = v && $(`[data-pane="${sp.focus}"] [data-row="${v}"]`); if (row) { row.classList.add("flash"); row.scrollIntoView({ block: "nearest" }); } if (shell() === "strip") p?.closest('.cell[data-col]')?.scrollIntoView({ inline: "nearest", behavior: "smooth" }); });
    };
    if (back) { S.back = { space: S.space }; const from = S.space; const dir = Math.sign(SPACE_ORDER.indexOf(space) - SPACE_ORDER.indexOf(from)); transition(shell() === "tiles" ? "space" : shell() === "strip" ? "slide" : "none", () => { S.space = space; S.overlay = null; finish(); }, dir); }
    else finish();
  }
  function setPreset(i) { transition("pane", () => { setPresetRaw(S.space, i); renderAll(); }); }
  function toggleZoom(id) { const sp = cur(); transition("pane", () => { sp.zoom = sp.zoom ? null : id || sp.focus; if (sp.zoom) sp.focus = sp.zoom; renderAll(); }); }
  function closePane(id) {
    const sp = cur(); if (!id) return; const before = clone(sp.tree);
    if (shell() === "strip") { transition("pane", () => { sp.closed.push(id); renderAll(); }); toast(`Closed ${titleOf(id)}`, () => { sp.closed = sp.closed.filter((x) => x !== id); renderAll(); }); return; }
    if (leaves(sp.tree).length === 1 && findLeaf(sp.tree, id)?.leaf.p.length === 1) { toast("A space keeps at least one pane"); return; }
    transition("pane", () => { sp.tree = removePane(sp.tree, id); if (sp.zoom === id) sp.zoom = null; if (sp.focus === id) sp.focus = firstPane(sp.tree); renderAll(); });
    toast(`Closed ${titleOf(id)} — reopen it from + Pane`, () => transition("pane", () => { sp.tree = before; sp.focus = id; renderAll(); }));
  }
  function addPane(id, side = "right") {
    const sp = cur(); if (id.endsWith(":new")) { const k = id.split(":")[0]; const pick = { chat: "chat:bot-2", worker: "worker:19c2", viewer: "viewer:bot-1-default", "proc-run": "proc-run:r-9030" }[k]; id = inTree(sp.tree, pick) ? `${pick}` : pick; }
    if (inTree(sp.tree, id)) { sp.focus = id; renderAll(); return; }
    transition("pane", () => { sp.tree = insertPane(sp.tree, sp.focus, side, id); sp.focus = id; sp.zoom = null; S.overlay = null; renderAll(); });
  }
  function openPicker(side, anchor) { S.pickSide = side; const r = anchor?.getBoundingClientRect() || $(`[data-pane="${cur().focus}"]`)?.getBoundingClientRect(); S.menuPos = r ? { x: Math.min(r.left, innerWidth - 240), y: r.bottom + 6 } : { x: 300, y: 80 }; S.overlay = "picker"; renderOverlay(); }
  function openDrawer(mode) { transition("pane", () => { S.drawer = { ...S.drawer, open: true, mode }; renderAll(); }); }
  function toggleOverlay(name) { S.overlay = S.overlay === name ? null : name; S.pal = { q: "", i: 0 }; S.ov = SPACE_ORDER.indexOf(S.space); if (name === "overview") transition("none", renderAll); else renderOverlay(); }
  function toast(text, undo) { S.toast = { text, undo }; renderOverlay(); clearTimeout(toast.t); toast.t = setTimeout(() => { S.toast = null; renderOverlay(); }, 4200); }
  function setFocus(id) { const sp = cur(); if (sp.focus === id) return; sp.focus = id; $$(".pane.focus").forEach((p) => p.classList.remove("focus")); $(`[data-pane="${id}"]`)?.classList.add("focus"); if (shell() === "strip") { $(`[data-pane="${id}"]`)?.closest('.cell[data-col]')?.scrollIntoView({ inline: "nearest", behavior: "smooth", block: "nearest" }); const mm = $(".minimap"); if (mm) mm.outerHTML = minimapHTML(); } if (narrow()) renderAll(); }
  function neighbour(dir) {
    const from = $(`[data-pane="${cur().focus}"]`); if (!from) return null; const a = from.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best = null, bd = Infinity;
    for (const el of $$("#panes .pane")) { if (el === from) continue; const b = el.getBoundingClientRect(); const bx = b.left + b.width / 2, by = b.top + b.height / 2;
      const ok = dir === "left" ? b.right <= a.left + 2 : dir === "right" ? b.left >= a.right - 2 : dir === "up" ? b.bottom <= a.top + 2 : b.top >= a.bottom - 2; if (!ok) continue;
      const overlap = dir === "left" || dir === "right" ? Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) : Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const d = Math.hypot(bx - ax, by - ay) - (overlap > 0 ? 10000 : 0); if (d < bd) { bd = d; best = el.dataset.pane; } }
    return best;
  }
  function focusDir(dir) { const n = neighbour(dir); if (n) setFocus(n); }
  function swapDir(dir) {
    const sp = cur(), n = neighbour(dir); if (!n || shell() === "strip") return;
    const a = findLeaf(sp.tree, sp.focus), b = findLeaf(sp.tree, n); if (!a || !b) return;
    transition("pane", () => { a.leaf.p[a.leaf.a] = n; b.leaf.p[b.leaf.a] = sp.focus; renderAll(); });
  }

  /* ───────── Pointer: drag-to-dock and divider resize ───────── */
  let drag = null;
  document.addEventListener("pointerdown", (e) => {
    const paneEl = e.target.closest("#panes .pane"); if (paneEl) setFocus(paneEl.dataset.pane);
    const dv = e.target.closest(".divider[data-split]");
    if (dv) { e.preventDefault(); const node = SPLITS[+dv.dataset.split], i = +dv.dataset.i, splitEl = dv.parentElement, horiz = node.t === "row";
      const cells = [...splitEl.children].filter((c) => c.classList.contains("cell")); const total = node.c.reduce((a, c) => a + c.s, 0); const px = horiz ? splitEl.clientWidth : splitEl.clientHeight;
      drag = { type: "resize", node, i, horiz, cells, total, px, x: e.clientX, y: e.clientY, a: node.c[i].s, b: node.c[i + 1].s, dv }; dv.classList.add("drag"); dv.setPointerCapture(e.pointerId); return; }
    const head = e.target.closest("#panes .pane-head"); if (!head || e.target.closest("button:not([data-tab]), .views, input") || shell() === "strip") return;
    const tab = e.target.closest("[data-tab]");
    drag = { type: "pending", id: tab ? tab.dataset.tab : head.dataset.drag, x: e.clientX, y: e.clientY, title: e.target.closest("[data-title]") };
  });
  document.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (drag.type === "resize") { const d = ((drag.horiz ? e.clientX - drag.x : e.clientY - drag.y) / drag.px) * drag.total; const min = drag.total * 0.1;
      const a = Math.max(min, Math.min(drag.a + d, drag.a + drag.b - min)), b = drag.a + drag.b - a; drag.cells[drag.i].style.flex = `${a} 1 0`; drag.cells[drag.i + 1].style.flex = `${b} 1 0`; drag.na = a; drag.nb = b; return; }
    if (drag.type === "pending" && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) { drag.type = "move"; document.body.insertAdjacentHTML("beforeend", `<div class="drag-ghost">${titleOf(drag.id)}</div><div class="drop" style="display:none"></div>`); document.body.style.cursor = "grabbing"; }
    if (drag.type !== "move") return;
    const ghost = $(".drag-ghost"), drop = $(".drop"); ghost.style.left = e.clientX + "px"; ghost.style.top = e.clientY + "px";
    const under = document.elementFromPoint(e.clientX, e.clientY)?.closest("#panes .pane"); if (!under) { drop.style.display = "none"; drag.target = null; return; }
    const r = under.getBoundingClientRect(), fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    let side = "center"; const m = Math.min(fx, 1 - fx, fy, 1 - fy); if (m < 0.28) side = m === fx ? "left" : m === 1 - fx ? "right" : m === fy ? "top" : "bottom";
    if (under.dataset.pane === drag.id && side === "center") { drop.style.display = "none"; drag.target = null; return; }
    const box = { left: r.left, top: r.top, width: r.width, height: r.height }; if (side === "left") box.width /= 2; if (side === "right") { box.left += r.width / 2; box.width /= 2; } if (side === "top") box.height /= 2; if (side === "bottom") { box.top += r.height / 2; box.height /= 2; }
    Object.assign(drop.style, { display: "block", left: box.left + "px", top: box.top + "px", width: box.width + "px", height: box.height + "px", position: "fixed" });
    drag.target = { pane: under.dataset.pane, side };
  });
  document.addEventListener("pointerup", (e) => {
    if (!drag) return; const d = drag; drag = null;
    if (d.type === "resize") { d.dv.classList.remove("drag"); if (d.na) { d.node.c[d.i].s = d.na; d.node.c[d.i + 1].s = d.nb; } return; }
    if (d.type === "pending") { if (d.title && !e.target.closest("button")) { const id = d.title.dataset.title; if (def(id)?.node || recOf(id)) { setFocus(id); openDrawer("inspect"); } } return; }
    $(".drag-ghost")?.remove(); $(".drop")?.remove(); document.body.style.cursor = "";
    if (!d.target) return; const sp = cur();
    transition("pane", () => { let t = removePane(clone(sp.tree), d.id); if (!inTree(t, d.target.pane)) t = sp.tree; sp.tree = insertPane(t, d.target.pane, d.target.side, d.id); sp.focus = d.id; renderAll(); });
  });
  document.addEventListener("dblclick", (e) => { const dv = e.target.closest(".divider[data-split]"); if (!dv) return; const node = SPLITS[+dv.dataset.split]; transition("pane", () => { node.c.forEach((c) => (c.s = 1)); renderAll(); }); });

  /* ───────── Clicks ───────── */
  document.addEventListener("click", (e) => {
    const t = e.target;
    const p = t.closest("[data-p]"); if (p) { const a = p.dataset.p; if (a === "prev" || a === "next") { cycleVariant(a === "next" ? 1 : -1); } if (a === "theme") { S.theme = S.theme === "dark" ? "light" : "dark"; renderAll(); } if (a === "call") { S.call = !S.call; renderAll(); } if (a === "notes") { S.notes = !S.notes; renderProto(); } return; }
    const pk = t.closest("[data-pick]"); if (pk) { S.overlay = null; addPane(pk.dataset.pick, S.pickSide || "right"); return; }
    const pal = t.closest("[data-pal]"); if (pal) { const c = $("#overlay")._items[+pal.dataset.pal]; S.overlay = null; renderOverlay(); c.run(); return; }
    const m = t.closest("[data-m]"); if (m) { const id = S.menu, a = m.dataset.m; S.overlay = null; renderOverlay(); if (a === "zoom") toggleZoom(id); if (a === "close") closePane(id); if (a === "right" || a === "bottom") { setFocus(id); openPicker(a); } if (a === "inspect") openDrawer("inspect"); if (a === "pin") toast(inst(id) ? "This pane now follows the selection" : "Pinned: this pane keeps its record"); return; }
    const sp = t.closest("[data-space]"); if (sp) { go(sp.dataset.space); return; }
    const pr = t.closest("[data-preset]"); if (pr) { setPreset(+pr.dataset.preset); return; }
    const tab = t.closest("[data-tab]"); if (tab && !drag) { const id = tab.dataset.tab, hit = findLeaf(cur().tree, id); if (hit) { hit.leaf.a = hit.leaf.p.indexOf(id); cur().focus = id; renderAll(); } return; }
    const v = t.closest("[data-view]"); if (v) { const [id, i] = v.dataset.view.split("="); S.views[id] = +i; renderAll(); return; }
    const gt = t.closest("[data-goto]"); if (gt) { e.preventDefault(); navigate(gt.dataset.goto); return; }
    const sl = t.closest("[data-sel]"); if (sl && !t.closest("button")) { const [k, val] = sl.dataset.sel.split("=");
      /* ⌘/Ctrl-click opens a pinned pane that keeps this record, beside the focused pane. */
      const pin = (e.metaKey || e.ctrlKey) && { "fleet.bot": "chat", "workers.sel": "worker", "proc.run": "proc-run" }[k]; if (pin) { addPane(`${pin}:${val}`, "right"); return; }
      S.sel[k] = isNaN(+val) ? val : +val; renderAll(); return; }
    const f = t.closest("[data-focus]"); if (f) { cur().focus = f.dataset.focus; renderAll(); return; }
    const mi = t.closest("[data-mini]"); if (mi) { const col = stripColumns(S.space)[+mi.dataset.mini]; setFocus(col.panes[0]); return; }
    const act = t.closest("[data-act]"); if (!act) return; const a = act.dataset.act;
    if (a === "zoom") toggleZoom(act.dataset.paneId);
    if (a === "menu") { S.menu = act.dataset.paneId; const r = act.getBoundingClientRect(); S.menuPos = { x: r.right, y: r.bottom + 4 }; S.overlay = "menu"; renderOverlay(); }
    if (a === "picker") openPicker("right", act);
    if (a === "palette") toggleOverlay("palette");
    if (a === "overview") toggleOverlay("overview");
    if (a === "help") toggleOverlay("help");
    if (a === "close-overlay") { S.overlay = null; renderOverlay(); }
    if (a === "reference") { if (S.drawer.open && S.drawer.mode === "reference") transition("pane", () => { S.drawer.open = false; renderAll(); }); else openDrawer("reference"); }
    if (a === "inspector") { if (S.drawer.open && S.drawer.mode === "inspect") transition("pane", () => { S.drawer.open = false; renderAll(); }); else openDrawer("inspect"); }
    if (a === "close-drawer") transition("pane", () => { S.drawer.open = false; renderAll(); });
    if (a === "pin-drawer") transition("pane", () => { S.drawer.pinned = !S.drawer.pinned; renderAll(); });
    if (a === "back") { const b = S.back; S.back = null; if (b) go(b.space, { keepBack: true }); }
    if (a === "undo") { const u = S.toast?.undo; S.toast = null; renderOverlay(); u?.(); }
    if (a === "compose") { const sp2 = cur(); const hit = findLeaf(sp2.tree, "notify-compose"); if (hit) { hit.leaf.a = hit.leaf.p.indexOf("notify-compose"); sp2.focus = "notify-compose"; renderAll(); } else addPane("notify-compose"); }
    if (a === "newpane") { const id = act.closest("[data-pane]").dataset.pane; addPane(`${kind(id)}:new`, "right"); }
    if (a === "pin") toast("Pinned: this pane keeps its record when the list selection changes");
    if (a === "call") toast("Call controls live here: mute, hang up, open the call’s Bot");
  });
  /* Unpinned inspector floats and contracts on outside input, as the pinnable dock does today. */
  document.addEventListener("click", (e) => { if (S.drawer.open && !S.drawer.pinned && S.drawer.mode === "inspect" && e.target.closest("#panes") && !e.target.closest("[data-title]")) { S.drawer.open = false; renderAll(); } }, true);

  function cycleVariant(d) { const i = (VARIANTS.indexOf(S.variant) + d + VARIANTS.length) % VARIANTS.length; S.variant = VARIANTS[i]; if (S.leader) S.leader = false; renderAll(); }

  /* ───────── Keys ───────── */
  const ARROWS = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
  document.addEventListener("keydown", (e) => {
    const typing = e.target.closest?.("input, textarea, [contenteditable]");
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); toggleOverlay("palette"); return; }
    if (e.ctrlKey && e.key.toLowerCase() === "b") { e.preventDefault(); S.leader = !S.leader; renderAll(); return; }
    if (S.overlay === "palette") {
      const items = $("#overlay")._items || [];
      if (e.key === "Escape") { S.overlay = null; renderOverlay(); }
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); S.pal.i = (S.pal.i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; renderOverlay(); }
      else if (e.key === "Enter") { const c = items[S.pal.i]; S.overlay = null; renderOverlay(); c?.run(); }
      return;
    }
    if (S.paneNums && !S.leader) {
      e.preventDefault(); S.paneNums = false; const n = +e.key;
      if (n >= 1) { const target = $$("#panes .pane")[n - 1]; if (target) cur().focus = target.dataset.pane; }
      renderAll(); return;
    }
    if (S.leader) {
      e.preventDefault(); S.leader = false; const k = e.key;
      if (k === "q") { S.paneNums = true; renderAll(); return; }
      if (ARROWS[k]) { e.shiftKey ? swapDir(ARROWS[k]) : focusDir(ARROWS[k]); renderAll(); return; }
      const hjkl = { h: "left", j: "down", k: "up", l: "right" }[k]; if (hjkl) { focusDir(hjkl); renderAll(); return; }
      if (k === "z") return toggleZoom(); if (k === "x") return closePane(cur().focus); if (k === "%") return openPicker("right"); if (k === '"') return openPicker("bottom");
      if (k === "o") return toggleOverlay("overview"); if (k === "[" || k === "]") return setPreset(cur().preset + (k === "]" ? 1 : -1));
      const sp = SPACE_ORDER.find((id) => SPACES[id].key === k); if (sp) return go(sp);
      renderAll(); return;
    }
    if (S.overlay === "overview") {
      const cols = 5; if (e.key === "Escape" || e.key === "o") { S.overlay = null; renderAll(); return; }
      if (ARROWS[e.key]) { e.preventDefault(); S.ov = Math.max(0, Math.min(SPACE_ORDER.length - 1, S.ov + ({ left: -1, right: 1, up: -cols, down: cols }[ARROWS[e.key]]))); renderAll(); return; }
      if (e.key === "Enter") { go(SPACE_ORDER[S.ov]); return; }
    }
    if (e.key === "Escape") { if (S.overlay) { S.overlay = null; renderOverlay(); return; } if (typing) { e.target.blur(); return; } if (cur().zoom) return toggleZoom(); if (S.drawer.open) { transition("pane", () => { S.drawer.open = false; renderAll(); }); } return; }
    if (typing) return;
    if (e.altKey && ARROWS[e.key]) { e.preventDefault(); e.shiftKey ? swapDir(ARROWS[e.key]) : focusDir(ARROWS[e.key]); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k === "ArrowLeft" || k === "ArrowRight") { cycleVariant(k === "ArrowRight" ? 1 : -1); return; }
    if (k === "z") return toggleZoom(); if (k === "o") return toggleOverlay("overview"); if (k === "?") return toggleOverlay("help");
    if (k === "[" || k === "]") return setPreset(cur().preset + (k === "]" ? 1 : -1));
    if (k === "x") return closePane(cur().focus); if (k === "\\") return openPicker("right"); if (k === "-") return openPicker("bottom");
    if (k === "i") { if (S.drawer.open) transition("pane", () => { S.drawer.open = false; renderAll(); }); else openDrawer("inspect"); return; }
    const sp = SPACE_ORDER.find((id) => SPACES[id].key === k); if (sp) go(sp);
  });
  /* Weave: hovering a link that leaves this space lights the destination in the rail before you go. */
  document.addEventListener("mouseover", (e) => { const g = e.target.closest?.("[data-goto]"); $$(".rail-item.dest").forEach((el) => el.classList.remove("dest")); if (!g) return; const sp = g.dataset.goto.split("|")[0]; if (sp !== S.space) $(`.rail-item[data-space="${sp}"]`)?.classList.add("dest"); });
  document.addEventListener("input", (e) => { if (e.target.id === "palq") { S.pal.q = e.target.value; S.pal.i = 0; renderOverlay(); } });
  addEventListener("resize", () => { clearTimeout(renderAll.t); renderAll.t = setTimeout(renderAll, 80); });

  window.PROTO = { S, renderAll, go, navigate, setPreset, toggleZoom, insertPane, removePane };
  let loaded = false;
  addEventListener("load", () => { loaded = true; });
  renderAll();
  /* Screenshot hooks: ?demo=<space> or ?demo=preset:<n> / zoom:<pane> / drawer starts a (slowed) transition 300ms after load. */
  if (q.get("demo")) setTimeout(() => { const d = q.get("demo"); if (d.startsWith("preset:")) setPreset(+d.slice(7)); else if (d.startsWith("zoom:")) toggleZoom(d.slice(5)); else if (d === "drawer") openDrawer("inspect"); else if (d.startsWith("goto:")) navigate(d.slice(5)); else go(d); }, 300);
})();
