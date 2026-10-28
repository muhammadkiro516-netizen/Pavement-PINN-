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
