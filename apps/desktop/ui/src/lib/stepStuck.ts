import type { ToolItem } from "../state/timeline.ts";

/** A step still running after this long gets a "taking longer than usual" hint. */
export const SLOW_STEP_MS = 60_000;

/** Is the call in flight (asked for or running), as opposed to finished, refused or waiting for the owner? */
export function isInFlight(status: ToolItem["status"]): boolean {
  return status === "requested" || status === "running";
}

/** Has an in-flight step been going on longer than usual? */
export function isSlowStep(tool: Pick<ToolItem, "status" | "requestedMs">, nowMs: number): boolean {
  return isInFlight(tool.status) && nowMs - tool.requestedMs >= SLOW_STEP_MS;
}

/**
 * An in-flight step in a chain that is no longer live: its end event never came (the run was
 * stopped, restarted or lost), so it must not be shown as running.
 */
export function isOrphanStep(status: ToolItem["status"], chainLive: boolean): boolean {
  return isInFlight(status) && !chainLive;
}
