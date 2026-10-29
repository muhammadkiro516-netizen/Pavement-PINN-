/** Citizen recognition is computed from real outcomes: verified and repaired reports only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { citizenImpact } from '../../src/domain/workflow/impact';
import type { ReportCase } from '../../src/domain/workflow/model';

const mk = (id: string, state: string, actions: string[], extra: Record<string, unknown> = {}) =>
  ({ id, state, createdBy: { id: 'ME' }, history: actions.map((action) => ({ action })), inspection: null, report: {}, ...extra }) as unknown as ReportCase;

test('points come from verified (+10) and repaired (+5) reports; invalid ones earn nothing', () => {
  const cases = [
    mk('a', 'NEEDS_REVIEW', []),
    mk('b', 'VERIFIED', []),
    mk('c', 'CLOSED', ['RESOLVE', 'CLOSE_RESOLVED'], { inspection: { measuredAreaM2: 2.5 } }),
    mk('d', 'CLOSED', ['CLOSE_INVALID']),
    { ...mk('e', 'VERIFIED', []), createdBy: { id: 'OTHER' } } as ReportCase
  ];
  const i = citizenImpact(cases, 'ME');
  assert.equal(i.reports, 4);
  assert.equal(i.verified, 2);
  assert.equal(i.repaired, 1);
  assert.equal(i.points, 25);
  assert.equal(i.level.name, 'Pelapor');
  assert.equal(i.repairedAreaM2, 2.5);
  assert.ok(i.badges.find((b) => b.id === 'witness')!.earned);
});

test('quests: XP only from completed, server-verified events; capped per day; never negative', async () => {
  const { quests } = await import('../../src/domain/workflow/impact');
  const defs = JSON.parse((await import('node:fs')).readFileSync('config/quests.json', 'utf8'));
  const none = quests(defs.quests, { verifiedAt: [], repairedAt: [], confirmation36At: [], visits: 0, rainyWaterAt: [], projectVerifiedAt: [] }, 100);
  assert.equal(none.xp, 0);
  assert.ok(none.items.every((q) => !q.done && q.progress === 0));
  const sameDay = '2026-10-29T08:00:00Z';
  const busy = quests(defs.quests, { verifiedAt: Array(5).fill(sameDay), repairedAt: [sameDay], confirmation36At: [sameDay], visits: 25, rainyWaterAt: [], projectVerifiedAt: [sameDay] }, 100, new Date(sameDay));
  // 20 + 50 + 15 + 25 + 30 + 40 = 180 XP earned on one day, capped at 100
  assert.equal(busy.xp, 100);
  const spread = quests(defs.quests, { verifiedAt: ['2026-10-01T00:00:00Z'], repairedAt: ['2026-10-05T00:00:00Z'], confirmation36At: [], visits: 3, rainyWaterAt: [], projectVerifiedAt: [] }, 100);
  assert.equal(spread.xp, 35);
  assert.equal(spread.items.find((q) => q.id === 'suara_bergaung')!.progress, 3);
});
