"use client";

import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeftIcon, BookOpenTextIcon, HistoryIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { shortId } from "@/lib/stack/derive";
import { appendLater, appendUnique, earlierWindow, firstWindow, fullPayload, historyAccess, historyFailure, historyMark, historyPageSize, hitKey, hitTarget,
  laterAfter, prependEarlier, readFullRecord, recordPageSize, recordView, searchText, targetKey, type HistoryTarget, type RecordView, type RecordWindow } from "@/lib/stack/history";
import { markdownBlocks } from "@/lib/stack/markdown-blocks";
import type { Bot, Chat, ChatHit, ChatRecord, ChatRecordChunk, ChatRecordPage } from "@/lib/stack/types";
import { cn } from "@/lib/utils";
import { useSnapshotRead } from "./owner-reads";
import { CopyButton, StatusDot } from "./primitives";
import { useStack, useStore } from "./provider";
import { Window } from "./window";

/** What a search or listing was asked for. A null query lists one Bot's conversations; it is not a search. */
type Ask = { query: string | null; botId: string | null };
type Conversation = Chat & Partial<Pick<ChatHit, "line" | "role" | "snippet">>;

const hint = "text-[0.68rem] text-pretty text-muted-foreground";
/** Rendering cost grows with length; Show all and Copy still hold the whole text. */
const clampChars = 6_000;
const renderLimit = 200_000;
const coverage = "Covers the current sanctioned history of Bots on this server: each Bot’s main thread and its descendants. Not Worker sessions, other native threads, removed Bots, retired conversation generations or other servers.";

const useMark = (botId: string | null) => {
  const { bots, historyInvalidations } = useStack();
  return historyMark(bots.data, historyInvalidations, botId);
};

function useAccess(operation: Parameters<typeof historyAccess>[1]): string | null {
  const state = useStack();
  return historyAccess(state, operation);
}

/**
 * The first page through the shared observation lifecycle; later offset pages bind to that exact evidence.
 * Offsets have no owner revision: a refresh, invalidation or hidden pane drops held pages, never mixes them.
 */
