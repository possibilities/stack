import { filterTree, split, tabs, type PaneNode } from "./pane-layout";
import type { SpaceId } from "./spaces";

type Part = string | PaneNode;
const node = (value: Part) => typeof value === "string" ? tabs(value) : value;
const row = (...children: [Part, number][]) => split("x", ...children.map(([child, weight]): [PaneNode, number] => [node(child), weight]));
const column = (...children: [Part, number][]) => split("y", ...children.map(([child, weight]): [PaneNode, number] => [node(child), weight]));
export type PanePreset = { id: string; title: string; build(ids: readonly string[]): PaneNode | null };
const preset = (id: string, title: string, tree: PaneNode | ((ids: readonly string[]) => PaneNode)): PanePreset => ({ id, title, build: (ids) => filterTree(typeof tree === "function" ? tree(ids) : tree, new Set(ids)) });
const compare = (list: string, kind: string, ids: readonly string[]) => {
  const instances = ids.filter((id) => id === kind || id.startsWith(`${kind}-`));
  return row([list, 0.25], [instances.length ? row(...instances.map((id): [Part, number] => [id, 1])) : tabs(kind), 0.75]);
};

export const spaceGroups: { title: string; spaces: SpaceId[] }[] = [
  { title: "Work", spaces: ["hud", "inbox", "signal"] },
  { title: "Agents", spaces: ["fleet", "workers", "roles", "accounts", "browse"] },
  { title: "Knowledge", spaces: ["content", "brain", "scrape"] },
  { title: "Machine", spaces: ["proc", "source", "system", "lab"] },
];

