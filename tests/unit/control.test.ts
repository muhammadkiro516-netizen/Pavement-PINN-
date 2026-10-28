/** Pusat Kendali numbers come from recorded history only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { controlSummary } from '../../src/domain/workflow/control';
import type { ReportCase } from '../../src/domain/workflow/model';

const NOW = Date.parse('2026-10-29T12:00:00Z');
const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const mk = (o: Record<string, unknown>) =>
  ({
    dataStatus: 'OBSERVED',
    state: 'NEEDS_REVIEW',
    createdAt: iso(NOW - 10 * H),
    history: [{ action: 'SUBMIT', at: iso(NOW - 10 * H) }],
    report: { severity: 'LIGHT' },
    inspection: null,
    hazard: null,
    authority: null,
    ...o
  }) as unknown as ReportCase;

test('response score, waiting reports, missing signs and agency load', () => {
  const created = NOW - 100 * H;
  const cases = [
    mk({}), // waiting 10 h: within target
    mk({ createdAt: iso(created), history: [{ action: 'SUBMIT', at: iso(created) }] }), // waiting 100 h: past target
    mk({
      state: 'VERIFIED',
      createdAt: iso(created),
      history: [{ action: 'SUBMIT', at: iso(created) }, { action: 'REVIEW_ACCEPT', at: iso(created + 5 * H) }],
      report: { severity: 'SEVERE' },
      authority: { name: 'Dinas PUPR Kabupaten Karawang', confidence: 'LOW' }
    }),
    mk({
      state: 'CLOSED',
      createdAt: iso(created),
      history: [{ action: 'SUBMIT', at: iso(created) }, { action: 'REVIEW_ACCEPT', at: iso(created + 60 * H) }, { action: 'RESOLVE', at: iso(created + 96 * H) }]
    }),
    mk({ dataStatus: 'SYNTHETIC' })
  ];
  const s = controlSummary(cases, NOW);
  assert.equal(s.open, 3);
  assert.equal(s.awaitingFirstResponse, 2);
  assert.equal(s.pastResponseTarget, 1);
  assert.equal(s.onTimePct, 50); // 5 h on time, 60 h late
  assert.equal(s.medianFirstResponseH, 32.5);
  assert.equal(s.medianResolveDays, 4);
  assert.equal(s.needsSign, 1); // the verified SEVERE report has no sign
  assert.deepEqual(s.byAgency[0], { name: 'Instansi belum ditentukan', open: 2, lowConfidence: 2 });
  assert.deepEqual(s.byAgency[1], { name: 'Dinas PUPR Kabupaten Karawang', open: 1, lowConfidence: 1 });
});
