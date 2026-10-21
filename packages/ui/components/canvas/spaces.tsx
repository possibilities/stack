"use client";

import { ActivityIcon, BellIcon, CalendarClockIcon, ChartGanttIcon, HammerIcon, BlocksIcon, BotIcon, BoxesIcon, EyeIcon, LibraryIcon, NotebookTextIcon, ChartLineIcon, CpuIcon, FilePenLineIcon, FileTextIcon, FlaskConicalIcon, FolderLockIcon, GaugeIcon, HistoryIcon, InboxIcon, KeyRoundIcon, ListTreeIcon, MegaphoneIcon, MessageSquareWarningIcon, MessagesSquareIcon, PackageIcon, PlugIcon, RadarIcon, RadioIcon, ScanLineIcon, ScrollTextIcon, ServerIcon, SparklesIcon, SquareTerminalIcon, UserCogIcon, UsersRoundIcon } from "lucide-react";
import type { ChatWindows } from "@/lib/stack/chat-windows";
import type { WorkerWindows } from "@/lib/stack/worker-windows";
import type { ViewerWindows } from "@/lib/stack/browse-viewers";
import type { ProcRunWindows } from "@/lib/stack/proc-windows";
import { AppWindowIcon, CableIcon, DatabaseIcon, HardDriveIcon, LifeBuoyIcon, MonitorIcon, WrenchIcon } from "lucide-react";
import { HandoffsWindow, ViewerWindow } from "./browse-handoffs";
import { ControllersWindow, ProfilesWindow, ToolchainWindow } from "./browse-operator";
import { BrowsersWindow } from "./browse-browsers";
import { ExtensionsWindow } from "./browse-extensions";
import { PasswordManagerWindow } from "./browse-password-manager";
import { KeySquareIcon, PuzzleIcon } from "lucide-react";
import { localOperations } from "@/lib/stack/state";
import { ArrowRightLeftIcon, FolderInputIcon, GlobeIcon, ListChecksIcon, RssIcon } from "lucide-react";
import { ExtractWindow } from "./scrape-extract";
import { ConvertWindow, FeedsWindow } from "./scrape-feeds";
import { ChecksWindow, PresetsWindow, QueueWindow, StatusWindow } from "./scrape-operator";
import { BookOpenTextIcon, BrainIcon, ImportIcon, SatelliteDishIcon, SearchIcon } from "lucide-react";
import { ReaderWindow, SearchWindow } from "./brain-search";
import { IngestWindow } from "./brain-ingest";
import { JobsWindow, SourcesWindow } from "./brain-ledger";
import { BookMarkedIcon, FileJsonIcon, RadioTowerIcon } from "lucide-react";
import { ReceiversWindow } from "./source-receivers";
import { CatalogWindow as SourceCatalogWindow } from "./source-catalog";
import { DeliveriesWindow } from "./source-deliveries";
import { DeliveryWindow } from "./source-delivery";
import { WatchesWindow } from "./source-watches";
import type { SpaceId } from "@/lib/stack/spaces";
import type { StackState } from "@/lib/stack/store";
import { type Accent } from "./window";
import { AccountsWindow, BotsWindow } from "./windows";
import { BotStateWindow } from "./bot-state";
import { UsageWindow } from "./usage-window";
import { CatalogWindow } from "./catalog-window";
import { CallSpeechWindow } from "./call-speech-window";
import { InferenceWindow } from "./inference-window";
import { HostWindow, ProcessesWindow, ResourcesWindow, SamplingWindow } from "./resource-windows";
import { ActivityWindow, ServerWindow, PackagesWindow } from "./system-windows";
import { CodexToolsWindow } from "./codex-tools";
import { DeveloperWindow } from "./developer-window";
import { developerModeOn } from "@/lib/stack/developer";
import { StateInventoryWindow, SubscriptionsWindow } from "./state-windows";
import { XcomStateWindow } from "./xcom-state";
import { ArchiveIcon } from "lucide-react";
import { ChatWindow } from "./chat-window";
import { BotHistoryWindow } from "./bot-history";
import { RoleCatalogWindow } from "./role-catalog";
import { RoleEditorWindow } from "./role-editor";
import { RoleInstructionsWindow } from "./role-instructions";
import { RolePreviewWindow } from "./role-preview";
import { RoleMcpServersWindow, RoleProjectsWindow, RoleSkillsWindow } from "./role-resources";
import { RoleShimsWindow } from "./role-shims";
import { AccessWindow } from "./access-window";
import { InboxWindow, NotificationWindow } from "./notify-windows";
import { ComposeWindow } from "./notify-compose";
import { notificationSendAccess } from "@/lib/stack/notify-compose";
import { SendIcon } from "lucide-react";
import { AttentionChangesWindow, AttentionMessagesWindow, AttentionRunsWindow, AttentionWindow, SignalWindow } from "./signal-windows";
import { ContentArtifactsWindow } from "./content-artifacts";
import { ContentStorageWindow } from "./content-storage";
import { ContentDocumentsWindow } from "./content-documents";
import { ContentEditorWindow } from "./content-editor";
import { ContentLibraryWindow } from "./content-library";
import { ContentPreviewWindow } from "./content-preview";
import { WorkerRuntimesWindow, WorkersWindow } from "./worker-windows";
import { WorkerWindow } from "./worker-session";
import { ProcSchedulesWindow } from "./proc-schedules";
import { ProcScheduleWindow } from "./proc-schedule";
import { ProcRunsWindow } from "./proc-runs";
import { ProcRunWindow } from "./proc-run";
import { ProcTimelineWindow } from "./proc-timeline";
import { GoalIcon, HandIcon, NetworkIcon } from "lucide-react";
import { WorkWindow } from "./hud-work";
import { ItemWindow } from "./hud-item";
import { TimelineWindow } from "./hud-timeline";
import { ResourcesWindow as WorkResourcesWindow } from "./hud-resources";
import { AttentionWindow as WorkAttentionWindow } from "./hud-attention";

