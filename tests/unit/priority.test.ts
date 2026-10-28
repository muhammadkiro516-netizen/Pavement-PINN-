/** Loop 3: explainable queue priority from recorded facts only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { byPriority, priorityOf, SUPPORT_CAP } from '../../src/domain/workflow/priority';
import type { ReportCase } from '../../src/domain/workflow/model';

const NOW = Date.parse('2026-10-28T00:00:00Z');
const mk = (over: Partial<ReportCase> & { report?: Partial<ReportCase['report']> }): ReportCase =>
  ({
    id: over.id ?? 'R',
    createdAt: over.createdAt ?? '2026-10-27T00:00:00Z',
    updatedAt: '2026-10-27T00:00:00Z',
    screening: over.screening ?? null,
    inspection: over.inspection ?? null,
    report: { severity: 'MODERATE', upvotesCount: 0, ...(over.report ?? {}) }
  }) as unknown as ReportCase;

test('an engineer-confirmed critical hole outranks an AI guess, which outranks a citizen estimate', () => {
  const inspected = mk({ id: 'A', inspection: { verdict: 'CONFIRMED', severity: 'CRITICAL' } as ReportCase['inspection'] });
  const ai = mk({ id: 'B', screening: { modelStatus: 'REAL', detectedClass: 'POTHOLE', confidence: 0.9 } as ReportCase['screening'] });
  const citizen = mk({ id: 'C', report: { severity: 'CRITICAL' } as never });
  const order = [citizen, ai, inspected].sort((a, b) => byPriority(a, b, NOW)).map((c) => c.id);
  assert.deepEqual(order, ['A', 'B', 'C']);
  assert.match(priorityOf(ai, NOW).reasons[0], /AI: .*90%/);
});

test('citizen support is capped so busy areas cannot drown out severe damage elsewhere', () => {
  const popular = mk({ report: { upvotesCount: 500 } as never });
  assert.equal(priorityOf(popular, NOW).score - priorityOf(mk({}), NOW).score, SUPPORT_CAP);
});

test('waiting time raises old reports and is explained', () => {
  const old = mk({ createdAt: '2026-10-08T00:00:00Z' });
  assert.ok(priorityOf(old, NOW).score > priorityOf(mk({}), NOW).score);
  assert.ok(priorityOf(old, NOW).reasons.some((r) => /menunggu 20 hari/.test(r)));
});