export const panePresets: Record<SpaceId, PanePreset[]> = {
  hud: [
    preset("triage", "Triage", row([column(["hud-attention", 0.42], ["hud-work", 0.58]), 0.3], ["hud-item", 0.38], [column(["hud-timeline", 0.58], ["hud-resources", 0.42]), 0.32])),
    preset("focus", "Focus", row(["hud-work", 0.27], ["hud-item", 0.43], [tabs("hud-timeline", "hud-resources", "hud-attention"), 0.3])),
    preset("board", "Board", column(["hud-attention", 0.38], [row(["hud-work", 0.34], ["hud-item", 0.38], [tabs("hud-timeline", "hud-resources"), 0.28]), 0.62])),
  ],
  fleet: [
    preset("chat", "Chat", row([tabs("bots", "bot-state"), 0.28], ["chat", 0.72])),
    preset("tiled", "Tiled chats", (ids) => compare("bots", "chat", ids)),
    preset("state", "State", row(["bots", 0.32], ["bot-state", 0.68])),
    preset("history", "History", row([tabs("bots", "bot-state"), 0.24], ["bot-history", 0.76])),
  ],
  workers: [
    preset("follow", "Follow", row([column(["workers", 0.74], ["worker-runtimes", 0.26]), 0.3], ["worker", 0.7])),
    preset("compare", "Compare", (ids) => compare("workers", "worker", ids.filter((id) => id !== "worker-runtimes"))),
  ],
  inbox: [
    preset("mail", "Mail", row(["notify-inbox", 0.37], [tabs("notify-detail", "notify-compose"), 0.63])),
    preset("below", "Reading pane below", column(["notify-inbox", 0.46], [tabs("notify-detail", "notify-compose"), 0.54])),
    preset("three-up", "Three-up", row(["notify-inbox", 0.32], ["notify-detail", 0.38], ["notify-compose", 0.3])),
  ],
  signal: [
    preset("attention", "Attention", row(["signal", 0.24], ["attention", 0.43], [tabs("attention-messages", "attention-runs", "attention-changes"), 0.33])),
    preset("trace", "Trace", row([tabs("attention", "signal"), 0.3], ["attention-runs", 0.42], [tabs("attention-messages", "attention-changes"), 0.28])),
    preset("operate", "Operate", row(["signal", 0.34], [column(["attention-runs", 0.56], ["attention-changes", 0.44]), 0.66])),
  ],
  accounts: [
    preset("overview", "Overview", row(["accounts", 0.34], ["usage", 0.36], ["model-catalogs", 0.3])),
    preset("usage", "Usage", column(["usage", 0.56], [row(["accounts", 0.5], ["model-catalogs", 0.5]), 0.44])),
  ],
  roles: [
    preset("editor", "Editor", row([column(["role-catalog", 0.32], [tabs("role-instructions", "role-skills", "role-mcp-servers", "role-projects"), 0.68]), 0.26], ["role-editor", 0.42], [tabs("role-preview", "role-shims"), 0.32])),
    preset("resources", "Resources", row(["role-catalog", 0.22], [column(["role-skills", 0.3], ["role-mcp-servers", 0.44], ["role-projects", 0.26]), 0.34], ["role-editor", 0.44])),
    preset("review", "Review", row(["role-instructions", 0.36], ["role-preview", 0.64])),
  ],
  browse: [
    preset("handoff", "Handoff", row([column(["browse-handoffs", 0.38], [tabs("browse-profiles", "browse-browsers", "browse-controllers", "browse-toolchain"), 0.62]), 0.27], ["browse-viewer", 0.73])),
    preset("watch", "Watch", (ids) => compare("browse-handoffs", "browse-viewer", ids)),
    preset("browsers", "Browsers", row([column(["browse-browsers", 0.68], ["browse-toolchain", 0.32]), 0.34], ["browse-viewer", 0.66])),
    preset("manage", "Manage", row([column(["browse-handoffs", 0.5], ["browse-controllers", 0.5]), 0.33], [column(["browse-browsers", 0.5], ["browse-profiles", 0.5]), 0.33], [tabs("browse-toolchain", "browse-extensions"), 0.34])),
    preset("passwords", "Passwords", row([tabs("browse-password-manager", "browse-extensions"), 0.36], [column(["browse-handoffs", 0.45], [tabs("browse-browsers", "browse-profiles"), 0.55]), 0.24], ["browse-viewer", 0.4])),
  ],
  content: [
    preset("write", "Write", row([tabs("content-documents", "content-library", "content-artifacts", "content-storage"), 0.26], ["content-editor", 0.4], ["content-preview", 0.34])),
    preset("library", "Library", row([column(["content-library", 0.6], ["content-artifacts", 0.4]), 0.56], [tabs("content-preview", "content-documents"), 0.44])),
    preset("read", "Read", row(["content-documents", 0.3], ["content-preview", 0.7])),
  ],
  brain: [
    preset("research", "Research", row(["brain-search", 0.33], ["brain-reader", 0.42], [tabs("brain-jobs", "brain-ingest", "brain-sources"), 0.25])),
    preset("read", "Read", row(["brain-search", 0.3], ["brain-reader", 0.7])),
    preset("ingestion", "Ingestion", row(["brain-ingest", 0.26], ["brain-jobs", 0.44], ["brain-sources", 0.3])),
  ],
  scrape: [
    preset("workbench", "Workbench", row([tabs("scrape-extract", "scrape-feeds", "scrape-convert"), 0.54], [column(["scrape-queue", 0.5], [tabs("scrape-presets", "scrape-checks", "scrape-status"), 0.5]), 0.46])),
    preset("health", "Health", column([row(["scrape-presets", 0.5], ["scrape-checks", 0.5]), 0.62], [row(["scrape-status", 0.5], ["scrape-queue", 0.5]), 0.38])),
  ],
  proc: [
    preset("runs", "Runs", column([row([tabs("proc-runs", "proc-schedules"), 0.27], ["proc-run", 0.45], ["proc-schedule", 0.28]), 0.66], ["proc-timeline", 0.34])),
    preset("schedules", "Schedules", column([row(["proc-schedules", 0.34], ["proc-schedule", 0.66]), 0.6], ["proc-timeline", 0.4])),
    preset("logs", "Logs", (ids) => compare("proc-runs", "proc-run", ids.filter((id) => id !== "proc-runs"))),
  ],
  source: [
    preset("ledger", "Ledger", row([tabs("source-receivers", "source-catalog"), 0.25], ["source-deliveries", 0.37], ["source-delivery", 0.38])),
    preset("watches", "Watches", row(["source-watches", 0.42], [tabs("source-delivery", "source-deliveries"), 0.58])),
    preset("setup", "Setup", row(["source-receivers", 0.55], ["source-catalog", 0.45])),
  ],
  system: [
    preset("health", "Health", row([column(["server", 0.56], ["packages", 0.44]), 0.27], [column(["resources", 0.54], ["processes", 0.46]), 0.43], [column([tabs("activity", "sampling", "host"), 0.5], [tabs("access", "state", "subscriptions", "codex-tools", "xcom-state", "developer"), 0.5]), 0.3])),
    preset("admin", "Admin", row(["access", 0.34], ["state", 0.33], [column(["subscriptions", 0.6], [tabs("codex-tools", "xcom-state", "developer"), 0.4]), 0.33])),
    preset("monitor", "Monitor", column([row(["server", 1], ["resources", 1.4], ["host", 1]), 0.5], [row(["processes", 1.4], ["sampling", 1], ["activity", 1]), 0.5])),
  ],
  lab: [
    preset("bench", "Bench", row(["call-speech", 0.4], ["inference", 0.6])),
    preset("inference", "Inference", column(["inference", 0.7], ["call-speech", 0.3])),
  ],
};
