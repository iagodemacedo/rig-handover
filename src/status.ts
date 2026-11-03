import { readdirSync } from 'node:fs';
import type { RigConfig } from './config.js';
import { readNight } from './digest/read.js';
import type { StatusTotals } from './digest/types.js';
import { lastBeat, type Beat } from './heartbeat.js';

// One night on the board: its date and the ok / retry / fail line counts (plan § 2c).
// totals is null when the night can't be read as found; the view shows `—`.
export type NightSummary = { night: string; totals: StatusTotals | null };

export type Status = {
  adapter: string;
  installed: string;
  lastBeat: Beat | null;
  nights: NightSummary[];
};

// Nights on disk = runs/<YYYY-MM-DD>.jsonl, newest first.
export function nightsOnDisk(runsDir: string): string[] {
  try {
    return readdirSync(runsDir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .map((f) => f.slice(0, 10))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

// Counts come from the digest reader, so the board and the digest page never disagree.
export function summarizeNight(runsDir: string, night: string): NightSummary {
  try {
    const digest = readNight(runsDir, night);
    return { night, totals: digest.found ? digest.totals : null };
  } catch {
    return { night, totals: null };
  }
}

export function readStatus(config: RigConfig): Status {
  return {
    adapter: config.adapter,
    installed: config.installed,
    lastBeat: lastBeat(),
    nights: nightsOnDisk(config.runsDir).map((night) => summarizeNight(config.runsDir, night)),
  };
}
