import { useSyncExternalStore } from "react";
import { botOrderFor, parseBotOrder, parseHostBotOrders, type BotOrders } from "../lib/botOrder";
import { loadSettingsSync } from "./settingsStore";

/**
 * Live copy of the per-computer bot orders (`AppSettings.botOrder` for this computer,
 * `AppSettings.hostBotOrders` for paired hosts) for providers that sit above the settings state
 * (the daemon data hook sorts `bots` with it).  AppShell pushes every settings change in here.
 */
const initial = loadSettingsSync();
let orders: BotOrders = {
  local: parseBotOrder(initial?.botOrder),
  hosts: parseHostBotOrders(initial?.hostBotOrders)
};
const listeners = new Set<() => void>();

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

export function setBotOrderSnapshot(local: readonly string[], hosts: Readonly<Record<string, readonly string[]>> = {}): void {
  const hostKeys = new Set([...Object.keys(orders.hosts), ...Object.keys(hosts)]);
  const same =
    sameList(orders.local, local) &&
    [...hostKeys].every((k) => sameList(orders.hosts[k] ?? [], hosts[k] ?? []));
  if (same) return;
  orders = { local, hosts };
  listeners.forEach((l) => l());
}

export function useBotOrder(computerId: string): readonly string[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => botOrderFor(orders, computerId)
  );
}