export type WindowDef = {
  description?: string;
  /** Globally unique across spaces; also used by Window and node destinations. */
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: Accent;
  element: React.ReactNode;
};

export const spaceViews: Record<SpaceId, {
  icon: React.ComponentType<{ className?: string }>;
  accent: Accent;
  windows(state: StackState, arrangement: { chats: ChatWindows; workers: WorkerWindows; viewers: ViewerWindows; procRuns: ProcRunWindows }): WindowDef[];
}> = {
  fleet: {
    icon: BotIcon,
    accent: "bots",
    windows: (_state, { chats }) => [
      { id: "bots", title: "Bots", icon: BotIcon, accent: "bots", element: <BotsWindow /> },
      { id: "bot-state", title: "Bot state", icon: HardDriveIcon, accent: "bots", element: <BotStateWindow /> },
      { id: "bot-history", title: "History", icon: HistoryIcon, accent: "bots", element: <BotHistoryWindow /> },
      ...chats.map((chat) => ({ id: chat.id, title: "Chat", icon: SquareTerminalIcon, accent: "bots" as const,
        element: <ChatWindow id={chat.id} /> })),
    ],
  },
  hud: {
    icon: GoalIcon,
    accent: "hud",
    // Overview and attention on the left; the selected item's detail, history and deployed resources follow it.
    windows: () => [
      { id: "hud-attention", title: "Needs attention", icon: HandIcon, accent: "hud", element: <WorkAttentionWindow /> },
      { id: "hud-work", title: "Work", icon: ListTreeIcon, accent: "hud", element: <WorkWindow /> },
      { id: "hud-item", title: "Work item", icon: FileTextIcon, accent: "hud", element: <ItemWindow /> },
      { id: "hud-timeline", title: "Timeline", icon: HistoryIcon, accent: "hud", element: <TimelineWindow /> },
      { id: "hud-resources", title: "Resources", icon: NetworkIcon, accent: "hud", element: <WorkResourcesWindow /> },
    ],
  },
  accounts: {
    icon: KeyRoundIcon,
    accent: "auth",
    windows: () => [
      { id: "accounts", title: "Accounts", icon: KeyRoundIcon, accent: "auth", element: <AccountsWindow /> },
      { id: "usage", title: "Usage", icon: GaugeIcon, accent: "server", element: <UsageWindow /> },
      { id: "model-catalogs", title: "Models", icon: ListTreeIcon, accent: "bots", element: <CatalogWindow /> },
    ],
  },
  lab: {
    icon: FlaskConicalIcon,
    accent: "events",
    windows: () => [
      { id: "call-speech", title: "Call speech", icon: MegaphoneIcon, accent: "bots", element: <CallSpeechWindow /> },
      { id: "inference", title: "Inference", icon: SparklesIcon, accent: "bots", element: <InferenceWindow /> },
    ],
  },
  system: {
    icon: CpuIcon,
    accent: "server",
    windows: (state) => [
      { id: "server", title: "Server", icon: CpuIcon, accent: "server", element: <ServerWindow /> },
      { id: "access", title: "Access", icon: KeyRoundIcon, accent: "server", element: <AccessWindow /> },
      { id: "packages", title: "Packages", icon: PackageIcon, accent: "server", element: <PackagesWindow /> },
      { id: "resources", title: "Resources", icon: ChartLineIcon, accent: "server", element: <ResourcesWindow /> },
      { id: "host", title: "Host", icon: ServerIcon, accent: "server", element: <HostWindow /> },
      { id: "codex-tools", title: "Codex tools", icon: WrenchIcon, accent: "server", element: <CodexToolsWindow /> },
      { id: "processes", title: "Processes", icon: ListTreeIcon, accent: "server", element: <ProcessesWindow /> },
      { id: "sampling", title: "Sampling", icon: ScanLineIcon, accent: "server", element: <SamplingWindow /> },
      { id: "activity", title: "Activity", icon: RadioIcon, accent: "events", element: <ActivityWindow /> },
      { id: "state", title: "State", icon: DatabaseIcon, accent: "server", element: <StateInventoryWindow /> },
      { id: "subscriptions", title: "Subscriptions", icon: CableIcon, accent: "server", element: <SubscriptionsWindow /> },
      { id: "xcom-state", title: "Xcom", icon: ArchiveIcon, accent: "server", element: <XcomStateWindow /> },
      // Registered only while this page's current serve connection read developer mode on (ADR 0138). Last in the
      // Server column and no wider or taller than it has room for, so it appears and leaves without moving other windows.
      ...developerModeOn(state) ? [{ id: "developer", title: "Developer", icon: HammerIcon, accent: "server" as const, element: <DeveloperWindow /> }] : [],
    ],
  },
  roles: {
    icon: UserCogIcon,
    accent: "roles",
    windows: () => [
      { id: "role-catalog", title: "Roles", icon: UsersRoundIcon, accent: "roles", element: <RoleCatalogWindow /> },
      { id: "role-instructions", title: "Instructions", icon: ScrollTextIcon, accent: "roles", element: <RoleInstructionsWindow /> },
      { id: "role-editor", title: "Editor", icon: FilePenLineIcon, accent: "roles", element: <RoleEditorWindow /> },
      { id: "role-preview", title: "Preview", icon: FileTextIcon, accent: "roles", element: <RolePreviewWindow /> },
      { id: "role-skills", title: "Skills", icon: BlocksIcon, accent: "roles", element: <RoleSkillsWindow /> },
      { id: "role-mcp-servers", title: "MCP servers", icon: PlugIcon, accent: "roles", element: <RoleMcpServersWindow /> },
      { id: "role-projects", title: "Trusted projects", icon: FolderLockIcon, accent: "roles", element: <RoleProjectsWindow /> },
      { id: "role-shims", title: "Shims", icon: SquareTerminalIcon, accent: "roles", element: <RoleShimsWindow /> },
    ],
  },
  inbox: {
    icon: InboxIcon,
    accent: "notify",
    windows: (state) => [
      { id: "notify-inbox", title: "Inbox", icon: InboxIcon, accent: "notify", element: <InboxWindow /> },
      { id: "notify-detail", title: "Notification", icon: BellIcon, accent: "notify", element: <NotificationWindow /> },
      ...(!state.remote || (notificationSendAccess(state).exposed && !notificationSendAccess(state).reason) ? [
        { id: "notify-compose", title: "Compose", icon: SendIcon, accent: "notify" as const, element: <ComposeWindow /> },
      ] : []),
    ],
  },
  signal: {
    icon: RadarIcon,
    accent: "events",
    windows: () => [
      { id: "signal", title: "Signal", icon: RadarIcon, accent: "events", element: <SignalWindow /> },
      { id: "attention", title: "Attention", icon: MessageSquareWarningIcon, accent: "events", element: <AttentionWindow /> },
      { id: "attention-messages", title: "Messages", icon: MessagesSquareIcon, accent: "events", element: <AttentionMessagesWindow /> },
      { id: "attention-runs", title: "Runs", icon: HistoryIcon, accent: "events", element: <AttentionRunsWindow /> },
      { id: "attention-changes", title: "Changes", icon: ActivityIcon, accent: "events", element: <AttentionChangesWindow /> },
    ],
  },
  content: {
    icon: NotebookTextIcon,
    accent: "content",
    windows: () => [
      { id: "content-documents", title: "Documents", icon: NotebookTextIcon, accent: "content", element: <ContentDocumentsWindow /> },
      { id: "content-library", title: "Library", icon: LibraryIcon, accent: "content", element: <ContentLibraryWindow /> },
      { id: "content-editor", title: "Editor", icon: FilePenLineIcon, accent: "content", element: <ContentEditorWindow /> },
      { id: "content-preview", title: "Preview", icon: EyeIcon, accent: "content", element: <ContentPreviewWindow /> },
      { id: "content-artifacts", title: "Artifacts", icon: BoxesIcon, accent: "content", element: <ContentArtifactsWindow /> },
      { id: "content-storage", title: "Storage", icon: HardDriveIcon, accent: "content", element: <ContentStorageWindow /> },
    ],
  },
  workers: {
    icon: HammerIcon,
    accent: "worker",
    windows: (_state, { workers }) => [
      { id: "workers", title: "Workers", icon: HammerIcon, accent: "worker", element: <WorkersWindow /> },
      ...workers.map((window) => ({ id: window.id, title: "Worker", icon: HammerIcon, accent: "worker" as const,
        element: <WorkerWindow id={window.id} /> })),
      { id: "worker-runtimes", title: "Runtimes", icon: CpuIcon, accent: "worker", element: <WorkerRuntimesWindow /> },
    ],
  },
  scrape: {
    icon: GlobeIcon,
    accent: "scrape",
    windows: () => [
      { id: "scrape-extract", title: "Extract", icon: GlobeIcon, accent: "scrape", element: <ExtractWindow /> },
      { id: "scrape-feeds", title: "Feeds", icon: RssIcon, accent: "scrape", element: <FeedsWindow /> },
      { id: "scrape-convert", title: "Convert", icon: ArrowRightLeftIcon, accent: "scrape", element: <ConvertWindow /> },
      { id: "scrape-presets", title: "Presets", icon: BlocksIcon, accent: "scrape", element: <PresetsWindow /> },
      { id: "scrape-status", title: "Status", icon: GaugeIcon, accent: "scrape", element: <StatusWindow /> },
      { id: "scrape-checks", title: "Checks", icon: ListChecksIcon, accent: "scrape", element: <ChecksWindow /> },
      { id: "scrape-queue", title: "Queue", icon: FolderInputIcon, accent: "scrape", element: <QueueWindow /> },
    ],
  },
  browse: {
    icon: MonitorIcon,
    accent: "browse",
    windows: (state, { viewers }) => [
      { id: "browse-handoffs", title: "Handoffs", icon: LifeBuoyIcon, accent: "browse", element: <HandoffsWindow /> },
      ...viewers.map((viewer) => ({ id: viewer.id, title: "Viewer", icon: MonitorIcon, accent: "browse" as const,
        element: <ViewerWindow id={viewer.id} /> })),
      { id: "browse-browsers", title: "Browsers", icon: AppWindowIcon, accent: "browse", element: <BrowsersWindow /> },
      { id: "browse-profiles", title: "Profiles", icon: HardDriveIcon, accent: "browse", element: <ProfilesWindow /> },
      { id: "browse-controllers", title: "Controllers", icon: CableIcon, accent: "browse", element: <ControllersWindow /> },
      { id: "browse-toolchain", title: "Toolchain", icon: WrenchIcon, accent: "browse", element: <ToolchainWindow /> },
      // Local operator management (ADR 0187), registered only once live discovery exposes its reads on the local WebSocket.
      ...localOperations(state, "browse", ["browser_extension_list"]).available ? [{ id: "browse-extensions", title: "Extensions", icon: PuzzleIcon, accent: "browse" as const, element: <ExtensionsWindow /> }] : [],
      ...localOperations(state, "browse", ["browser_vault_status"]).available ? [{ id: "browse-password-manager", title: "Password manager", icon: KeySquareIcon, accent: "browse" as const, element: <PasswordManagerWindow /> }] : [],
    ],
  },
  brain: {
    icon: BrainIcon,
    accent: "brain",
    windows: () => [
      { id: "brain-search", title: "Search", icon: SearchIcon, accent: "brain", element: <SearchWindow /> },
      { id: "brain-reader", title: "Reader", icon: BookOpenTextIcon, accent: "brain", element: <ReaderWindow /> },
      { id: "brain-ingest", title: "Ingest", icon: ImportIcon, accent: "brain", element: <IngestWindow /> },
      { id: "brain-jobs", title: "Jobs", icon: ListChecksIcon, accent: "brain", element: <JobsWindow /> },
      { id: "brain-sources", title: "Sources", icon: SatelliteDishIcon, accent: "brain", element: <SourcesWindow /> },
    ],
  },
  source: {
    icon: RadioTowerIcon,
    accent: "source",
    // Where deliveries come from beside what arrived, then the one selected: evidence first, setup detail disclosed on demand.
    windows: () => [
      { id: "source-receivers", title: "Receivers", icon: RadioTowerIcon, accent: "source", element: <ReceiversWindow /> },
      { id: "source-catalog", title: "Event catalog", icon: BookMarkedIcon, accent: "source", element: <SourceCatalogWindow /> },
      { id: "source-deliveries", title: "Deliveries", icon: InboxIcon, accent: "source", element: <DeliveriesWindow /> },
      { id: "source-delivery", title: "Delivery", icon: FileJsonIcon, accent: "source", element: <DeliveryWindow /> },
      { id: "source-watches", title: "Watches", icon: EyeIcon, accent: "source", element: <WatchesWindow /> },
    ],
  },
  proc: {
    icon: CalendarClockIcon,
    accent: "proc",
    windows: (_state, { procRuns }) => [
      { id: "proc-schedules", title: "Schedules", icon: CalendarClockIcon, accent: "proc", element: <ProcSchedulesWindow /> },
      { id: "proc-schedule", title: "Schedule", icon: CalendarClockIcon, accent: "proc", element: <ProcScheduleWindow /> },
      { id: "proc-runs", title: "Runs", icon: SquareTerminalIcon, accent: "proc", element: <ProcRunsWindow /> },
      ...procRuns.map((window) => ({ id: window.id, title: "Run", icon: SquareTerminalIcon, accent: "proc" as const,
        element: <ProcRunWindow id={window.id} /> })),
      { id: "proc-timeline", title: "Timeline", icon: ChartGanttIcon, accent: "proc", element: <ProcTimelineWindow /> },
    ],
  },
};

