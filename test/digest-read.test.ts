import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';
import type { NightDigest } from '../src/digest/types.js';

// runs/ is read-only: the real night is only read; everything written goes to a temp dir.
const RUNS = fileURLToPath(new URL('../runs', import.meta.url));

function found(n: NightDigest) {
  if (!n.found) throw new Error('expected the night to be found');
  return n;
}

describe('readNight on runs/2026-10-28.jsonl', () => {
  const night = found(readNight(RUNS, '2026-10-28'));
  const row = (job: string) => night.rows.find((r) => r.job === job);

  it('has 5 jobs, sorted by job, and 1 bad line', () => {
    expect(night.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
    expect(night.badLines).toBe(1);
  });

  it('totals valid lines by status', () => {
    expect(night.totals).toEqual({ ok: 10, retry: 4, fail: 1 });
  });

  it('fixtures/refresh retried 3 times and ended ok, keeping the last error seen', () => {
    expect(row('fixtures/refresh')).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
  });

  it('notes/backup failed', () => {
    expect(row('notes/backup')).toEqual({
      job: 'notes/backup',
      owner: 'lane-07',
      runs: 1,
      retries: 0,
      lastStatus: 'fail',
      lastError: 'quota exceeded',
      firstAt: '2026-10-29T04:00:01+01:00',
      lastAt: '2026-10-29T04:00:01+01:00',
    });
  });

  it('keeps digest/render with a null owner', () => {
    expect(row('digest/render')).toEqual({
      job: 'digest/render',
      owner: null,
      runs: 1,
      retries: 0,
      lastStatus: 'ok',
      lastError: null,
      firstAt: '2026-10-29T05:41:09+01:00',
      lastAt: '2026-10-29T05:41:09+01:00',
    });
  });

  it('lane/sync spans the night, the truncated last line not counted as a run', () => {
    expect(row('lane/sync')).toEqual({
      job: 'lane/sync',
      owner: 'rook',
      runs: 8,
      retries: 1,
      lastStatus: 'ok',
      lastError: 'lock held',
      firstAt: '2026-10-28T23:00:06+01:00',
      lastAt: '2026-10-29T05:00:04+01:00',
    });
    expect(row('rig/rotate-logs')).toMatchObject({ owner: 'lane-07', runs: 1, lastStatus: 'ok', lastError: null });
  });
});

describe('readNight on a temp runs dir', () => {
  const root = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  const runs = join(root, 'runs');
  mkdirSync(runs);
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const write = (night: string, lines: string[]) => writeFileSync(join(runs, `${night}.jsonl`), lines.join('\n'));
  const line = (fields: Record<string, unknown>) =>
    JSON.stringify({ at: '2026-11-01T01:00:00+01:00', job: 'a/job', status: 'ok', owner: 'rook', ...fields });

  it('a night with no file is not found', () => {
    expect(readNight(runs, '2026-11-30')).toEqual({ found: false });
  });

  it('a runs dir that does not exist is not found', () => {
    expect(readNight(join(root, 'nope'), '2026-11-30')).toEqual({ found: false });
  });

  it('an empty file is found, with nothing in it', () => {
    write('2026-11-01', []);
    expect(readNight(runs, '2026-11-01')).toEqual({
      found: true,
      rows: [],
      badLines: 0,
      totals: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('anything but YYYY-MM-DD is not found, even if a file is there', () => {
    writeFileSync(join(root, 'secret.jsonl'), line({}));
    write('latest', [line({})]);
    for (const night of ['../secret', 'latest', '2026-11-1', '2026-11-01.jsonl', '', '2026-11-01/../2026-11-01']) {
      expect(readNight(runs, night)).toEqual({ found: false });
    }
  });

  it('counts bad lines without throwing and keeps the good ones', () => {
    write('2026-11-02', [
      line({ job: 'kept' }),
      '{"at":"2026-11-02T01:00:00+01:00","job":"cut', // bad JSON
      'not json at all',
      '42',
      '[]',
      'null',
      line({ job: undefined }), // missing job
      line({ job: '' }),
      line({ job: 7 }),
      line({ status: 'skipped' }),
      line({ status: undefined }),
      line({ at: undefined }),
      line({ at: '2026-11-02T01:00:00' }), // no offset
      line({ at: 'yesterday' }),
      line({ owner: 42 }),
      line({ error: { code: 500 } }),
    ]);
    const night = found(readNight(runs, '2026-11-02'));
    expect(night.badLines).toBe(15);
    expect(night.rows.map((r) => r.job)).toEqual(['kept']);
    expect(night.totals).toEqual({ ok: 1, retry: 0, fail: 0 });
  });

  it('a file with only bad lines is found with no rows', () => {
    write('2026-11-03', ['{', 'nope']);
    expect(readNight(runs, '2026-11-03')).toEqual({
      found: true,
      rows: [],
      badLines: 2,
      totals: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('skips blank lines and handles CRLF', () => {
    writeFileSync(join(runs, '2026-11-04.jsonl'), `\n${line({})}\r\n   \r\n${line({ status: 'retry' })}\r\n\n`);
    const night = found(readNight(runs, '2026-11-04'));
    expect(night.badLines).toBe(0);
    expect(night.rows).toMatchObject([{ job: 'a/job', runs: 2, retries: 1, lastStatus: 'retry' }]);
  });

  it('keeps every offset as written and takes first/last by file order', () => {
    write('2026-11-05', [
      line({ at: '2026-11-05T01:00:00-05:00' }),
      line({ at: '2026-11-05T03:00:00Z' }),
      line({ at: '2026-11-05T05:00:00.250+05:30' }),
    ]);
    expect(found(readNight(runs, '2026-11-05')).rows[0]).toMatchObject({
      firstAt: '2026-11-05T01:00:00-05:00',
      lastAt: '2026-11-05T05:00:00.250+05:30',
    });
  });

  it('owner and status come from the latest line; lastError is the most recent error seen', () => {
    write('2026-11-06', [
      line({ status: 'retry', error: 'first' }),
      line({ status: 'fail', error: 'second' }),
      line({ status: 'ok', owner: null }),
      line({ job: 'clean' }),
    ]);
    expect(found(readNight(runs, '2026-11-06')).rows).toEqual([
      expect.objectContaining({ job: 'a/job', owner: null, runs: 3, retries: 1, lastStatus: 'ok', lastError: 'second' }),
      expect.objectContaining({ job: 'clean', owner: 'rook', lastError: null }),
    ]);
  });

  it('missing, null or blank owner and error read as null', () => {
    write('2026-11-07', [
      line({ job: 'no-owner', owner: undefined }),
      line({ job: 'null-owner', owner: null, error: null }),
      line({ job: 'blank', owner: '  ', error: '' }),
    ]);
    const night = found(readNight(runs, '2026-11-07'));
    expect(night.badLines).toBe(0);
    for (const r of night.rows) expect(r).toMatchObject({ owner: null, lastError: null });
  });

  it('sorts by plain string compare, not locale', () => {
    write('2026-11-08', [line({ job: 'b' }), line({ job: 'a' }), line({ job: 'B' }), line({ job: 'a/x' })]);
    expect(found(readNight(runs, '2026-11-08')).rows.map((r) => r.job)).toEqual(['B', 'a', 'a/x', 'b']);
  });
});
