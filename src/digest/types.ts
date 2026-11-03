// Contract for the morning digest (plan § 1 and § 2). Types only: § 2 builds against this file,
// the reader lives in ./read.ts (`readNight`, of type `ReadNight` below).

export type RunStatus = 'ok' | 'retry' | 'fail';

// One row per job in a night's run log, built from that job's valid lines in file order.
export type DigestRow = {
  job: string;
  // From the job's latest line. null when the log has none; views show it as `—`.
  owner: string | null;
  // Valid lines for this job.
  runs: number;
  // Lines with status `retry`.
  retries: number;
  // Status of the job's latest line.
  lastStatus: RunStatus;
  // Most recent `error` seen for this job, even if a later line was ok; null if it never erred.
  lastError: string | null;
  // `at` of the job's first and latest line, exactly as written: offset kept, never UTC.
  firstAt: string;
  lastAt: string;
};

// Valid lines in the night by status, `{ ok, retry, fail }` (the board's counts, § 2c).
export type StatusTotals = Record<RunStatus, number>;

// found: false → no file for that night, or `night` isn't YYYY-MM-DD (§ 2a answers 404).
// found: true, rows: [] → the file exists but nothing ran (still show badLines if any).
export type NightDigest =
  | { found: false }
  | {
      found: true;
      // Sorted by job, plain string compare (not locale): page and JSON share one order.
      rows: DigestRow[];
      // Non-blank lines that aren't a valid run line. Counted, never thrown.
      badLines: number;
      totals: StatusTotals;
    };

// readNight(runsDir, night) reads `<runsDir>/<night>.jsonl`, synchronously.
// A valid line is a JSON object with `at` (ISO 8601 date-time with offset, Z or ±hh:mm),
// `job` (non-empty string), `status` (ok | retry | fail), `owner` (string or null; absent or
// blank = null) and optional `error` (string or null; blank = null). Anything else is a bad
// line. Blank lines are skipped. Throws only on unexpected I/O errors (e.g. permission denied).
export type ReadNight = (runsDir: string, night: string) => NightDigest;