const paneDescriptions: Record<string, string> = {
  "hud-attention": "Work that needs someone next", "hud-work": "Shared Work hierarchy and selection", "hud-item": "Selected Work item, details and edits", "hud-timeline": "Collaboration history for selected Work", "hud-resources": "Resources deployed on selected Work",
  bots: "Bots and their existing controls", "bot-state": "Stored state and recovery for a selected Bot", "bot-history": "Search and read retained Bot conversations", chat: "A Bot's live main-thread transcript",
  workers: "Worker sessions, filters and attention", worker: "A Worker's conversation, changes, turns and tools", "worker-runtimes": "Worker runtimes and availability",
  accounts: "Accounts, sign-in and linked Workers", usage: "Observed quota and reset times", "model-catalogs": "Available models and effort choices",
  "call-speech": "Speech controls for the current call", inference: "Inference requests and their durable ledger",
  "notify-inbox": "Notifications to read and answer", "notify-detail": "Selected Notification and response choices", "notify-compose": "Compose an operator Notification",
  signal: "Processing settings and health", attention: "What conversations ask of you", "attention-messages": "Captured conversation evidence", "attention-runs": "Interpretation runs and traces", "attention-changes": "Attention change history",
  "role-catalog": "Named Roles and launch defaults", "role-instructions": "Instruction Categories and Fragments", "role-editor": "Edit the selected Role resource", "role-preview": "Assembled instructions and launch preview", "role-skills": "Role skills and capability filters", "role-mcp-servers": "Role MCP servers and internal connections", "role-projects": "Trusted launch projects", "role-shims": "Local commands that launch Roles",
  "browse-handoffs": "Requests for human browser help", "browse-viewer": "A profile's live observation or granted control", "browse-browsers": "Named browsers any agent can drive", "browse-profiles": "Browser profiles and their state", "browse-controllers": "Connected browser controllers", "browse-toolchain": "Browser tools and owned volumes", "browse-extensions": "Extension catalog and permission review", "browse-password-manager": "Agent password manager service, setup and backups",
  "content-documents": "Vault documents and selection", "content-library": "Collections and Content items", "content-editor": "Document drafts and editing", "content-preview": "Read the selected document or item", "content-artifacts": "Published Artifacts", "content-storage": "Content storage and retained history",
  "brain-search": "Find collected research", "brain-reader": "Read selected research and evidence", "brain-ingest": "Admit material for ingestion", "brain-jobs": "Ingestion jobs, Runs and recovery", "brain-sources": "Recurring Research sources",
  "scrape-extract": "Extract a specific source", "scrape-feeds": "Discover feed entries", "scrape-convert": "Convert document content", "scrape-presets": "Extraction presets", "scrape-status": "Extraction capability and health", "scrape-checks": "Local corpus checks", "scrape-queue": "Scrape-to-file jobs and receipts",
  "proc-schedules": "Scheduled tasks and filters", "proc-schedule": "Selected schedule and executions", "proc-runs": "Process runs and filters", "proc-run": "One run's output and status", "proc-timeline": "Schedule and run timing",
  "source-receivers": "Webhook receiver setup and state", "source-catalog": "Official event definitions", "source-deliveries": "Accepted deliveries and filters", "source-delivery": "Selected delivery and original payload", "source-watches": "Filtered inboxes and reviewed acknowledgments",
  server: "Server status and Stack settings", access: "Local Access approvals and credentials", packages: "Package channels and endpoints", resources: "Observed host resource usage", host: "Host resources and configuration", "codex-tools": "Codex tool availability", processes: "Observed processes", sampling: "Process sampling", activity: "Package activity", state: "Owner state inventories and recovery", subscriptions: "Event subscriptions and completion evidence", "xcom-state": "Following archive state", developer: "Upstream harness release observations",
};

