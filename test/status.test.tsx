import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: 'runs' };

describe('status board', () => {
  it('shows the lane banner and the nights on disk', async () => {
    process.env.LANE_MARKER = 'TEST-MARKER';
    const res = await createApp(config).request('/');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('TEST-MARKER');
    expect(html).toContain('2026-10-28');
  });

  it('links each night to its digest with its ok / retry / fail counts', async () => {
    const res = await createApp(config).request('/');
    const html = await res.text();
    expect(html).toContain(
      '<li><a href="/digest/2026-10-28">2026-10-28</a> <span class="mute">ok 10 · retry 4 · fail 1</span></li>',
    );
    expect(html).toContain(
      '<li><a href="/digest/2026-10-27">2026-10-27</a> <span class="mute">ok 7 · retry 0 · fail 0</span></li>',
    );
    // Newest first.
    expect(html.indexOf('2026-10-28</a>')).toBeLessThan(html.indexOf('2026-10-27</a>'));
  });

  it('keeps the link and shows — when a night cannot be read', async () => {
    const runsDir = mkdtempSync(join(tmpdir(), 'rig-status-'));
    try {
      writeFileSync(join(runsDir, '2026-11-01.jsonl'), '{"at":"2026-11-01T01:00:00Z","job":"a","status":"ok"}\n');
      mkdirSync(join(runsDir, '2026-11-02.jsonl')); // listed on disk, but reading it throws
      const html = await (await createApp({ ...config, runsDir }).request('/')).text();
      expect(html).toContain('<li><a href="/digest/2026-11-02">2026-11-02</a> <span class="mute">—</span></li>');
      expect(html).toContain('<a href="/digest/2026-11-01">2026-11-01</a> <span class="mute">ok 1 · retry 0 · fail 0</span>');
    } finally {
      rmSync(runsDir, { recursive: true, force: true });
    }
  });

  it('says nothing in runs/ when there are no nights', async () => {
    const runsDir = mkdtempSync(join(tmpdir(), 'rig-status-'));
    try {
      const html = await (await createApp({ ...config, runsDir }).request('/')).text();
      expect(html).toContain('nothing in runs/');
      expect(html).not.toContain('/digest/');
    } finally {
      rmSync(runsDir, { recursive: true, force: true });
    }
  });

  it('health answers with the lane id', async () => {
    const res = await createApp(config).request('/health');
    expect(await res.json()).toEqual({ ok: true, lane: 'lane-07' });
  });
});
