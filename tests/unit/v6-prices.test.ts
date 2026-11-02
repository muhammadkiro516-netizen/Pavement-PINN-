import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PriceBook, buildOptions, loadIkk, loadRegional } from '../../server/v6/priceBook';
import { parseCsv } from '../../server/v5/routing';
import { compareOptions, compareSubmitted, lookupPrice, nonMonotonicKSeries, quantityFor, validateImport, type PriceRow } from '../../src/domain/v6/costV6';

const raw = () => parseCsv(fs.readFileSync('docs/v6/data/prices/price_book_regional_2026.csv', 'utf8'));
const book = () => new PriceBook(fs.mkdtempSync(path.join(os.tmpdir(), 'v6-price-')));
const NO_LIFE = { patch: null, overlay: null, note: '' };

test('every CSV row loads byte-exact: no rounding, no unit fixing', () => {
  const rows = loadRegional();
  const source = raw();
  assert.equal(rows.length, source.length);
  assert.equal(rows.length, 59);
  rows.forEach((r, i) => {
    assert.equal(r.nameAsWritten, source[i].item_name_as_written);
    assert.equal(r.unitAsWritten, source[i].unit_as_written);
    assert.equal(r.priceAsWritten, source[i].price_idr);
    assert.equal(r.priceNormalized, source[i].price_idr_normalized);
    assert.equal(r.status, source[i].status);
    assert.equal(r.sourcePage, source[i].source_page);
  });
  const cement = rows.find((r) => r.regionCode === '3603' && r.nameAsWritten === 'Semen Portland 50 kg')!;
  assert.equal(cement.status, 'TODO_VERIFY');
  assert.equal(cement.priceAsWritten, '73300');
});

const baseLookup = { agencyBook: [] as PriceRow[], regional: loadRegional(), confirmedIds: new Set<string>(), ikk: loadIkk(), documentToLoad: 'dokumen X' };

test('TODO_VERIFY rows stay out of the sums until an OM confirms them', () => {
  const match = (r: PriceRow) => r.nameAsWritten === 'Semen Portland 50 kg';
  const hidden = lookupPrice({ ...baseLookup, regionCode: '3603', match });
  assert.deepEqual(hidden, { missing: 'dokumen X' });
  const row = baseLookup.regional.find(match)!;
  const shown = lookupPrice({ ...baseLookup, regionCode: '3603', match, confirmedIds: new Set([row.id]) });
  assert.ok('found' in shown && shown.found.priceIdr === 73300);
});

test('lookup order: agency book, then same region, then other region × IKK labelled ASSUMED, then nothing', () => {
  const k350 = (r: PriceRow) => /^Beton Ready Mix(ed)?[,\s-]*K[.\s-]*350$/i.test(r.nameAsWritten.trim());
  const own: PriceRow = { ...baseLookup.regional[0], id: 'A-1', regionCode: '3215', nameAsWritten: 'Beton Ready Mix, K.350', priceNormalized: '999', status: 'AGENCY', group: 'concrete_readymix' };
  const first = lookupPrice({ ...baseLookup, regionCode: '3215', match: k350, agencyBook: [own] });
  assert.ok('found' in first && first.found.how === 'AGENCY_BOOK' && first.found.priceIdr === 999);
  const second = lookupPrice({ ...baseLookup, regionCode: '3215', match: k350 });
  assert.ok('found' in second && second.found.how === 'SAME_REGION' && second.found.priceIdr === 1014300 && second.found.status === 'OFFICIAL');
  // A region with a known IKK and no book of its own: Karawang × IKK, labelled ASSUMED.
  const third = lookupPrice({ ...baseLookup, regionCode: '3172', match: k350 });
  assert.ok('found' in third && third.found.how === 'OTHER_REGION_IKK' && third.found.status === 'ASSUMED');
  assert.equal((third as { found: { priceIdr: number } }).found.priceIdr, Math.round(1014300 * (109.74 / 107.68)));
  // No book and no IKK: no number at all.
  assert.deepEqual(lookupPrice({ ...baseLookup, regionCode: '9999', match: k350 }), { missing: 'dokumen X' });
});

