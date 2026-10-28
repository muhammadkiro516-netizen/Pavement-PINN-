/** PINN decision card: scenarios derive from the engineer's inputs; answers follow the physics. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, decisionScenarios, LEGAL_AXLE_T, ODOL_AXLE_T } from '../../src/features/road-intelligence/PinnDecisionCard';
import type { EngineAssessRequest, EngineAssessResult } from '../../src/types';

const base: EngineAssessRequest = {
  segment_id: 'KRW-001',
  layers: [{ h_mm: 50, E_mpa: 2500, nu: 0.35, source: 'ASSUMED' }, { h_mm: 200, E_mpa: 300, nu: 0.35, source: 'ASSUMED' }],
  subgrade: { cbr: 5, state: 'dry' },
  load: { axle_t: 10, q_mpa: 0.55, dual_spacing_mm: 330 },
  traffic: { esal_day_p10: 100, esal_day_p50: 200, esal_day_p90: 300 },
  n_mc: 2000
};

const res = (nf: number, nd: number, governing: 'fatigue' | 'rutting', p50: number | null = null) =>
  ({ allowable: { criterion: 'AI', nf, nd, governing }, life_years: p50 === null ? null : { p10: p50 / 2, p50, p90: p50 * 2, uncertainty: '', label: '' } }) as unknown as EngineAssessResult;

test('scenarios: ODOL vs legal axle, wet subgrade, overlay +5 cm, reconstruction; no traffic needed', () => {
  const s = Object.fromEntries(decisionScenarios(base).map((x) => [x.key, x.request]));
  assert.equal(s.base, base);
  assert.equal(s.legal.load?.axle_t, LEGAL_AXLE_T);
  assert.equal(s.odol.load?.axle_t, ODOL_AXLE_T);
  assert.equal(s.wet.subgrade.state, 'wet');
  assert.equal(s.overlay.layers[0].h_mm, 100);
  assert.ok(s.recon.layers[0].E_mpa > base.layers[0].E_mpa);
  for (const k of ['legal', 'odol', 'wet', 'overlay', 'recon']) assert.equal(s[k].traffic, undefined, k);
});

test('decide: rutting-governed short life is structural; factors are ratios of allowable passes', () => {
  const d = decide({
    base: res(1e6, 2e5, 'rutting', 1.5),
    legal: res(2e6, 6e5, 'rutting'),
    odol: res(3e5, 4e4, 'rutting'),
    wet: res(8e5, 1e5, 'rutting'),
    overlay: res(5e6, 4e5, 'rutting'),
    recon: res(3e7, 5e6, 'fatigue')
  });
  assert.equal(d.structural, true);
  assert.equal(d.odolFactor, 6e5 / 4e4);
  assert.equal(Math.round(d.wetLossPct), 50);
  assert.equal(d.overlayFactor, 2);
  assert.equal(d.advice, 'REKONSTRUKSI', 'overlay below 3x is not enough for a structural failure');
});

test('decide: a strong structure with long life gets routine maintenance', () => {
  const r = res(1e8, 5e8, 'fatigue', 15);
  const d = decide({ base: r, legal: r, odol: res(1e7, 5e7, 'fatigue'), wet: r, overlay: r, recon: r });
  assert.equal(d.structural, false);
  assert.equal(d.advice, 'RUTIN');
});
