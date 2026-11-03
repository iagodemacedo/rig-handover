import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, ReadNight, RunStatus, StatusTotals } from './types.js';

// Plan § 1. Rules for what a valid line is, and what the result means: ./types.ts.

type RunLine = { at: string; job: string; status: RunStatus; owner: string | null; error: string | null };

// Only YYYY-MM-DD reaches the filesystem: no path traversal through `night`.
const NIGHT = /^\d{4}-\d{2}-\d{2}$/;
// ISO 8601 date-time with an explicit offset. The string itself is kept as written.
const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
// Keyed by RunStatus, so adding a status without updating this fails to compile.
const STATUSES: Record<RunStatus, true> = { ok: true, retry: true, fail: true };

const isStatus = (v: unknown): v is RunStatus => typeof v === 'string' && Object.hasOwn(STATUSES, v);
const isText = (v: unknown): v is string | null | undefined => v == null || typeof v === 'string';
const blankToNull = (v: string | null | undefined): string | null => (v?.trim() ? v : null);

function parseLine(text: string): RunLine | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { at, job, status, owner, error } = value as Record<string, unknown>;
  if (typeof at !== 'string' || !AT.test(at)) return null;
  if (typeof job !== 'string' || job.trim() === '') return null;
  if (!isStatus(status) || !isText(owner) || !isText(error)) return null;
  return { at, job, status, owner: blankToNull(owner), error: blankToNull(error) };
}

function readFileOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (e) {
    if (e instanceof Error && 'code' in e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return null;
    throw e;
  }
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!NIGHT.test(night)) return { found: false };
  const text = readFileOrNull(join(runsDir, `${night}.jsonl`));
  if (text === null) return { found: false };

  const byJob = new Map<string, DigestRow>();
  const totals: StatusTotals = { ok: 0, retry: 0, fail: 0 };
  let badLines = 0;

  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue;
    const line = parseLine(raw);
    if (!line) {
      badLines++;
      continue;
    }
    totals[line.status]++;
    const retry = line.status === 'retry' ? 1 : 0;
    const row = byJob.get(line.job);
    if (!row) {
      byJob.set(line.job, {
        job: line.job,
        owner: line.owner,
        runs: 1,
        retries: retry,
        lastStatus: line.status,
        lastError: line.error,
        firstAt: line.at,
        lastAt: line.at,
      });
      continue;
    }
    // File order is the log's order: the latest line wins, except a later line without an
    // error doesn't clear the last error seen.
    row.owner = line.owner;
    row.runs++;
    row.retries += retry;
    row.lastStatus = line.status;
    row.lastError = line.error ?? row.lastError;
    row.lastAt = line.at;
  }

  // Plain string compare, not localeCompare: one order everywhere, independent of locale.
  const rows = [...byJob.values()].sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0));
  return { found: true, rows, badLines, totals };
};
