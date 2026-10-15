"use client";

import { useState } from "react";
import { PlusIcon, RotateCcwIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Separator } from "@/components/ui/separator";
import { paneIds, type Placement } from "@/lib/stack/pane-layout";
import type { PaneLayout, PaneLayoutStore } from "@/lib/stack/pane-state";
import { paneDescription, type WindowDef } from "./spaces";

export function PaneCatalog({ title, defs, layout, visible, store, side, onClose, onReveal, pin }: {
  title: string; defs: WindowDef[]; layout: PaneLayout; visible: string[]; store: PaneLayoutStore; side?: Placement;
  onClose(): void; onReveal(id: string): void; pin?: { title: string; create(side?: Placement): void };
}) {
  const [placement, setPlacement] = useState<Placement | "restore">(side ?? "restore");
  const open = new Set(paneIds(layout.tree));
  const status = (id: string) => !open.has(id) ? "Closed" : layout.zoom && layout.zoom !== id ? "Behind zoom" : !visible.includes(id) ? "Behind tab" : layout.focus === id ? "Focused" : "Open";
  const reveal = (id: string) => { store.open(id, placement === "restore" ? undefined : placement); onClose(); onReveal(id); };
  return <Dialog open onOpenChange={(value) => { if (!value) onClose(); }}>
    <DialogContent className="flex max-h-[min(85dvh,680px)] flex-col gap-3 sm:max-w-xl" finalFocus={() => document.querySelector<HTMLElement>(`[data-pane-frame="${CSS.escape(store.getSnapshot().focus ?? "")}"]`)}>
      <DialogHeader><DialogTitle>Panes in {title}</DialogTitle><DialogDescription>Reveal an open pane or bring back a closed one. Closing never stops its work.</DialogDescription></DialogHeader>
      <ToggleGroup aria-label="Reopen placement" size="sm" spacing={0} variant="outline" value={[placement]} onValueChange={(values) => { if (values[0]) setPlacement(values[0] as Placement | "restore"); }}>
        <ToggleGroupItem value="restore">Where it was</ToggleGroupItem><ToggleGroupItem value="right">Beside</ToggleGroupItem><ToggleGroupItem value="below">Below</ToggleGroupItem><ToggleGroupItem value="tab">As tab</ToggleGroupItem>
      </ToggleGroup>
      <Command className="min-h-0 flex-1">
        <CommandInput placeholder="Find a pane…" aria-label={`Find a pane in ${title}`} />
        <CommandList className="max-h-none min-h-0 flex-1">
          <CommandEmpty>No matching panes.</CommandEmpty>
          <CommandGroup heading="All available panes">
            {defs.map((def) => <CommandItem key={def.id} value={`${def.id} ${def.title} ${paneDescription(def)}`} onSelect={() => reveal(def.id)}>
              <def.icon /><span className="flex min-w-0 flex-1 flex-col"><span className="truncate">{def.title}{/-\d+$/.test(def.id) ? ` · ${def.id}` : ""}</span><span className="truncate text-xs text-muted-foreground">{paneDescription(def)}</span></span><Badge variant="secondary">{status(def.id)}</Badge>
            </CommandItem>)}
          </CommandGroup>
          {pin ? <CommandGroup heading="Additional instance"><CommandItem onSelect={() => { onClose(); pin.create(placement === "restore" ? undefined : placement); }}><PlusIcon />{pin.title}</CommandItem></CommandGroup> : null}
        </CommandList>
      </Command>
      <Separator />
      <Button variant="ghost" size="sm" onClick={() => { store.preset(layout.preset); onClose(); }}><RotateCcwIcon data-icon="inline-start" />Reset this layout</Button>
    </DialogContent>
  </Dialog>;
}
