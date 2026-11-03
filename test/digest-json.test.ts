import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { readNight } from '../src/digest/read.js';

// runs/ is read-only: only read here. Fuller route tests (temp dir, empty night) are #5.
const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: 'runs' };

describe('GET /api/digest/:night', () => {
  it('returns the reader rows as is, in job order', async () => {
    const res = await createApp(config).request('/api/digest/2026-10-28');
    const night = readNight('runs', '2026-10-28');
    if (!night.found) throw new Error('expected the night to be found');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      night: '2026-10-28',
      rows: night.rows,
      badLines: 1,
      totals: { ok: 10, retry: 4, fail: 1 },
    });
    expect(night.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
  });

  it('404s a night with no file', async () => {
    const res = await createApp(config).request('/api/digest/2026-01-01');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no run log', night: '2026-01-01' });
  });
});
