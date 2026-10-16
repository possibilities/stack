export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** "bench" remains the canonical URL value for the workspace surface. */
export type WorkspaceSurface = "bench" | "right";
type OpenDocks = { rightOpen: boolean };

/** Retained dock content does not cover a deliberately revealed workspace on narrow screens. */
export function activeSurface(value: unknown, docks: OpenDocks): WorkspaceSurface {
  if (value === "bench") return value;
  if (value === "right" && docks.rightOpen) return value;
  return docks.rightOpen ? "right" : "bench";
}

export const dockMinimum = { right: 320, bench: 240 };

/** An open dock reserves a usable workspace. A contracted dock hides on desktop; narrow layouts use the selected surface. */
export function dockGeometry({ screenWidth, rightOpen, surface, rightWidth, expanded = false, contracted = false }: OpenDocks & {
  screenWidth: number; surface: WorkspaceSurface; rightWidth: number; expanded?: boolean; contracted?: boolean;
}) {
  const overlay = screenWidth < 900 || screenWidth < dockMinimum.bench + (rightOpen ? dockMinimum.right : 0);
  const rightVisible = rightOpen && (overlay ? surface === "right" : !contracted);
  const rightMax = Math.max(dockMinimum.right, screenWidth - dockMinimum.bench);
  const width = clamp(expanded ? rightMax : rightWidth, dockMinimum.right, rightMax);
  return { overlay, rightVisible, rightWidth: width, rightMax, right: !overlay && rightVisible ? width : 0 };
}
