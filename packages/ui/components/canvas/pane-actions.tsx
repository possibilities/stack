"use client";

import { Columns2Icon, Maximize2Icon, Minimize2Icon, MoreHorizontalIcon, Rows2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Placement } from "@/lib/stack/pane-layout";
import type { PaneContextValue } from "./pane-context";

export function PaneActions({ title, pane }: { title: string; pane: PaneContextValue }) {
  return <>
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label={`Arrange ${title}`} />}><MoreHorizontalIcon /></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => pane.catalog("right")}><Columns2Icon />Open pane beside</DropdownMenuItem>
          <DropdownMenuItem onClick={() => pane.catalog("below")}><Rows2Icon />Open pane below</DropdownMenuItem>
        </DropdownMenuGroup>
        {pane.destinations.length ? <><DropdownMenuSeparator /><DropdownMenuGroup>
          {([["left", "Move left of"], ["right", "Move right of"], ["above", "Move above"], ["below", "Move below"], ["tab", "Stack with"]] as [Placement, string][]).map(([side, label]) => <DropdownMenuSub key={side}>
            <DropdownMenuSubTrigger>{label}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent><DropdownMenuGroup>{pane.destinations.map((target) => <DropdownMenuItem key={target.id} onClick={() => pane.move(target.id, side)}>{target.title}</DropdownMenuItem>)}</DropdownMenuGroup></DropdownMenuSubContent>
          </DropdownMenuSub>)}
        </DropdownMenuGroup></> : null}
      </DropdownMenuContent>
    </DropdownMenu>
    <Button variant="ghost" size="icon-xs" aria-label={`${pane.zoomed ? "Restore" : "Zoom"} ${title}`} title={pane.zoomed ? "Restore pane (Z)" : "Zoom pane (Z)"} onClick={pane.zoom}>{pane.zoomed ? <Minimize2Icon /> : <Maximize2Icon />}</Button>
    <Button variant="ghost" size="icon-xs" aria-label={`Close ${title}`} title={pane.canClose ? "Close pane; reopen from Panes" : "Keep at least one pane open"} disabled={!pane.canClose} onClick={pane.close}><XIcon /></Button>
  </>;
}
