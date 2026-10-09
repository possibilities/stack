"use client";

import { HistoryIcon, RssIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { completionDelivery, completionDiagnostic, completionReceiptLabels, completionUncertainty, completionWatch, noBotWatch, receiptQuery } from "@/lib/stack/completion";
import { relativeTime } from "@/lib/stack/derive";
import { localOperation, type LocalAccess } from "@/lib/stack/state";
import type { ServeCompletionPage, ServeCompletionReceipt } from "@/lib/stack/types";
import { ObservationStatus, useKeyedRead, type ReadOwner } from "./owner-reads";
import { CopyButton, Empty, NodeLink, StatusDot } from "./primitives";
import { useNow, useStack, useStore, useWorkbench } from "./provider";
import { receiptTone } from "./subscription-views";

const hintClass = "text-[0.72rem] text-pretty text-muted-foreground";
const labelClass = "text-[0.66rem] font-medium tracking-[0.06em] text-muted-foreground uppercase";

/**
 * One-shot reads that re-read when the key, the caller's `observe` signature or the shared
 * completion generation change. Stale answers and answers for an earlier key are dropped.
 */
export function useObservedRead<T>(key: string | null, observe: unknown, read: () => Promise<T>, owner: ReadOwner) {
  const state = useStack();
  return useKeyedRead(read, key, JSON.stringify([observe, state.completionGeneration]), owner);
}

export type WatchReceipts = {
  receipts: ServeCompletionReceipt[];
  total: number;
  truncated: boolean;
  error: string | null;
  loading: boolean;
  hasRead: boolean;
  stale: boolean;
  pending: "first" | "refresh" | "more" | null;
  unavailable: string | null;
  access: LocalAccess;
  reload(): void;
};

/**
 * `serve_completion_list` for one exact record: one read while mounted (the caller mounts only on
 * open/expand), re-read when `observe` or the shared `completionGeneration` changes. Stale answers
 * are dropped; an error is unavailable, never an empty watch list.
 */
export function useWatchReceipts(query: Record<string, unknown> | null, observe: unknown): WatchReceipts {
  const state = useStack();
  const store = useStore();
  const access = localOperation(state, "serve", "serve_completion_list");
  const key = query ? JSON.stringify(query) : null;
  const read = useObservedRead<ServeCompletionPage>(key, observe, () => store.call<ServeCompletionPage>("serve", "serve_completion_list", JSON.parse(key!)), { pkg: "serve", operation: "serve_completion_list" });
  return {
    receipts: read.data?.completions ?? [], total: read.data?.total ?? 0, truncated: read.data?.truncated ?? false,
    error: read.error, hasRead: read.hasRead, loading: !read.hasRead && read.loading, stale: read.stale, pending: read.pending, unavailable: read.unavailable, access, reload: read.reload,
  };
}

/** One retained receipt compactly: its state, delivery facts, origin and a link into History. */
export function ReceiptSummary({ receipt, pkg }: { receipt: ServeCompletionReceipt; pkg: string }) {
  const state = useStack();
  const store = useStore();
  const { goTo } = useWorkbench();
  const now = useNow(30_000);
  const stateLabel = completionReceiptLabels[receipt.state];
  const watch = completionWatch(receipt);
  const uncertainty = completionUncertainty(receipt);
  const diagnostic = completionDiagnostic(receipt);
  const delivery = completionDelivery(receipt);
  const knownBot = state.bots.data?.some((bot) => bot.id === receipt.botId);
  const history = () => {
    void store.showCompletionHistory({ botId: receipt.botId, package: pkg });
    goTo({ kind: "subscription", id: receipt.id });
  };
  return (
    <div data-receipt={receipt.id} className="flex flex-col gap-1 rounded-lg border border-dashed px-2 py-1.5">
      <div className="flex min-w-0 items-center gap-2 text-xs">
        <StatusDot tone={receiptTone[receipt.state]} label={stateLabel.label} />
        <span className="shrink-0 font-medium" title={stateLabel.description}>{stateLabel.label}</span>
        <span className="min-w-0 truncate text-muted-foreground">{receipt.operation}</span>
        <span className="ml-auto shrink-0 text-muted-foreground" title={watch.description}>{watch.label}</span>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 pl-3.5 text-xs text-muted-foreground">
        <span>{knownBot ? <NodeLink node={{ kind: "bot", id: receipt.botId }} label={`Bot ${receipt.botId}`}>{receipt.botId}</NodeLink> : receipt.botId}</span>
        <span className="inline-flex min-w-0 items-center gap-0.5 font-mono text-[0.68rem] break-all" title={`Thread ${receipt.threadId}`}>
          thread {receipt.threadId}<CopyButton value={receipt.threadId} label="thread ID" className="size-5 opacity-100" />
        </span>
      </div>
      <p className="pl-3.5 text-xs text-muted-foreground">
        {delivery.map((part) => part.at === null ? part.text : `${part.text} ${relativeTime(part.at, now)}`).join(" · ")}
      </p>
      {uncertainty ? <p role="note" className="pl-3.5 text-[0.72rem] text-pretty text-warning">{uncertainty}</p> : null}
      {diagnostic ? <p className="pl-3.5 text-[0.72rem] text-pretty text-muted-foreground">{diagnostic}</p> : null}
      <div className="flex items-center gap-1 pl-2.5">
        <Button size="xs" variant="ghost" onClick={history}><HistoryIcon />Open in History</Button>
        <span className="ml-auto font-mono text-[0.64rem] text-muted-foreground" title={`Receipt ${receipt.id}`}>receipt {receipt.id.slice(0, 8)}</span>
      </div>
    </div>
  );
}

/**
 * One record's Bot watch: the retained receipt(s) for its exact request, then the domain's exact
 * observation under them. No receipt is "No Bot watch requested", never an offer to subscribe;
 * an unreadable history or a closed channel is unavailable, never empty. Remote pages render nothing.
 */
export function BotWatch({ pkg, recordId, origin, observe, children }: {
  pkg: "browse" | "worker" | "proc" | "brain";
  recordId: string;
  origin?: { botId?: string; threadId?: string };
  /** Re-read signature: the record's revision or state key. */
  observe: unknown;
  children?(receipts: ServeCompletionReceipt[]): React.ReactNode;
}) {
  const state = useStack();
  const watch = useWatchReceipts(recordId ? receiptQuery(pkg, recordId, origin) : null, observe);
  if (state.remote) return null;
  return (
    <section data-bot-watch={pkg} aria-label="Bot watch" className="flex flex-col gap-1.5">
      <h3 className={labelClass}>Bot watch</h3>
      <ObservationStatus read={watch} />
      {watch.error ? (
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 text-[0.72rem] text-destructive">Bot watch unavailable: {watch.error}</p>
            <Button size="xs" variant="ghost" onClick={watch.reload}>Read again</Button>
          </div>
        ) : null}
      {watch.loading ? <p className="flex items-center gap-1.5 text-[0.72rem] text-muted-foreground"><Spinner className="size-3" />Reading watch receipts…</p> : null}
      {watch.hasRead ? watch.receipts.length === 0 ? <Empty icon={RssIcon} title="No Bot watch requested" hint={noBotWatch[pkg]} />
        : (
          <div className="flex flex-col gap-1.5">
            {watch.receipts.map((receipt) => <ReceiptSummary key={receipt.id} receipt={receipt} pkg={pkg} />)}
            {watch.truncated ? <p className={hintClass}>Showing {watch.receipts.length} of {watch.total} receipts for this exact record.</p> : null}
            {children?.(watch.receipts)}
          </div>
        ) : null}
    </section>
  );
}