export function paneDescription(def: WindowDef): string {
  const kind = def.id.replace(/-\d+$/, "");
  return def.description ?? paneDescriptions[kind] ?? def.title;
}

export function paneRegistryReady(space: SpaceId, state: StackState): boolean {
  // Browse management panes depend on live discovery; a layout waits for its answer (or its failure) before restoring.
  if (space === "browse") return Boolean(state.remote) || !state.endpoints.browse || state.catalog.data !== null || state.catalog.error !== null;
  return space !== "system" || Boolean(state.remote) || (state.status.serve === "open" && state.serveSettings.error === null && state.serveSettings.data !== null);
}

export type PaneDefinition = WindowDef & { kind: string; space: SpaceId; description: string; minimum: { width: number; height: number } };
const readingPanes = new Set(["chat", "bot-history", "worker", "browse-viewer", "role-editor", "role-preview", "content-editor", "content-preview", "brain-reader", "proc-run", "source-delivery"]);
export function paneDefinitions(space: SpaceId, state: StackState, arrangement: Parameters<(typeof spaceViews)[SpaceId]["windows"]>[1]): PaneDefinition[] {
  return spaceViews[space].windows(state, arrangement).map((def) => {
    const kind = def.id.replace(/-\d+$/, "");
    return { ...def, kind, space, description: paneDescription(def), minimum: readingPanes.has(kind) ? { width: 360, height: 240 } : { width: 280, height: 180 } };
  });
}