test('Karawang\'s two AC-WC lines are not averaged: the OM picks', () => {
  const b = book();
  const measure = { areaM2: 2, depthCm: 5 };
  const unpicked = compareOptions(buildOptions(b, 'A', '3215', NO_LIFE), measure);
  const hot = unpicked.find((o) => o.key === 'HOT_MIX_PATCH')!;
  assert.equal(hot.status, 'NEEDS_OM_CHOICE');
  assert.equal(hot.totalIdr, null);
  assert.deepEqual(hot.choices.map((c) => c.priceIdr).sort((x, y) => x - y), [1273100, 2741700]);
  const row = b.regional.find((r) => r.nameAsWritten === 'Aspal Material Aspal Beton (Ac - Wc)')!;
  b.of('A').acWcChoice = row.id;
  const picked = compareOptions(buildOptions(b, 'A', '3215', NO_LIFE), measure).find((o) => o.key === 'HOT_MIX_PATCH')!;
  assert.equal(picked.status, 'COMPUTED');
  assert.equal(picked.price?.priceIdr, 1273100);
});

test('worked example: a Karawang pothole gives the same numbers on every run', () => {
  // Inputs: 2 m² × 5 cm deep; AC-WC 1,273,100/ton (Perbup Karawang 28/2025 p.6); density 2.25/2.295/2.34; overhead 10%
  // (15% at the high end); VAT 11%. Crew per team-day, ASSUMED: Mandor 165,000 + Tukang 150,000 + 4 × Pekerja 138,000 +
  // Operator 100,000 = 967,000 (p.230). Machines: 64,300 + 94,300 + 75,800 an hour (pp.240-241) × 5.81 h. Output 5.6-6.7 t/day.
  const b = book();
  b.of('A').acWcChoice = b.regional.find((r) => r.nameAsWritten === 'Aspal Material Aspal Beton (Ac - Wc)')!.id;
  const life = { patch: { low: 6, mid: 12, high: 24 }, overlay: { low: 18, mid: 36, high: 60 }, note: 'n' };
  const run = () => compareOptions(buildOptions(b, 'A', '3215', life), { areaM2: 2, depthCm: 5 });
  const [one, two] = [run(), run()];
  assert.deepEqual(one, two);
  const hot = one.find((o) => o.key === 'HOT_MIX_PATCH')!;
  const perTon = (tons: number, output: number) => tons * (1273100 + 967000 / output + (234400 * 7 * 0.83) / output);
  assert.deepEqual(hot.totalIdr, {
    low: Math.round(perTon(0.225, 6.7) * 1.1 * 1.11),
    mid: Math.round(perTon(0.2295, 6.15) * 1.1 * 1.11),
    high: Math.round(perTon(2 * 0.05 * 2.34, 5.6) * 1.15 * 1.11)
  });
  assert.equal(hot.includesLabourEquipment, true);
  assert.equal(hot.labourIdr?.mid, Math.round((0.2295 * 967000) / 6.15));
  assert.match(hot.crewNote!, /asumsi/);
  assert.equal(hot.costPerYearIdr?.mid, hot.totalIdr?.mid, 'twelve months is one year');
  const overlay = one.find((o) => o.key === 'AC_WC_OVERLAY')!;
  assert.equal(overlay.best, true, 'lowest cost per year among those that last');
  assert.equal(hot.best, false);
  const concrete = one.find((o) => o.key === 'CONCRETE_K350')!;
  assert.equal(concrete.price?.priceIdr, 1014300);
  assert.equal(concrete.includesLabourEquipment, false, 'no output benchmark for concrete, so nothing is guessed');
  assert.equal(concrete.costPerYearIdr, null, 'no life model, so no cost per year');
  for (const missing of ['COLD_MIX_PATCH', 'FAST_TRACK_CONCRETE'] as const) {
    const o = one.find((x) => x.key === missing)!;
    if (missing === 'COLD_MIX_PATCH') assert.equal(o.status, 'PRICE_NOT_AVAILABLE');
    assert.ok(o.documentToLoad || o.price?.status === 'ASSUMED');
  }
});

