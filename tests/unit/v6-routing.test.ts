import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { registerV5Routes } from '../../server/v5/routes';
import { Workspaces } from '../../server/v6/workspaces';

process.env.INFERENCE_URL = 'http://127.0.0.1:9';

const PIN = '482916';
const JAKTIM = { lat: -6.2006, lon: 106.8574 };
const JAKSEL = { lat: -6.2615, lon: 106.8106 };
/** Karawang town, on the regency's roads. */
const KARAWANG = { lat: -6.3056, lon: 107.3006 };

let server: Server;
let base: string;
const tokens: Record<string, string> = {};
let device = '';

const call = async (url: string, opts: { token?: string; body?: unknown } = {}) => {
  const res = await fetch(`${base}${url}`, {
    method: opts.body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(opts.token ? { 'x-v5-session': opts.token, 'x-v6-pin': PIN } : {}) },
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) })
  });
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, body: (type.includes('json') ? await res.json() : await res.text()) as any };
};

const JPEG = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64')}`;

async function report(at: { lat: number; lon: number }) {
  const image = JPEG;
  const { nonce } = (await call('/api/v5/capture/nonce', { token: device, body: { purpose: 'X' } })).body.data;
  const shot = await call('/api/v5/evidence', { token: device, body: { nonce, image, kind: 'OVERVIEW', gps: { ...at, accuracyM: 8, speedMps: 0 }, motionSamples: 1 } });
  assert.equal(shot.status, 200, JSON.stringify(shot.body));
  const made = await call('/api/v5/cases', { token: device, body: { ...at, accuracyM: 8, evidenceIds: [shot.body.data.id] } });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  return made.body.data;
}

const inbox = async (who: string) => (await call('/api/v5/cases', { token: tokens[who] })).body.data as any[];

before(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v6-routing-'));
  const spaces = new Workspaces(path.join(dataDir, 'v6'));
  const now = new Date().toISOString();
  const add = (id: string, name: string, kind: 'PROVINSI' | 'KABUPATEN', authority: string, adminArea: string, roadStatus: string) => {
    spaces.upsertAgency({ id, name, kind, authorityIds: [authority], region: '', logoUri: null, contact: '', slaDays: 7, sessionHours: 12 }, [{ adminArea, roadStatus, decreeRefs: [], priority: 10 }]);
    const member = spaces.addMember({ agencyId: id, name: `OM ${id}`, title: 'Uji', role: 'OM', id: `${id}-om` }, now);
    spaces.setPin(member.member.id, PIN);
    return member.code;
  };
  const codes = {
    jaktim: add('sudin-jaktim', 'Suku Dinas Bina Marga Jakarta Timur', 'PROVINSI', 'pemprov-dki', 'Jakarta Timur', 'PROVINSI'),
    karawang: add('dpupr-karawang', 'Dinas PUPR Kabupaten Karawang', 'KABUPATEN', 'pemkab-karawang', 'Karawang', 'KABUPATEN')
  };
  const app = express();
  app.use(express.json({ limit: '7mb' }));
  const router = express.Router();
  registerV5Routes(router, { dataDir, lenientCapture: true });
  app.use(router);
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const [who, code] of Object.entries(codes)) tokens[who] = (await call('/api/v6/session', { body: { code, pin: PIN } })).body.data.token;
  device = (await call('/api/v5/session/device', { body: {} })).body.data.token;
});

after(() => { server.close(); });

test('a report in Jakarta Timur lands in that inbox by itself, and only there', async () => {
  const made = await report(JAKTIM);
  assert.equal(made.handledBy.connected, true);
  assert.equal(made.handledBy.name, 'Suku Dinas Bina Marga Jakarta Timur');
  assert.match(made.handledBy.reason, /berstatus jalan provinsi, wilayah .*Jakarta Timur/i);
  assert.ok((await inbox('jaktim')).some((c) => c.publicCode === made.publicCode));
  assert.equal((await inbox('karawang')).some((c) => c.publicCode === made.publicCode), false);
});

test('a report in Karawang lands in the Karawang inbox', async () => {
  const made = await report(KARAWANG);
  assert.equal(made.handledBy.name, 'Dinas PUPR Kabupaten Karawang');
  assert.ok((await inbox('karawang')).some((c) => c.publicCode === made.publicCode));
});

test('an agency not connected: public case, a LAPOR! draft at once, and in no inbox', async () => {
  const made = await report(JAKSEL);
  assert.equal(made.handledBy.connected, false);
  assert.match(made.handledBy.name, /Jakarta Selatan|Satuan Pelaksana/);
  for (const who of ['jaktim', 'karawang']) assert.equal((await inbox(who)).some((c) => c.publicCode === made.publicCode), false);
  const track = (await call(`/api/v5/public/track/${made.publicCode}`)).body.data;
  assert.equal(track.handledBy.connected, false);
  assert.equal(track.complaintDraftAvailable, true);
  const draft = await call(`/api/v5/public/track/${made.publicCode}/complaint-draft`);
  assert.equal(draft.status, 200);
  assert.match(draft.body, /SP4N-LAPOR!/);
  assert.match(draft.body, /bukan tuduhan/);
  assert.ok((await call('/api/v5/public/cases')).body.data.some((c: any) => c.publicCode === made.publicCode), 'it stays on the public map');
});

test('a connected agency has no complaint draft before 30 days', async () => {
  const made = await report(JAKTIM);
  assert.equal((await call(`/api/v5/public/track/${made.publicCode}`)).body.data.complaintDraftAvailable, false);
  assert.equal((await call(`/api/v5/public/track/${made.publicCode}/complaint-draft`)).status, 409);
});

