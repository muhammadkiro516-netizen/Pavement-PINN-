/**
 * M1a: demo-side report ownership (`canEditReport` in src/features/rbac/accessPolicy.ts).
 * Frontend behaviour only; it is not a security boundary.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canEditReport, can } from '../../src/features/rbac/accessPolicy';
import { createSessionReport, ReportDraft } from '../../src/features/community-reports/reportFactory';
import { createReportState, replaceReport, viewReportsAs } from '../../src/features/community-reports/reportState';
import { USER_ACCOUNTS } from '../../src/features/authentication/demoAccounts';
import { INITIAL_COMMUNITY_REPORTS } from '../../src/data/mock/communityReports';
import type { DamageReport, ReportStatus } from '../../src/types';

const account = (id: string) => USER_ACCOUNTS.find((a) => a.id === id)!;
const BUDI = account('USR-004');
const SITI = account('USR-005');

function draft(): ReportDraft {
  const { id, status, creatorAccountId, creatorRole, origin, createdAt, ...content } = INITIAL_COMMUNITY_REPORTS[0];
  void id; void status; void creatorAccountId; void creatorRole; void origin; void createdAt;
  return content;
}

const budiReport = createSessionReport(draft(), BUDI);

test('the owner may edit their own PENDING session report', () => {
  assert.equal(canEditReport(BUDI, budiReport), true);
});

test('another account with the same role may not edit it', () => {
  const otherReporter = { ...BUDI, id: 'USR-104' };
  assert.equal(canEditReport(otherReporter, budiReport), false);
});

test('same display name but a different account id is denied (USR-001 vs USR-006)', () => {
  const fe1 = account('USR-001');
  const fe6 = account('USR-006');
  assert.equal(fe1.name, fe6.name);
  const sameNameReport = { ...createSessionReport(draft(), { id: fe6.id, role: 'PUBLIC_REPORTER' }) };
  assert.equal(canEditReport({ id: fe1.id, role: 'PUBLIC_REPORTER' }, sameNameReport), false);
  const nameTwin = { ...BUDI, id: 'USR-404' };
  assert.equal(canEditReport(nameTwin, budiReport), false);
});

test('PUBLIC_VIEWER is denied, including on a report they created', () => {
  const sitiReport = createSessionReport(draft(), SITI);
  assert.equal(canEditReport(SITI, sitiReport), false);
  assert.equal(canEditReport(SITI, budiReport), false);
});

test('bundled demo reports (no owner) are not editable by anyone, including the named reporter', () => {
  // Seed reporters are generic now ("Warga contoh NN"); a seed carrying the citizen account's
  // display name must still not become editable by that account.
  const budiSeed = { ...INITIAL_COMMUNITY_REPORTS[0], reporterName: BUDI.name };
  assert.equal(INITIAL_COMMUNITY_REPORTS.some((r) => r.reporterName === BUDI.name), false, 'seed reporters carry no real-looking names');
  for (const acc of USER_ACCOUNTS) {
    for (const seed of [...INITIAL_COMMUNITY_REPORTS, budiSeed]) {
      assert.equal(canEditReport(acc, seed), false, `${acc.id} on ${seed.id}`);
    }
  }
});

test('missing or malformed identity fails closed', () => {
  for (const acc of [null, undefined, {}, { id: '', role: 'PUBLIC_REPORTER' }, { id: 42, role: 'PUBLIC_REPORTER' }, { id: 'USR-004' }]) {
    assert.equal(canEditReport(acc as never, budiReport), false, JSON.stringify(acc));
  }
  assert.equal(canEditReport(BUDI, null), false);
  assert.equal(canEditReport(BUDI, undefined), false);
});

test('malformed ownership metadata or wrong origin is denied', () => {
  const variants: Partial<DamageReport>[] = [
    { origin: undefined },
    { creatorAccountId: undefined },
    { creatorAccountId: '' },
    { creatorRole: undefined },
    { creatorRole: 'FIELD_ENGINEER' }
  ];
  for (const v of variants) {
    assert.equal(canEditReport(BUDI, { ...budiReport, ...v }), false, JSON.stringify(v));
  }
});

test('only PENDING is editable', () => {
  const statuses: ReportStatus[] = ['VERIFIED_BY_ENGINEER', 'SCHEDULED_FOR_REPAIR', 'REPAIRED'];
  for (const status of statuses) {
    assert.equal(canEditReport(BUDI, { ...budiReport, status }), false, status);
  }
});

test('official roles get no content-edit permission, even on reports they created', () => {
  for (const id of ['USR-001', 'USR-006', 'USR-002', 'USR-008', 'USR-003', 'USR-007']) {
    const official = account(id);
    const ownReport = createSessionReport(draft(), official);
    assert.equal(canEditReport(official, ownReport), false, `${id} own report`);
    assert.equal(canEditReport(official, budiReport), false, `${id} on Budi's report`);
  }
});

test('ACTION_RULES and canEditReport agree on which roles may edit their own reports', () => {
  for (const acc of USER_ACCOUNTS) {
    const ownReport = createSessionReport(draft(), acc);
    assert.equal(canEditReport(acc, ownReport), can(acc.role, 'EDIT_OWN_DAMAGE_REPORT'), acc.id);
  }
});

test('content-edit policy does not block Field Engineer verification through the shared store', () => {
  const fe = account('USR-006');
  assert.equal(canEditReport(fe, budiReport), false);
  const state = replaceReport(
    createReportState([...INITIAL_COMMUNITY_REPORTS, budiReport], BUDI.id),
    { ...budiReport, status: 'VERIFIED_BY_ENGINEER' }
  );
  assert.equal(viewReportsAs(state, fe.id).find((r) => r.id === budiReport.id)!.status, 'VERIFIED_BY_ENGINEER');

  // Since P3 the engineer verifies through the workflow (assigned inspection), rendered in the
  // sheet's workflow panel; the sheet no longer writes a verification status directly.
  const sheet = readFileSync('src/features/community-reports/ReportDetailBottomSheet.tsx', 'utf8');
  assert.match(sheet, /\{workflowPanel\}/);
  assert.doesNotMatch(sheet, /status: 'VERIFIED_BY_ENGINEER'/);
});

test('every edit gate and save handler uses canEditReport; no name or role-only gates remain', () => {
  const files = [
    'src/features/community-reports/ReportDetailBottomSheet.tsx',
    'src/features/community-reports/ReportDetailModal.tsx',
  ];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /canEditReport\(/, `${file} must use canEditReport`);
    assert.doesNotMatch(source, /reporterName === currentAccount\.name/, `${file}: ownership decided by display name`);
    assert.doesNotMatch(source, /role === 'PUBLIC_REPORTER' && onOpenEditModal/, `${file}: role-only edit gate`);
  }
});
