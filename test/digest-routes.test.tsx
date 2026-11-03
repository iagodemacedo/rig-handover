import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';
import type { DigestRow, StatusTotals } from '../src/digest/types.js';

// Route tests for the digest page (plan § 2a) and JSON (§ 2b), through app.request().
// They read a temp runs dir; runs/ is read-only and never touched here.

type DigestJson = { night: string; rows: DigestRow[]; badLines: number; totals: StatusTotals };

const FULL = '2026-10-29'; // five valid lines, three jobs
const EMPTY = '2026-10-30'; // empty file
const BAD = '2026-10-31'; // one valid line and one truncated line
const MISSING = '2026-10-25'; // no file in the temp dir

const runsDir = mkdtempSync(join(tmpdir(), 'rig-runs-'));
afterAll(() => rmSync(runsDir, { recursive: true, force: true }));

// notes/backup is first in the file but last when sorted by job.
// fixtures/refresh has 3 retries (warn); notes/backup failed with no owner (warn, owner `—`);
// lane/sync is clean (no warn).
writeFileSync(
  join(runsDir, `${FULL}.jsonl`),
  [
    '{"at":"2026-10-29T01:00:01+01:00","job":"notes/backup","status":"fail","owner":null,"error":"quota exceeded"}',
    '{"at":"2026-10-29T01:30:00+01:00","job":"fixtures/refresh","status":"retry","owner":"rook","error":"upstream 503"}',
    '{"at":"2026-10-29T01:31:00+01:00","job":"fixtures/refresh","status":"retry","owner":"rook","error":"upstream 503"}',
    '{"at":"2026-10-29T01:33:00+01:00","job":"fixtures/refresh","status":"retry","owner":"rook","error":"upstream 503"}',
    '{"at":"2026-10-29T01:40:00+01:00","job":"lane/sync","status":"ok","owner":"rook"}',
  ].join('\n') + '\n',
);
writeFileSync(join(runsDir, `${EMPTY}.jsonl`), '');
writeFileSync(
  join(runsDir, `${BAD}.jsonl`),
  [
    '{"at":"2026-10-31T01:40:00+01:00","job":"lane/sync","status":"ok","owner":"rook"}',
    '{"at":"2026-10-31T02:00:03+01:00","job":"lane/sync","sta',
  ].join('\n') + '\n',
);

const config: RigConfig = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir,
};
const app = createApp(config);

// The <tr> holding a job's name, from its opening tag to its closing tag.
function rowOf(html: string, job: string): string {
  const at = html.indexOf(job);
  if (at < 0) throw new Error(`${job} is not on the page`);
  const start = html.lastIndexOf('<tr', at);
  return html.slice(start, html.indexOf('</tr>', at) + '</tr>'.length);
}

const warnRows = (html: string) => html.split('<tr class="warn">').length - 1;

describe('GET /digest/:night', () => {
  it('200 for a night with a file: one row per job, warn for 3+ retries or a fail', async () => {
    const res = await app.request(`/digest/${FULL}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain(`digest ${FULL}`);
    expect(warnRows(html)).toBe(2);
    expect(rowOf(html, 'fixtures/refresh')).toContain('<tr class="warn">');
    expect(rowOf(html, 'notes/backup')).toContain('<tr class="warn">');
    expect(rowOf(html, 'lane/sync')).not.toContain('class="warn"');
    expect(rowOf(html, 'notes/backup')).toContain('—');
    expect(html).toContain('bad lines: 0');
  });

  it('keeps the offset of the log times on the page', async () => {
    const html = await (await app.request(`/digest/${FULL}`)).text();
    expect(rowOf(html, 'fixtures/refresh')).toContain('01:30:00+01:00');
    expect(rowOf(html, 'fixtures/refresh')).toContain('01:33:00+01:00');
  });

  it('200 for an empty file: nothing ran, bad lines 0', async () => {
    const res = await app.request(`/digest/${EMPTY}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('nothing ran');
    expect(html).toContain('bad lines: 0');
  });

  it('404 for a night with no file', async () => {
    const res = await app.request(`/digest/${MISSING}`);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain(`no run log for ${MISSING}`);
  });

  it('200 for a night with a bad line: counted, and the good row still shown', async () => {
    const res = await app.request(`/digest/${BAD}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('bad lines: 1');
    expect(rowOf(html, 'lane/sync')).toContain('01:40:00+01:00');
  });
});

describe('GET /api/digest/:night', () => {
  it('200 with the rows sorted by job, the bad-line count and the totals', async () => {
    const res = await app.request(`/api/digest/${FULL}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      night: FULL,
      rows: [
        {
          job: 'fixtures/refresh',
          owner: 'rook',
          runs: 3,
          retries: 3,
          lastStatus: 'retry',
          lastError: 'upstream 503',
          firstAt: '2026-10-29T01:30:00+01:00',
          lastAt: '2026-10-29T01:33:00+01:00',
        },
        {
          job: 'lane/sync',
          owner: 'rook',
          runs: 1,
          retries: 0,
          lastStatus: 'ok',
          lastError: null,
          firstAt: '2026-10-29T01:40:00+01:00',
          lastAt: '2026-10-29T01:40:00+01:00',
        },
        {
          job: 'notes/backup',
          owner: null,
          runs: 1,
          retries: 0,
          lastStatus: 'fail',
          lastError: 'quota exceeded',
          firstAt: '2026-10-29T01:00:01+01:00',
          lastAt: '2026-10-29T01:00:01+01:00',
        },
      ],
      badLines: 0,
      totals: { ok: 1, retry: 3, fail: 1 },
    });
  });

  it('200 for an empty file: no rows, bad lines 0', async () => {
    const res = await app.request(`/api/digest/${EMPTY}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      night: EMPTY,
      rows: [],
      badLines: 0,
      totals: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('404 for a night with no file', async () => {
    const res = await app.request(`/api/digest/${MISSING}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no run log', night: MISSING });
  });

  it('200 for a night with a bad line: badLines 1, the good line still counted', async () => {
    const res = await app.request(`/api/digest/${BAD}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      night: BAD,
      rows: [
        {
          job: 'lane/sync',
          owner: 'rook',
          runs: 1,
          retries: 0,
          lastStatus: 'ok',
          lastError: null,
          firstAt: '2026-10-31T01:40:00+01:00',
          lastAt: '2026-10-31T01:40:00+01:00',
        },
      ],
      badLines: 1,
      totals: { ok: 1, retry: 0, fail: 0 },
    });
  });
});

describe('page and JSON agree', () => {
  it('the jobs appear on the page in the same order as the JSON rows', async () => {
    const html = await (await app.request(`/digest/${FULL}`)).text();
    const body = (await (await app.request(`/api/digest/${FULL}`)).json()) as DigestJson;
    const positions = body.rows.map((r) => html.indexOf(r.job));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});
