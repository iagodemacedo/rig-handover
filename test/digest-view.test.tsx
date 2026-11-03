import { describe, expect, it } from 'vitest';
import type { DigestRow, NightDigest } from '../src/digest/types.js';
import { DigestPage } from '../src/views/digest.js';

const row = (over: Partial<DigestRow>): DigestRow => ({
  job: 'a/job',
  owner: 'rook',
  runs: 1,
  retries: 0,
  lastStatus: 'ok',
  lastError: null,
  firstAt: '2026-10-29T01:00:00+01:00',
  lastAt: '2026-10-29T01:00:00+01:00',
  ...over,
});

const found = (rows: DigestRow[], badLines = 0): NightDigest => ({
  found: true,
  rows,
  badLines,
  totals: { ok: 0, retry: 0, fail: 0 },
});

const render = async (digest: NightDigest) => String(await (<DigestPage night="2026-10-28" digest={digest} />));
const warnRows = (html: string) => [...html.matchAll(/<tr class="warn"><td>([^<]*)<\/td>/g)].map((m) => m[1]);

describe('DigestPage marking', () => {
  it('marks retries of 3 or more and any fail, nothing else', async () => {
    const html = await render(
      found([
        row({ job: 'ok-two-retries', retries: 2 }),
        row({ job: 'ok-three-retries', retries: 3 }),
        row({ job: 'failed', lastStatus: 'fail' }),
        row({ job: 'recovered', retries: 1, lastStatus: 'ok', lastError: 'x' }),
      ]),
    );
    expect(warnRows(html)).toEqual(['ok-three-retries', 'failed']);
  });

  it('renders missing data as a dash and keeps the log offset', async () => {
    const html = await render(found([row({ owner: null, lastError: null })], 2));
    expect(html).toContain('<td>—</td><td>1</td>');
    expect(html).toContain('2026-10-29T01:00:00+01:00');
    expect(html).toContain('<p class="mute">bad lines: 2</p>');
  });

  it('renders "nothing ran" instead of the table for an empty night', async () => {
    const html = await render(found([]));
    expect(html).toContain('<p class="mute">nothing ran</p>');
    expect(html).not.toContain('<table');
    expect(html).toContain('bad lines: 0');
  });
});
