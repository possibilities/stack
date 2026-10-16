"use client";

import { createContext, use } from "react";
import type { Placement } from "@/lib/stack/pane-layout";

export type PaneContextValue = {
  visible: boolean; focused: boolean; zoomed: boolean; canClose: boolean; dragging: boolean;
  destinations: { id: string; title: string }[];
  focus(): void; startDrag(event: React.PointerEvent): void;
  close(): void; zoom(): void; catalog(side: Placement): void; move(target: string, side: Placement): void;
};
export const PaneContext = createContext<PaneContextValue | null>(null);
export const usePane = () => use(PaneContext);
