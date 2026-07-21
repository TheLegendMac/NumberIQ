/** The subset of a per-slot game summary needed for freshness displays. */
interface SlotDataSummary {
  slot: string;
  count: number;
  last: string;
}

interface GameDataSummary {
  slots: string[];
  data: SlotDataSummary[];
}

/** Most recent recorded draw date, optionally restricted to one drawing slot. */
export function latestDataDate(data: readonly SlotDataSummary[], slot?: string): string | null {
  let latest: string | null = null;
  for (const entry of data) {
    if (entry.count <= 0 || !entry.last || (slot !== undefined && entry.slot !== slot)) continue;
    if (latest === null || entry.last > latest) latest = entry.last;
  }
  return latest;
}

/**
 * Slot to show in Today's all-games results.
 *
 * A genuinely newer alternate drawing wins. When dates tie—as Powerball Main
 * Draw and Double Play normally do—the first slot declared by the game wins.
 */
export function latestResultSlot(game: GameDataSummary): string | null {
  let best: SlotDataSummary | null = null;
  for (const entry of game.data) {
    if (entry.count <= 0 || !entry.last) continue;
    if (best === null || entry.last > best.last) {
      best = entry;
      continue;
    }
    if (entry.last !== best.last) continue;

    const entryOrder = game.slots.indexOf(entry.slot);
    const bestOrder = game.slots.indexOf(best.slot);
    const entryRank = entryOrder < 0 ? Number.MAX_SAFE_INTEGER : entryOrder;
    const bestRank = bestOrder < 0 ? Number.MAX_SAFE_INTEGER : bestOrder;
    if (entryRank < bestRank) best = entry;
  }
  return best?.slot ?? null;
}
