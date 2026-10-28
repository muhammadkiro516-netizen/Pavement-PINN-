/** Responsible-agency routing (pure rules) and the disposisi / warning-sign workflow actions. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, offlineFacts } from '../../server/services/authorityResolver';
import { applyCommand } from '../../src/domain/workflow/stateMachine';
import type { ReportCase } from '../../src/domain/workflow/model';

const facts = (over: Partial<Parameters<typeof classify>[0]>) => ({ province: null, city: null, road: null, highway: null, ref: null, operator: null, ...over });

test('toll roads go to the toll operator with high confidence', () => {
  const r = classify(facts({ province: 'Daerah Khusus Ibukota Jakarta', highway: 'motorway', operator: 'PT Jasa Marga' }))!;
  assert.equal(r.agencyId, 'bujt');
  assert.equal(r.confidence, 'HIGH');
});

test('trunk roads (likely national) go to BBPJN; Jakarta local roads to the Suku Dinas of the city', () => {
  assert.equal(classify(facts({ province: 'Jawa Barat', city: 'Kabupaten Karawang', highway: 'trunk' }))!.agencyId, 'bbpjn-jabar-dki');
  assert.equal(classify(facts({ province: 'Daerah Khusus Ibukota Jakarta', city: 'Jakarta Timur', highway: 'residential' }))!.agencyId, 'sudin-bm-jaktim');
  assert.equal(classify(facts({ province: 'Daerah Khusus Ibukota Jakarta', city: 'Jakarta Timur', highway: 'primary' }))!.agencyId, 'dbm-dki');
});

test('Karawang local roads go to Dinas PUPR Karawang; outside the pilot nothing is guessed', () => {
  const r = classify(facts({ province: 'Jawa Barat', city: 'Kabupaten Karawang', highway: 'tertiary' }))!;
  assert.equal(r.agencyId, 'dpupr-karawang');
  assert.equal(r.confidence, 'LOW');
  assert.equal(classify(facts({ province: 'Lampung', highway: 'residential' })), null);
});

test('offline fallback uses the pilot boxes only', () => {
  assert.equal(classify(offlineFacts(-6.225, 106.9))!.agencyId, 'dbm-dki');
  assert.equal(classify(offlineFacts(-6.3, 107.3))!.agencyId, 'dpupr-karawang');
  assert.equal(classify(offlineFacts(-5.43, 105.26)), null);
});

const base = (state: ReportCase['state']): ReportCase =>
  ({
    id: 'R1', version: 3, state, segmentId: 'S', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
    report: { photoUrl: 'data:image/png;base64,AAAA' }, createdBy: { id: 'c', role: 'PUBLIC_REPORTER', kind: 'ACCOUNT' },
    claimTokenHash: null, dataStatus: 'USER_GENERATED', screening: null, assignment: null, inspection: null, recommendation: null,
    approvals: [], workOrder: null, history: [], authority: { agencyId: 'dbm-dki', level: 'PROVINSI', name: 'Dinas Bina Marga Provinsi DKI Jakarta', confidence: 'LOW', basis: 'x' }
  }) as unknown as ReportCase;
const ctx = (role: string) => ({ actor: { id: 'U', role: role as never, kind: 'ACCOUNT' as const }, now: '2026-10-29T00:00:00Z', newId: (p: string) => `${p}-1`, expectedVersion: 3, roleOf: () => null });

test('only the Koordinator transfers a report, with a reason, and the history is kept', () => {
  const cmd = { action: 'TRANSFER_AUTHORITY' as const, reason: 'Ruas ini jalan nasional', agencyId: 'bbpjn-jabar-dki', agencyName: 'BBPJN Jawa Barat - DKI Jakarta', level: 'NASIONAL' as const };
  assert.equal((applyCommand(base('VERIFIED'), cmd, ctx('FIELD_ENGINEER')) as { ok: boolean }).ok, false);
  assert.equal((applyCommand(base('VERIFIED'), { ...cmd, reason: '' }, ctx('OPERATIONS_MANAGER')) as { ok: boolean }).ok, false);
  const r = applyCommand(base('VERIFIED'), cmd, ctx('OPERATIONS_MANAGER')) as { ok: true; next: ReportCase };
  assert.equal(r.ok, true);
  assert.equal(r.next.state, 'VERIFIED');
  assert.equal(r.next.authority!.agencyId, 'bbpjn-jabar-dki');
  assert.equal(r.next.authorityHistory!.length, 1);
});

test('a warning sign needs a photo and does not change the workflow state', () => {
  const sign = { action: 'MARK_HAZARD' as const, reason: 'Lubang dalam di lajur kiri', photoUrl: 'data:image/png;base64,iVBORw0KGgo=', note: 'Kerucut + papan' };
  const assigned = { ...base('FIELD_INSPECTION_REQUESTED'), assignment: { engineerId: 'U' } } as unknown as ReportCase;
  // Only the engineer assigned to the site (or a Koordinator) records the sign, with a reason.
  assert.equal((applyCommand(base('FIELD_INSPECTION_REQUESTED'), sign, ctx('FIELD_ENGINEER')) as { ok: boolean }).ok, false);
  assert.equal((applyCommand(assigned, { ...sign, reason: '' }, ctx('FIELD_ENGINEER')) as { ok: boolean }).ok, false);
  const ok = applyCommand(assigned, sign, ctx('FIELD_ENGINEER')) as { ok: true; next: ReportCase };
  assert.equal(ok.ok, true);
  assert.equal(ok.next.state, 'FIELD_INSPECTION_REQUESTED');
  assert.ok(ok.next.hazard);
  const bad = applyCommand(base('VERIFIED'), { action: 'MARK_HAZARD', reason: 'x', photoUrl: 'nope', note: '' }, ctx('OPERATIONS_MANAGER')) as { ok: boolean };
  assert.equal(bad.ok, false);
});