function useOffsetPages<T extends Conversation>(readPage: (offset: number) => Promise<T[]>, key: string | null, mark: string, unavailable: string | null) {
  const first = useSnapshotRead(() => {
    const at = mark;
    return readPage(0).then((items) => ({ items, full: items.length === historyPageSize, mark: at }));
  }, key, null, unavailable);
  const [extra, setExtra] = useState<{ base: unknown; items: T[]; full: boolean; offset: number; repeated: number; error: string | null } | null>(null);
  const [paging, setPaging] = useState(false);
  const seq = useRef(0);
  useLayoutEffect(() => {
    setPaging(false);
    return () => { seq.current++; };
  }, [first.evidence, first.pending, first.stale, first.unavailable, mark]);
  const held = extra?.base === first.evidence ? extra : null;
  const items = first.data ? held?.items ?? first.data.items : null;
  const full = held ? held.full : first.data?.full ?? false;
  const changed = first.data !== null && first.data.mark !== mark;
  const canMore = full && !first.pending && !first.stale && !first.unavailable && !changed && !paging;
  const more = async () => {
    if (!canMore || !items) return;
    const mine = ++seq.current, base = first.evidence, offset = held?.offset ?? historyPageSize;
    setPaging(true);
    try {
      const page = await readPage(offset);
      if (seq.current !== mine) return;
      const merged = appendUnique(items, page);
      setExtra({ base, items: merged.items, full: page.length === historyPageSize, offset: offset + historyPageSize, repeated: (held?.repeated ?? 0) + merged.repeated, error: null });
    } catch (error) {
      if (seq.current === mine) setExtra({ base, items, full, offset, repeated: held?.repeated ?? 0, error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (seq.current === mine) setPaging(false);
    }
  };
  return { first, items, full, changed, canMore, more, paging, pageError: held?.error ?? null, repeated: held?.repeated ?? 0, pages: held ? held.offset / historyPageSize : 1 };
}

/**
 * Fleet History: search retained Bot conversations, or list one Bot's, then read one exactly by Bot, thread
 * and record line. Reading never starts a Bot, opens a chat or admits input, and works while a Bot is stopped.
 */
export function BotHistoryWindow() {
  const { bots, botHistoryRequest } = useStack();
  const formId = useId();
  const [scope, setScope] = useState("");
  const [input, setInput] = useState("");
  const [issue, setIssue] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [nonce, setNonce] = useState(0);
  const [target, setTarget] = useState<HistoryTarget | null>(null);
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const results = useRef<HTMLDivElement>(null);

  // Another surface (a stopped Bot's Chat) asked for one Bot's conversations.
  const handled = useRef(0);
  useEffect(() => {
    if (!botHistoryRequest || botHistoryRequest.seq === handled.current) return;
    handled.current = botHistoryRequest.seq;
    setScope(botHistoryRequest.botId);
    setInput("");
    setIssue(null);
    setAsk({ query: null, botId: botHistoryRequest.botId });
    setTarget(null);
  }, [botHistoryRequest]);

  const run = (query: string, botId: string | null) => {
    const checked = searchText(query);
    setIssue(checked.issue);
    if (checked.issue) return;
    const next: Ask | null = checked.query ? { query: checked.query, botId } : botId ? { query: null, botId } : null;
    // Asking again for the same thing is an explicit refresh.
    if (next && ask && next.query === ask.query && next.botId === ask.botId) setNonce((value) => value + 1);
    setAsk(next);
    setTarget(null);
  };
  const back = () => {
    setTarget(null);
    const key = returnTo;
    requestAnimationFrame(() => (key ? results.current?.querySelector<HTMLElement>(`[data-hit="${CSS.escape(key)}"]`) : null)?.focus());
  };
  const open = (next: HistoryTarget) => { setReturnTo(hitKey(next)); setTarget(next); };

  return (
    <Window id="bot-history" title="History" subtitle={ask ? ask.botId ?? "all Bots" : "retained conversations"} icon={HistoryIcon} accent="bots" bleed
      reveal={scope ? { kind: "bot-history", id: scope } : undefined}>
      <div className="@container flex min-h-0 flex-1 flex-col">
        <form className="flex shrink-0 flex-col gap-1.5 border-b border-border/60 p-2.5" onSubmit={(event) => { event.preventDefault(); run(input, scope || null); }}>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={`${formId}-scope`} className="sr-only">Bots to search</label>
            <NativeSelect id={`${formId}-scope`} size="sm" value={scope} className="max-w-44 text-[0.72rem]"
              onChange={(event) => { setScope(event.target.value); if (ask) run(input, event.target.value || null); }}>
              <NativeSelectOption value="">All Bots</NativeSelectOption>
              {(bots.data ?? []).map((bot) => <NativeSelectOption key={bot.id} value={bot.id}>{bot.id}</NativeSelectOption>)}
              {scope && !bots.data?.some((bot) => bot.id === scope) ? <NativeSelectOption value={scope}>{scope} (removed)</NativeSelectOption> : null}
            </NativeSelect>
            <label htmlFor={`${formId}-query`} className="sr-only">Search Bot history</label>
            <Input id={`${formId}-query`} type="search" value={input} placeholder={scope ? `Search ${scope}’s history…` : "Search Bot history…"} autoComplete="off" spellCheck={false}
              maxLength={2048} aria-invalid={issue ? true : undefined} aria-describedby={issue ? `${formId}-issue` : undefined}
              onChange={(event) => { setInput(event.target.value); setIssue(null); }} className="h-8 min-w-40 flex-1 text-[0.8rem]" />
            <Button type="submit" size="sm" disabled={!input.trim() && !scope}>
              {input.trim() ? <SearchIcon data-icon="inline-start" /> : <HistoryIcon data-icon="inline-start" />}{input.trim() ? "Search" : "List"}
            </Button>
          </div>
          {issue ? <p id={`${formId}-issue`} role="alert" className="text-[0.7rem] text-destructive">{issue}</p> : null}
        </form>
        <div className="flex min-h-0 flex-1 @3xl:grid @3xl:grid-cols-[minmax(16rem,2fr)_minmax(0,3fr)]">
          <div ref={results} className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain p-2.5", target && "hidden @3xl:block")}>
            {!ask ? <Intro /> : ask.query ? <SearchResults key={`${ask.botId}\u0000${ask.query}`} ask={ask as Ask & { query: string }} nonce={nonce} selected={target} onRead={open} />
              : <BotConversations key={ask.botId!} botId={ask.botId!} nonce={nonce} selected={target} onRead={open} />}
          </div>
          {target ? (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col @3xl:border-l @3xl:border-border/60">
              <Reader key={targetKey(target)} target={target} onBack={back} />
            </div>
          ) : (
            <div className="hidden min-h-0 flex-col items-center justify-center gap-1.5 border-l border-border/60 px-8 text-center @3xl:flex">
              <BookOpenTextIcon className="size-5 text-muted-foreground/70" />
              <p className="text-sm font-medium">No conversation open</p>
              <p className={cn(hint, "max-w-72")}>Choose Read history on a result. Reading never starts a Bot or sends anything.</p>
            </div>
          )}
        </div>
      </div>
    </Window>
  );
}

function Intro() {
  return (
    <div className="flex flex-col gap-2 px-0.5 py-1">
      <p className="text-[0.78rem] text-pretty">Search retained Bot conversations, including stopped Bots and descendant threads, or choose one Bot and List its conversations.</p>
      <p className={hint}>{coverage}</p>
    </div>
  );
}

function SearchResults({ ask, nonce, selected, onRead }: { ask: Ask & { query: string }; nonce: number; selected: HistoryTarget | null; onRead(target: HistoryTarget): void }) {
  const store = useStore();
  const mark = useMark(ask.botId);
  const unavailable = useAccess("chat_search");
  const read = (offset: number) => store.call<{ hits: ChatHit[] }>("bots", "chat_search", { ...(ask.botId ? { botId: ask.botId } : {}), query: ask.query, limit: historyPageSize, offset }).then((result) => result.hits);
  const pages = useOffsetPages(read, JSON.stringify(["chat_search", ask.botId, ask.query]), mark, unavailable);
  useRefreshOn(nonce, pages.first.refresh);
  return (
    <Listing pages={pages} ask={ask} selected={selected} onRead={onRead}
      label={`Results for “${ask.query}” in ${ask.botId ?? "all Bots"}`}
      empty={`No retained conversation in ${ask.botId ?? "these Bots"} matched “${ask.query}”. Search covers indexed history only; an empty answer is not proof nothing was ever said.`}
      note="Each result is a conversation with one representative match, not every matching message." />
  );
}

function BotConversations({ botId, nonce, selected, onRead }: { botId: string; nonce: number; selected: HistoryTarget | null; onRead(target: HistoryTarget): void }) {
  const store = useStore();
  const { bots } = useStack();
  const mark = useMark(botId);
  const access = useAccess("chat_list");
  const removed = bots.data && !bots.data.some((bot) => bot.id === botId) ? `${botId} no longer exists on this server.` : null;
  const read = (offset: number) => store.call<{ chats: Chat[] }>("bots", "chat_list", { botId, limit: historyPageSize, offset }).then((result) => result.chats);
  const pages = useOffsetPages<Conversation>(read, JSON.stringify(["chat_list", botId]), mark, access ?? removed);
  useRefreshOn(nonce, pages.first.refresh);
  return (
    <Listing pages={pages} ask={{ query: null, botId }} selected={selected} onRead={onRead} label={`${botId}’s conversations`}
      empty={`${botId} has no retained conversation in its sanctioned history.`}
      note="Most recently updated first. Reading opens at the start of a conversation." />
  );
}

function useRefreshOn(nonce: number, refresh: () => Promise<void>) {
  const seen = useRef(nonce);
  useEffect(() => {
    if (seen.current === nonce) return;
    seen.current = nonce;
    void refresh();
  }, [nonce, refresh]);
}

function Listing({ pages, ask, selected, onRead, label, empty, note }: {
  pages: ReturnType<typeof useOffsetPages<Conversation>>; ask: Ask; selected: HistoryTarget | null; onRead(target: HistoryTarget): void;
  label: string; empty: string; note: string;
}) {
  const { first, items, changed } = pages;
  const failure = first.error ? historyFailure(first.error, ask.botId ?? undefined) : null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 px-0.5">
        <p className="min-w-0 flex-1 truncate text-[0.7rem] text-muted-foreground" aria-live="polite">
          {first.pending === "first" ? "Reading…" : items ? `${items.length} conversation${items.length === 1 ? "" : "s"}${pages.full ? " so far" : ""}` : ""}
        </p>
        <Button type="button" size="xs" variant="ghost" disabled={first.pending !== null || Boolean(first.unavailable)} onClick={() => void first.refresh()}
          aria-label="Refresh the first page" title="Read the first page again">
          {first.pending === "refresh" ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}Refresh
        </Button>
      </div>
      <Freshness unavailable={first.unavailable} stale={first.stale || changed} pending={first.pending !== null} changed={changed} what="these results" />
      {failure ? <FailureNote failure={failure} /> : null}
      {items ? (
        items.length ? (
          <ol className="flex flex-col gap-1" aria-label={label}>
            {items.map((item) => <ConversationRow key={hitKey(item)} item={item} selected={selected !== null && hitKey(selected) === hitKey(item)} onRead={onRead} />)}
          </ol>
        ) : <p className={cn(hint, "px-0.5")}>{empty}</p>
      ) : null}
      {pages.pageError ? <FailureNote failure={historyFailure(pages.pageError, ask.botId ?? undefined)} /> : null}
      {items?.length ? (
        pages.full ? (
          <Button type="button" size="xs" variant="ghost" className="w-full" disabled={!pages.canMore} onClick={() => void pages.more()}>
            {pages.paging ? <Spinner data-icon="inline-start" /> : null}Read next page
          </Button>
        ) : <p className={cn(hint, "px-0.5")}>No further results in this read.</p>
      ) : null}
      {pages.repeated ? <p className={cn(hint, "px-0.5")}>{pages.repeated} conversation{pages.repeated === 1 ? "" : "s"} already listed appeared again on a later page and {pages.repeated === 1 ? "was" : "were"} not repeated.</p> : null}
      {items ? <p className={cn(hint, "px-0.5")}>{note} {coverage}</p> : null}
    </div>
  );
}

function botTone(bot: Bot | undefined): { tone: "success" | "muted" | "warning" | "destructive"; label: string } {
  if (!bot) return { tone: "destructive", label: "removed" };
  if (bot.recoveryIssue) return { tone: "warning", label: "needs inspection" };
  return bot.state === "running" ? { tone: "success", label: "running" } : { tone: "muted", label: "stopped" };
}

function ConversationRow({ item, selected, onRead }: { item: Conversation; selected: boolean; onRead(target: HistoryTarget): void }) {
  const { bots } = useStack();
  const bot = bots.data?.find((entry) => entry.id === item.botId);
  const status = botTone(bot);
  const root = bot?.mainThreadId === item.threadId;
  const kind = root ? "main thread" : item.parentThreadId ? "descendant" : "thread";
  const title = item.title.trim() || "Untitled conversation";
  const updated = Date.parse(item.updatedAt);
  return (
    <li className={cn("flex flex-col gap-1 rounded-lg border px-2.5 py-2", selected ? "border-ring/60 bg-muted/60" : "border-border/70")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.66rem] text-muted-foreground">
        <span className="inline-flex items-center gap-1 font-mono text-foreground/80"><StatusDot tone={status.tone} label={status.label} />{item.botId}</span>
        <span>{kind}</span>
        <span className="font-mono" title={item.threadId}>{shortId(item.threadId)}</span>
        {Number.isFinite(updated) ? <time className="ml-auto tabular-nums" dateTime={item.updatedAt} title={new Date(updated).toLocaleString()}>{new Date(updated).toLocaleDateString()}</time> : null}
      </div>
      <p className="line-clamp-2 text-[0.78rem] leading-snug font-medium break-words">{title}</p>
      {item.snippet !== undefined ? (
        <p className="line-clamp-4 font-mono text-[0.7rem] leading-relaxed break-words whitespace-pre-wrap text-muted-foreground">
          <span className="mr-1.5 rounded bg-muted px-1 py-px text-[0.62rem] text-foreground/70">{item.role}</span>{item.snippet}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <span className="text-[0.64rem] text-muted-foreground tabular-nums">{item.line !== undefined ? `match at line ${item.line}` : `${item.messageCount} message${item.messageCount === 1 ? "" : "s"}`}</span>
        <Button type="button" size="xs" variant="outline" className="ml-auto" data-hit={hitKey(item)} aria-label={`Read history: ${title} (${item.botId}, ${kind})`}
          onClick={() => onRead(item.line !== undefined ? hitTarget(item as ChatHit) : { botId: item.botId, threadId: item.threadId, line: null, title: item.title, parentThreadId: item.parentThreadId })}>
          <BookOpenTextIcon data-icon="inline-start" />Read history
        </Button>
      </div>
    </li>
  );
}

function Freshness({ unavailable, stale, pending, changed, what, onRead }: { unavailable: string | null; stale: boolean; pending: boolean; changed: boolean; what: string; onRead?(): void }) {
  if (unavailable) return <p role="status" className={cn(hint, "px-0.5")}>{unavailable}{stale ? ` Showing ${what} as last read.` : ""}</p>;
  if (!stale) return null;
  return (
    <p role="status" className="flex flex-wrap items-center gap-x-2 px-0.5 text-[0.68rem] text-pretty text-warning">
      {pending ? `Reading ${what} again…` : changed ? `History changed since ${what} were read. Refresh before relying on them or reading further.` : `Showing ${what} as last read; refresh before relying on them.`}
      {onRead && !pending ? <button type="button" className="underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring" onClick={onRead}>Read again</button> : null}
    </p>
  );
}

function FailureNote({ failure }: { failure: ReturnType<typeof historyFailure> }) {
  const title = failure.kind === "refused" ? "Not permitted" : failure.kind === "removed" ? "Bot removed" : failure.kind === "missing" ? "History unavailable" : "Could not read history";
  return (
    <div role="alert" className={cn("rounded-lg border px-2.5 py-2 text-[0.7rem]", failure.kind === "error" ? "border-destructive/40 text-destructive" : "border-warning/40 text-warning")}>
      <p className="font-medium">{title}</p>
      <p className="break-words text-pretty text-muted-foreground">{failure.message}</p>
    </div>
  );
}

/**
 * One conversation read by exact Bot and thread, from the matched record. The first window follows the shared
 * observation lifecycle; earlier and later records continue by line and bind to that evidence. An invalidation
 * or a hidden pane fences continuation until the conversation is read again.
 */
function useRecords(target: HistoryTarget) {
  const store = useStore();
  const { bots } = useStack();
  const mark = useMark(target.botId);
  const access = useAccess("chat_records");
  const removed = bots.data && !bots.data.some((bot) => bot.id === target.botId) ? `${target.botId} no longer exists on this server.` : null;
  const call = (afterLine: number, limit: number) => store.call<ChatRecordPage>("bots", "chat_records", { botId: target.botId, threadId: target.threadId, afterLine, limit });
  const first = useSnapshotRead(() => {
    const at = mark, { afterLine, limit } = firstWindow(target.line);
    return call(afterLine, limit).then((page): { window: RecordWindow; mark: string } => ({ window: { records: page.records, start: afterLine, nextLine: page.nextLine }, mark: at }));
  }, targetKey(target), null, access ?? removed);
  const [extended, setExtended] = useState<{ base: unknown; window: RecordWindow; prepends: number; error: string | null } | null>(null);
  const [paging, setPaging] = useState<"earlier" | "later" | null>(null);
  const seq = useRef(0);
  useLayoutEffect(() => {
    setPaging(null);
    return () => { seq.current++; };
  }, [first.evidence, first.pending, first.stale, first.unavailable, mark]);
  const held = extended?.base === first.evidence ? extended : null;
  const window = held?.window ?? first.data?.window ?? null;
  const changed = first.data !== null && first.data.mark !== mark;
  const ready = window !== null && !first.pending && !first.stale && !first.unavailable && !changed && paging === null;
  const extend = async (direction: "earlier" | "later") => {
    if (!ready || !window) return;
    const mine = ++seq.current, base = first.evidence;
    setPaging(direction);
    try {
      let next: RecordWindow;
      if (direction === "earlier") {
        const { afterLine, limit } = earlierWindow(window.start);
        next = prependEarlier(window, afterLine, (await call(afterLine, limit)).records);
      } else {
        const after = laterAfter(window);
        next = after === null ? window : appendLater(window, await call(after, recordPageSize));
      }
      if (seq.current !== mine) return;
      setExtended({ base, window: next, prepends: (held?.prepends ?? 0) + (direction === "earlier" ? 1 : 0), error: null });
    } catch (error) {
      if (seq.current === mine) setExtended({ base, window, prepends: held?.prepends ?? 0, error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (seq.current === mine) setPaging(null);
    }
  };
  return { first, window, changed, ready, paging, prepends: held?.prepends ?? 0, pageError: held?.error ?? null,
    earlier: () => void extend("earlier"), later: () => void extend("later") };
}

function Reader({ target, onBack }: { target: HistoryTarget; onBack(): void }) {
  const { bots } = useStack();
  const read = useRecords(target);
  const { first, window } = read;
  const bot = bots.data?.find((entry) => entry.id === target.botId);
  const root = bot?.mainThreadId === target.threadId;
  const failure = first.error ? historyFailure(first.error, target.botId) : null;
  const scroller = useRef<HTMLDivElement>(null);
  const focused = useRef<unknown>(null);
  const fromEnd = useRef(0);
  const matched = target.line !== null && window ? window.records.some((record) => record.line === target.line) : null;

  // The matched record is where reading starts, once per read of this conversation.
  useLayoutEffect(() => {
    if (!window || focused.current === first.evidence) return;
    focused.current = first.evidence;
    const el = scroller.current?.querySelector<HTMLElement>(target.line !== null ? `[data-line="${target.line}"]` : "[data-line]");
    el?.scrollIntoView({ block: "start" });
    if (target.line !== null) el?.focus({ preventScroll: true });
  }, [window, first.evidence, target.line]);
  // Earlier records land above the reader: hold their distance from the end.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && read.prepends) el.scrollTop = el.scrollHeight - fromEnd.current;
  }, [read.prepends]);
  const holdPlace = () => { const el = scroller.current; if (el) fromEnd.current = el.scrollHeight - el.scrollTop; };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start gap-2 border-b border-border/60 px-2.5 py-2">
        <Button type="button" size="icon-sm" variant="ghost" className="text-muted-foreground @3xl:hidden" aria-label="Back to results" onClick={onBack}><ArrowLeftIcon /></Button>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 className="line-clamp-2 text-[0.8rem] leading-snug font-semibold break-words">{target.title.trim() || "Untitled conversation"}</h3>
          <p className="flex flex-wrap items-center gap-x-2 text-[0.66rem] text-muted-foreground">
            <span className="inline-flex items-center gap-1 font-mono"><StatusDot tone={botTone(bot).tone} label={botTone(bot).label} />{target.botId}</span>
            <span>{root ? "main thread" : target.parentThreadId ? "descendant" : "thread"}</span>
            <span className="font-mono" title={target.threadId}>{shortId(target.threadId)}</span>
            {target.line !== null ? <span className="tabular-nums">match at line {target.line}</span> : null}
            <span className="text-muted-foreground/80">read-only</span>
          </p>
        </div>
        <Button type="button" size="xs" variant="ghost" disabled={first.pending !== null || Boolean(first.unavailable)} onClick={() => void first.refresh()} title="Read this conversation again from the matched record">
          {first.pending === "refresh" ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}Read again
        </Button>
      </div>
      <div className="flex shrink-0 flex-col gap-1.5 px-2.5 empty:hidden [&>*]:mt-1.5">
        <Freshness unavailable={first.unavailable} stale={first.stale || read.changed} pending={first.pending !== null} changed={read.changed} what="these records" onRead={() => void first.refresh()} />
        {failure ? <FailureNote failure={failure} /> : null}
        {matched === false && !first.pending ? <p role="status" className="text-[0.68rem] text-warning">The matched record (line {target.line}) is not in this read. The history may have changed since the search.</p> : null}
      </div>
      <div ref={scroller} data-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {window ? (
          <div className="flex flex-col gap-2 px-2.5 py-2.5">
            {window.start > 0 ? (
              <Button type="button" size="xs" variant="ghost" className="self-center" disabled={!read.ready} onClick={() => { holdPlace(); read.earlier(); }}>
                {read.paging === "earlier" ? <Spinner data-icon="inline-start" /> : null}Read earlier records
              </Button>
            ) : <p className={cn(hint, "text-center")}>Start of the conversation</p>}
            {window.records.length ? (
              <ol className="flex flex-col gap-2" aria-label="Records">
                {window.records.map((record) => <RecordItem key={record.line} record={record} target={target} matched={record.line === target.line} base={first.evidence} />)}
              </ol>
            ) : <p className={cn(hint, "text-center")}>No chat records in this part of the conversation.</p>}
            {read.pageError ? <FailureNote failure={historyFailure(read.pageError, target.botId)} /> : null}
            <Button type="button" size="xs" variant="ghost" className="self-center" disabled={!read.ready} onClick={read.later}>
              {read.paging === "later" ? <Spinner data-icon="inline-start" /> : null}{window.nextLine !== null ? "Read later records" : "Check for newer records"}
            </Button>
            {window.nextLine === null ? <p className={cn(hint, "text-center")}>End of the conversation as last read.</p> : null}
          </div>
        ) : first.pending ? <p className={cn(hint, "p-3")}>Reading the conversation…</p> : null}
      </div>
    </div>
  );
}

type Full = { state: "reading"; read: number; total: number | null } | { state: "done"; text: string } | { state: "error"; error: string };

const kindStyle: Record<RecordView["kind"], string> = {
  human: "border-l-2 border-pkg-bots/80 bg-foreground/[0.04]", assistant: "", context: "bg-muted/30", instructions: "bg-muted/30",
  reasoning: "", "tool-call": "bg-muted/40", "tool-output": "bg-muted/40", event: "", other: "bg-muted/30",
};

const RecordItem = memo(function RecordItem({ record, target, matched, base }: { record: ChatRecord; target: HistoryTarget; matched: boolean; base: unknown }) {
  const store = useStore();
  const [full, setFull] = useState<Full | null>(null);
  const epoch = useRef(0);
  // A fresh read of the conversation, a hidden pane or unmounting fences a full-record read in progress.
  useLayoutEffect(() => {
    setFull(null);
    return () => { epoch.current++; };
  }, [base]);
  const loadFull = async () => {
    const mine = ++epoch.current;
    setFull({ state: "reading", read: 0, total: null });
    try {
      const text = await readFullRecord(
        (offset, length) => store.call<ChatRecordChunk>("bots", "chat_record_chunk", { botId: target.botId, threadId: target.threadId, line: record.line, offset, length }),
        (read, total) => { if (epoch.current === mine) setFull({ state: "reading", read, total }); });
      if (epoch.current === mine) setFull({ state: "done", text });
    } catch (error) {
      if (epoch.current === mine) setFull({ state: "error", error: historyFailure(error instanceof Error ? error.message : String(error), target.botId).message });
    }
  };
  const parsed = full?.state === "done" ? fullPayload(full.text) : null;
  const shown = record.truncated ? parsed : { type: record.type, payload: record.payload };
  const view = shown ? recordView(shown.type, shown.payload) : null;
  const at = Date.parse(record.timestamp);
  const compact = view?.kind === "event";
  return (
    <li data-line={record.line} tabIndex={matched ? -1 : undefined} aria-current={matched ? "location" : undefined}
      className={cn("flex min-w-0 flex-col gap-1 rounded-md px-2.5 py-1.5 focus-visible:outline-2 focus-visible:outline-ring", view ? kindStyle[view.kind] : "bg-muted/30",
        matched && "ring-2 ring-ring/60", compact && "py-0.5")}>
      <div className="flex min-w-0 items-center gap-2 text-[0.64rem] text-muted-foreground">
        <span className={cn("font-medium", view?.kind === "human" || view?.kind === "assistant" ? "text-foreground/80" : "")}>{view ? view.label : record.truncated ? "Large record" : record.type}</span>
        {view?.name ? <span className="min-w-0 truncate font-mono" title={view.name}>{view.name}</span> : null}
        {compact && view?.text ? <span className="min-w-0 flex-1 truncate" title={view.text.slice(0, 500)}>{view.text}</span> : null}
        {matched ? <span className="rounded bg-ring/15 px-1 text-foreground/80">match</span> : null}
        <span className="ml-auto shrink-0 tabular-nums" title={record.timestamp}>
          {Number.isFinite(at) ? new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null} · L{record.line}
        </span>
      </div>
      {record.truncated && full?.state !== "done" ? (
        <div className="flex flex-wrap items-center gap-2 text-[0.7rem] text-muted-foreground">
          <span>Too large for a page; its content is not shown.</span>
          {full?.state === "reading" ? (
            <span className="tabular-nums" role="status">Reading {full.read.toLocaleString()}{full.total !== null ? ` of ${full.total.toLocaleString()}` : ""} characters…</span>
          ) : <Button type="button" size="xs" variant="outline" onClick={() => void loadFull()}>{full?.state === "error" ? "Try reading the full record again" : "Load full record"}</Button>}
          {full?.state === "error" ? <span className="w-full text-destructive">{full.error}</span> : null}
        </div>
      ) : null}
      {view && !compact ? <RecordBody view={view} /> : null}
      {record.truncated && full?.state === "done" && !parsed ? <p className="text-[0.7rem] text-warning">The full record is not valid JSON; it is shown as text.</p> : null}
      {shown || full?.state === "done" ? <RawRecord value={full?.state === "done" ? full.text : shown!.payload} line={record.line} /> : null}
    </li>
  );
});

function RecordBody({ view }: { view: RecordView }) {
  if (!view.text) return view.kind === "other" ? null : <p className="text-[0.7rem] text-muted-foreground italic">No text in this record.</p>;
  if (view.kind === "assistant") return <Clamped text={view.text}>{(text) => <HistoryMarkdown text={text} />}</Clamped>;
  if (view.kind === "human") return <Clamped text={view.text}>{(text) => <p className="font-mono text-[0.74rem] leading-relaxed break-words whitespace-pre-wrap">{text}</p>}</Clamped>;
  return (
    <Clamped text={view.text} closed={view.kind === "context" || view.kind === "instructions"}>
      {(text) => <pre className={cn("font-mono text-[0.7rem] leading-relaxed break-words whitespace-pre-wrap", view.kind === "reasoning" ? "text-muted-foreground italic" : "text-foreground/85")}>{text}</pre>}
    </Clamped>
  );
}

/** Long text is cut for rendering, never for copying. Harness context starts folded. */
function Clamped({ text, closed = false, children }: { text: string; closed?: boolean; children(text: string): React.ReactNode }) {
  const [open, setOpen] = useState(!closed);
  const [all, setAll] = useState(false);
  const limit = all ? renderLimit : clampChars;
  if (!open) return <button type="button" className="self-start text-[0.7rem] text-muted-foreground underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring" onClick={() => setOpen(true)}>Show {text.length.toLocaleString()} characters</button>;
  return (
    <>
      {children(text.length > limit ? text.slice(0, limit) : text)}
      {text.length > limit ? (
        <p className="flex flex-wrap items-center gap-2 text-[0.68rem] text-muted-foreground">
          Showing {limit.toLocaleString()} of {text.length.toLocaleString()} characters.
          {!all ? <button type="button" className="underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring" onClick={() => setAll(true)}>Show more</button> : null}
          <CopyButton value={text} label="full text" className="opacity-100" />
        </p>
      ) : null}
    </>
  );
}

/** The raw record as escaped JSON text, read only on demand. */
function RawRecord({ value, line }: { value: unknown; line: number }) {
  const [open, setOpen] = useState(false);
  const text = useMemo(() => !open ? "" : typeof value === "string" ? value : (() => { try { return JSON.stringify(value, null, 2) ?? "null"; } catch { return String(value); } })(), [open, value]);
  return (
    <details className="text-[0.66rem] text-muted-foreground" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="w-fit cursor-pointer rounded-sm select-none focus-visible:outline-2 focus-visible:outline-ring">Raw record</summary>
      {open ? (
        <div className="mt-1 flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span>{text.length.toLocaleString()} characters</span>
            <CopyButton value={text} label={`raw record line ${line}`} className="opacity-100" />
          </div>
          <pre className="max-h-96 overflow-auto rounded-md border bg-background/60 px-2 py-1.5 font-mono text-[0.66rem] leading-relaxed break-words whitespace-pre-wrap text-foreground/85">
            {text.length > renderLimit ? `${text.slice(0, renderLimit)}\n… ${(text.length - renderLimit).toLocaleString()} more characters; copy to read them all.` : text}
          </pre>
        </div>
      ) : null}
    </details>
  );
}

/** Retained text is content: no raw HTML, and embedded images are named rather than fetched. */
const markdownComponents: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
  img: ({ alt, src }) => <span className="rounded-sm bg-muted px-1 text-muted-foreground" title={typeof src === "string" ? src : undefined}>[image{alt ? `: ${alt}` : ""}]</span>,
  table: ({ node: _node, ...props }) => <div className="chat-table"><table {...props} /></div>,
};

const Block = memo(function Block({ source }: { source: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{source}</ReactMarkdown>;
});

function HistoryMarkdown({ text }: { text: string }) {
  const blocks = useMemo(() => markdownBlocks(text), [text]);
  return <div className="chat-md text-[0.78rem] break-words text-foreground/90">{blocks.map((source, index) => <Block key={index} source={source} />)}</div>;
}
