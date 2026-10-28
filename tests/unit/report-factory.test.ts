/**
 * M1a: the shared report factory (src/features/community-reports/reportFactory.ts).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSessionReport, generateReportId, ReportCreationError, ReportDraft } from '../../src/features/community-reports/reportFactory';
import { isRegularUserReport, isSessionReport, REPORTS_PERSISTED, selectRegularUserDensity } from '../../src/features/community-reports/reportDensity';
import { INITIAL_COMMUNITY_REPORTS } from '../../src/data/mock/communityReports';
import type { DamageReport } from '../../src/types';

const REPORTER = { id: 'USR-004', role: 'PUBLIC_REPORTER' as const };
const ENGINEER = { id: 'USR-006', role: 'FIELD_ENGINEER' as const };
const NOW = new Date('2026-10-14T03:04:05.000Z');

function draft(overrides: Partial<ReportDraft> = {}): ReportDraft {
  const { id, status, creatorAccountId, creatorRole, origin, createdAt, ...content } = INITIAL_COMMUNITY_REPORTS[0];
  void id; void status; void creatorAccountId; void creatorRole; void origin; void createdAt;
  return { ...content, timestamp: '14/10/2026 10.04', ...overrides };
}

test('factory sets id, creator metadata, origin, ISO createdAt and PENDING status', () => {
  const report = createSessionReport(draft(), REPORTER, NOW);
  assert.match(report.id, /^REP-[0-9A-F]{16}$/);
  assert.equal(report.creatorAccountId, 'USR-004');
  assert.equal(report.creatorRole, 'PUBLIC_REPORTER');
  assert.equal(report.origin, 'SESSION');
  assert.equal(report.createdAt, '2026-10-14T03:04:05.000Z');
  assert.equal(report.status, 'PENDING');
});

test('factory keeps the caller content, including the display timestamp', () => {
  const input = draft({ description: 'Lubang di lajur kiri', timestamp: '14 Okt 2026 10.04' });
  const report = createSessionReport(input, REPORTER, NOW);
  assert.equal(report.description, 'Lubang di lajur kiri');
  assert.equal(report.timestamp, '14 Okt 2026 10.04');
  assert.deepEqual(report.coordinates, input.coordinates);
  assert.deepEqual(report.wimCorrelation, input.wimCorrelation);
});

test('factory-owned fields cannot be overridden by smuggled caller values', () => {
  const smuggled = { ...draft(), id: 'X', status: 'REPAIRED', creatorAccountId: 'USR-999', creatorRole: 'POLICY_MAKER', origin: undefined } as unknown as ReportDraft;
  const report = createSessionReport(smuggled, REPORTER, NOW);
  assert.notEqual(report.id, 'X');
  assert.equal(report.status, 'PENDING');
  assert.equal(report.creatorAccountId, 'USR-004');
  assert.equal(report.creatorRole, 'PUBLIC_REPORTER');
  assert.equal(report.origin, 'SESSION');
});

test('generated ids are unique across many creations', () => {
  const ids = new Set(Array.from({ length: 5000 }, () => generateReportId()));
  assert.equal(ids.size, 5000);
});

test('invalid creator fails closed', () => {
  for (const creator of [null, undefined, { id: '', role: 'PUBLIC_REPORTER' }, { id: '  ', role: 'PUBLIC_REPORTER' }, { id: 'USR-004', role: 'ADMIN' }]) {
    assert.throws(() => createSessionReport(draft(), creator as never, NOW), ReportCreationError);
  }
});

test('invalid content is rejected instead of producing an incomplete report', () => {
  const bad: Partial<ReportDraft>[] = [
    { coordinates: [Number.NaN, 107] },
    { coordinates: [91, 107] },
    { coordinates: [-6.2, 181] },
    { coordinates: [1] as unknown as [number, number] },
    { segmentId: '' },
    { segmentName: '' },
    { estimatedDepthCm: Number.NaN },
    { estimatedAreaM2: Number.POSITIVE_INFINITY },
    { description: undefined as unknown as string }
  ];
  for (const overrides of bad) {
    assert.throws(() => createSessionReport(draft(overrides), REPORTER, NOW), ReportCreationError, JSON.stringify(overrides));
  }
  assert.throws(() => createSessionReport(draft(), REPORTER, new Date('invalid')), ReportCreationError);
});

test('seed reports stay unowned demo records', () => {
  for (const seed of INITIAL_COMMUNITY_REPORTS) {
    assert.equal(seed.origin, undefined);
    assert.equal(seed.creatorAccountId, undefined);
    assert.equal(isSessionReport(seed), false);
  }
});

test('density classification of factory reports follows the existing rules; source stays DEMO', () => {
  const publicReport = createSessionReport(draft(), REPORTER, NOW);
  const officialReport = createSessionReport(draft(), ENGINEER, NOW);
  assert.equal(isRegularUserReport(publicReport), true);
  assert.equal(isRegularUserReport(officialReport), false);

  const reports: DamageReport[] = [...INITIAL_COMMUNITY_REPORTS, publicReport, officialReport];
  const selection = selectRegularUserDensity(reports, 'ALL');
  assert.ok(selection.reports.some((r) => r.id === publicReport.id));
  assert.ok(!selection.reports.some((r) => r.id === officialReport.id));
  assert.equal(selection.provenance, 'DEMO');
  assert.equal(REPORTS_PERSISTED, false);
});

test('every report creation path goes through the factory', () => {
  const paths = [
    'src/components/maps/LeafletMap.tsx',
    'src/features/community-reports/ReportRoadIssueCard.tsx'
  ];
  for (const file of paths) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /createSessionReport\(/, `${file} must build reports with createSessionReport`);
    assert.doesNotMatch(source, /origin:\s*'SESSION'/, `${file} must not hand-build session reports`);
  }
});