test('Jakarta Timur: no official price, so every figure is a labelled Karawang × IKK estimate, and the OM still picks the line', () => {
  const b = book();
  const life = { patch: { low: 6, mid: 12, high: 24 }, overlay: null, note: 'n' };
  const first = compareOptions(buildOptions(b, 'J', '3172', life), { areaM2: 2, depthCm: 5 });
  assert.equal(first.find((o) => o.key === 'HOT_MIX_PATCH')!.status, 'NEEDS_OM_CHOICE');
  const concrete = first.find((o) => o.key === 'CONCRETE_K350')!;
  assert.equal(concrete.price?.status, 'ASSUMED');
  assert.match(concrete.price!.note!, /IKK 109.74 ÷ 107.68/);
  b.of('J').acWcChoice = b.regional.find((r) => r.nameAsWritten === 'Aspal Material Aspal Beton (Ac - Wc)')!.id;
  const hot = compareOptions(buildOptions(b, 'J', '3172', life), { areaM2: 2, depthCm: 5 }).find((o) => o.key === 'HOT_MIX_PATCH')!;
  assert.equal(hot.price?.status, 'ASSUMED');
  assert.equal(hot.price?.priceIdr, Math.round(1273100 * (109.74 / 107.68)));
  assert.match(hot.crewNote!, /UMP DKI Jakarta/);
  // Jakarta's own uploaded book takes over at once.
  const own: PriceRow = { ...b.regional[0], id: 'J-1', regionCode: '3172', regionName: 'Jakarta Timur', nameAsWritten: 'Beton Ready Mix, K.350', priceNormalized: '1200000', status: 'AGENCY', group: 'concrete_readymix' };
  b.of('J').rows.push(own);
  const after = compareOptions(buildOptions(b, 'J', '3172', life), { areaM2: 2, depthCm: 5 }).find((o) => o.key === 'CONCRETE_K350')!;
  assert.equal(after.price?.how, 'AGENCY_BOOK');
  assert.equal(after.price?.priceIdr, 1200000);
});

test('a cheap patch that does not last never wins on cost per year', () => {
  const b = book();
  b.of('A').acWcChoice = b.regional.find((r) => r.nameAsWritten === 'Aspal Material Aspal Beton (Ac - Wc)')!.id;
  const out = compareOptions(buildOptions(b, 'A', '3215', { patch: { low: 1, mid: 4, high: 6 }, overlay: null, note: 'n' }), { areaM2: 2, depthCm: 5 });
  assert.equal(out.find((o) => o.best), undefined);
});

test('the 20% rule asks for clarification, and only outside the range', () => {
  const range = { low: 100, mid: 110, high: 120 };
  assert.equal(compareSubmitted(115, range).needsClarification, false);
  assert.equal(compareSubmitted(140, range).differencePct, 16.7);
  assert.equal(compareSubmitted(140, range).needsClarification, false);
  assert.equal(compareSubmitted(150, range).needsClarification, true);
  assert.equal(compareSubmitted(70, range).needsClarification, true);
});

test('import validation: required columns, known units, price above zero, source, and outlier warnings', () => {
  const header = ['region_code', 'region_name', 'item_group', 'item_name_as_written', 'unit_as_written', 'price_idr', 'valid_year', 'source_doc'];
  const good = { region_code: '3215', region_name: 'K', item_group: 'asphalt', item_name_as_written: 'Barang Baru', unit_as_written: 'Ton', price_idr: '1000', valid_year: '2026', source_doc: 'Perbup' };
  assert.deepEqual(validateImport([good], header, []), { problems: [], warnings: [] });
  assert.match(validateImport([good], header.slice(1), []).problems[0].problem, /region_code/);
  assert.match(validateImport([{ ...good, price_idr: '0' }], header, []).problems[0].problem, /lebih dari 0/);
  assert.match(validateImport([{ ...good, unit_as_written: 'ember' }], header, []).problems[0].problem, /tidak dikenal/);
  assert.match(validateImport([{ ...good, source_doc: ' ' }], header, []).problems[0].problem, /source_doc/);
  const same: PriceRow = { ...loadRegional()[0], nameAsWritten: 'Barang Baru', priceNormalized: '100' };
  assert.equal(validateImport([{ ...good, price_idr: '301' }], header, [same]).warnings.length, 1);
  assert.equal(validateImport([{ ...good, price_idr: '29' }], header, [same]).warnings.length, 1);
  assert.equal(validateImport([{ ...good, price_idr: '150' }], header, [same]).warnings.length, 0);
});

test('odd grades are noted for the agency as written, never as an accusation', () => {
  const notes = nonMonotonicKSeries(loadRegional());
  assert.ok(notes.some((n) => /Tangerang.*K-400.*K-350/.test(n)));
  assert.ok(notes.every((n) => /bukan tuduhan/.test(n)));
});

test('asphalt quantity uses the minimum wearing thickness; concrete uses the measured depth', () => {
  assert.equal(quantityFor('AC_WC_OVERLAY', { areaM2: 10, depthCm: 8 }).amount.mid, 10 * 0.04 * 2.295);
  assert.equal(quantityFor('HOT_MIX_PATCH', { areaM2: 1, depthCm: 2 }).amount.mid, 0.04 * 2.295);
  assert.equal(quantityFor('CONCRETE_K350', { areaM2: 1, depthCm: 20 }).amount.mid, 0.2);
});