test('low confidence: the OM confirms ownership, and a decree is required', async () => {
  const made = await report({ lat: -6.2006, lon: 106.8574 });
  const c = (await inbox('jaktim')).find((x) => x.publicCode === made.publicCode);
  assert.equal((await call(`/api/v5/cases/${c.id}/confirm-ownership`, { token: tokens.jaktim, body: {} })).status, 400);
  const ok = await call(`/api/v5/cases/${c.id}/confirm-ownership`, { token: tokens.jaktim, body: { decreeRef: { number: 'SK 1/2026', date: '2026-01-02' } } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.case.ownershipConfirmed.decreeRef, 'SK 1/2026 (2026-01-02)');
  assert.equal((await call(`/api/v5/cases/${c.id}/confirm-ownership`, { token: tokens.karawang, body: { decreeRef: { number: 'SK', date: '2026-01-02' } } })).status, 404, 'not another agency');
});

test('a transfer needs a decree, the target agency confirms, history moves with it, and the citizen card follows', async () => {
  const made = await report(JAKTIM);
  let c = (await inbox('jaktim')).find((x) => x.publicCode === made.publicCode);
  const move = (extra: Record<string, unknown>) => call(`/api/v5/cases/${c.id}/transitions`, { token: tokens.jaktim, body: { action: 'TRANSFER_AUTHORITY', expectedVersion: c.version, reason: 'Ruas ini milik kabupaten menurut SK.', target: { agencyId: 'dpupr-karawang' }, ...extra } });
  assert.equal((await move({})).body.error.rule, 'SOD-7');
  assert.equal((await move({ decreeRef: { number: 'SK Bupati 12/2024', date: '2024-03-01' } })).status, 200);
  c = (await inbox('jaktim')).find((x) => x.publicCode === made.publicCode);
  const incoming = (await inbox('karawang')).find((x) => x.publicCode === made.publicCode);
  assert.ok(incoming?.transferPending, 'the target sees what is waiting on it');
  const confirmed = await call(`/api/v5/cases/${c.id}/transitions`, { token: tokens.karawang, body: { action: 'CONFIRM_TRANSFER', expectedVersion: c.version, reason: 'Benar, ruas ini milik kami.' } });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  assert.equal((await inbox('jaktim')).some((x) => x.publicCode === made.publicCode), false, 'it left the old inbox');
  const moved = (await inbox('karawang')).find((x) => x.publicCode === made.publicCode);
  assert.equal(moved.agencyId, 'dpupr-karawang');
  assert.ok(moved.evidence.length > 0, 'the photos came along');
  const track = (await call(`/api/v5/public/track/${made.publicCode}`)).body.data;
  assert.equal(track.handledBy.name, 'Dinas PUPR Kabupaten Karawang');
  assert.match(track.handledBy.reason, /SK Bupati 12\/2024/);
  assert.equal((await call('/api/v5/public/chain/prod/verify')).body.data.ok, true);
});

test('a price import is validated, OM only, asks for the PIN, and is one event in the audit chain', async () => {
  const header = 'region_code,region_name,item_group,item_name_as_written,unit_as_written,price_idr,valid_year,source_doc';
  const csv = `${header}
3215,Kabupaten Karawang,asphalt,Cold Mix Kemasan,Kg,5000,2026,HSPK Uji`;
  const bad = await call('/api/v6/prices/import', { token: tokens.karawang, body: { csv: `${header}
3215,K,asphalt,Barang,Ember,0,2026,X`, fileName: 'x.csv' } });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.problems.length >= 2);
  const before = (await call('/api/v5/public/chain/prod/verify')).body.data;
  const ok = await call('/api/v6/prices/import', { token: tokens.karawang, body: { csv, fileName: 'hspk.csv' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.data.rows, 1);
  const after = (await call('/api/v5/public/chain/prod/verify')).body.data;
  assert.equal(after.ok, true);
  assert.equal(after.checked, before.checked + 1);
  const prices = (await call('/api/v6/prices', { token: tokens.karawang })).body.data;
  assert.ok(prices.rows.some((r: any) => r.nameAsWritten === 'Cold Mix Kemasan' && r.importedBy));
  assert.equal(prices.imports[0].file, 'hspk.csv');
});

test('an AI decision is logged and never moves the case', async () => {
  const made = await report(KARAWANG);
  const c = (await inbox('karawang')).find((x) => x.publicCode === made.publicCode);
  const findings = (await call(`/api/v6/cases/${c.id}/ai`, { token: tokens.karawang })).body.data;
  assert.equal(findings.length, 12);
  assert.equal(findings.find((f: any) => f.key === 'early-failure').status, 'NOT_MEASURED');
  assert.equal((await call(`/api/v6/cases/${c.id}/ai/decisions`, { token: tokens.karawang, body: { key: 'duplicates', decision: 'REJECT', reason: '' } })).status, 400);
  assert.equal((await call(`/api/v6/cases/${c.id}/ai/decisions`, { token: tokens.karawang, body: { key: 'duplicates', decision: 'REJECT', reason: 'Sudah dicek.' } })).status, 200);
  const again = (await inbox('karawang')).find((x) => x.publicCode === made.publicCode);
  assert.equal(again.state, c.state);
  assert.equal(again.version, c.version);
  assert.equal((await call(`/api/v6/cases/${c.id}/ai`, { token: tokens.jaktim })).status, 404, 'not another agency');
});
