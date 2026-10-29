/** SPEC M4: captions stay neutral in every tone; the share link page and its counters. */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { bannedWords, caption, type StoryTemplate, type Tone } from '../../src/domain/share/captions';
import { createApp } from '../../server/app';
import { createWorkflowRuntime } from '../../server/services/workflowRuntime';
import { MemoryCaseStore } from '../../src/domain/workflow/service';
import { trackingCodeFor } from '../../src/domain/workspace/fromCase';
import type { ReportCase } from '../../src/domain/workflow/model';

test('every template x tone caption passes the neutral-language checker and carries the link', () => {
  const facts = { damage: 'Lubang', place: 'Jl. Raya Klari', agency: 'Dinas PUPR Kabupaten Karawang', days: 18, url: 'https://x.test/r/ABC-1234', city: 'Karawang', points: 25, areaM2: 2.5 };
  for (const t of ['BARU', 'BELUM_DITANGANI', 'DIPERBAIKI', 'SIAGA_HUJAN', 'DAMPAK'] as StoryTemplate[]) {
    for (const tone of ['INFORMATIF', 'MENDESAK', 'APRESIASI'] as Tone[]) {
      const text = caption(t, tone, facts);
      assert.deepEqual(bannedWords(text), [], `${t}/${tone}`);
      assert.match(text, /https:\/\/x\.test\/r\/ABC-1234/);
      assert.match(text, /#JalanAman/);
    }
  }
  assert.match(caption('BELUM_DITANGANI', 'INFORMATIF', facts), /Hari ke-18/);
  assert.deepEqual(bannedWords('ini korupsi dan mark-up'), ['korup', 'mark-?up']);
  assert.throws(() => caption('BARU', 'INFORMATIF', { ...facts, place: 'jalan pejabat korup' }));
});

let server: Server;
let base = '';
const CASE = {
  id: 'REP-SHARE-1', version: 1, segmentId: 'S1', state: 'NEEDS_REVIEW', dataStatus: 'USER_GENERATED', createdAt: new Date(Date.now() - 20 * 86400000).toISOString(), updatedAt: new Date().toISOString(),
  createdBy: { id: 'OWNER', role: 'PUBLIC_REPORTER', kind: 'ACCOUNT' }, history: [], approvals: [], authority: { name: 'Dinas PUPR Kabupaten Karawang', level: 'KABUPATEN', agencyId: 'dpupr-karawang', confidence: 'LOW', basis: 'x' },
  report: { id: 'REP-SHARE-1', damageTypeLabel: 'Lubang', segmentName: 'Jl. Raya Klari', coordinates: [-6.3, 107.3], photoUrl: null, upvotesCount: 0, reporterName: 'Nama Pelapor' }
} as unknown as ReportCase;

before(async () => {
  const store = new MemoryCaseStore();
  const snap = await store.load();
  await store.commit({ ...snap, revision: snap.revision + 1, cases: [CASE] });
  const workflow = createWorkflowRuntime({ store, sessionSecret: 's'.repeat(40) });
  await workflow.ready;
  await new Promise<void>((resolve) => {
    server = createApp({ workflow }).listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((resolve) => server.close(() => resolve())));

test('/r/:code serves Open Graph without personal data, counts unique visitors, and redirects to tracking', async () => {
  const code = trackingCodeFor(CASE.id);
  const r = await fetch(`${base}/r/${code}`, { redirect: 'manual', headers: { 'user-agent': 'A' } });
  const html = await r.text();
  assert.match(html, /og:title" content="Lubang · Jl. Raya Klari"/);
  assert.match(html, /Menunggu 20 hari/);
  assert.match(html, new RegExp(`/lacak/${code}/`));
  assert.doesNotMatch(html, /Nama Pelapor|OWNER/);
  await fetch(`${base}/r/${code}`, { headers: { 'user-agent': 'A' } });
  await fetch(`${base}/r/${code}`, { headers: { 'user-agent': 'B' } });
  const facts = await (await fetch(`${base}/api/public/share/${code}`)).json();
  assert.equal(facts.visits, 2, 'same visitor on the same day counts once');
  assert.equal(facts.agency, 'Dinas PUPR Kabupaten Karawang');
  assert.equal(facts.waitingDays, 20);
  assert.doesNotMatch(JSON.stringify(facts), /Nama Pelapor|OWNER/);
  assert.equal((await fetch(`${base}/r/${code}/og.png`)).status, 404, 'no card uploaded yet');
  assert.equal((await fetch(`${base}/api/share/${CASE.id}/og`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ png: 'data:image/png;base64,AAAA' }) })).status, 404, 'anonymous cannot upload');
});
