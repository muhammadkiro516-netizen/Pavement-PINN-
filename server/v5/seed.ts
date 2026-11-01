/**
 * DEMO seed (02 §9 D-8): one Jakarta case that has been through the whole workflow, one Karawang
 * case waiting for a coordinator. Everything goes through the real state machine, the real capture
 * pipeline and the real engines, on the demo chain, stamped DEMO. No result is typed in by hand:
 * if the AI service is down the case records MODEL_UNAVAILABLE and PINN_UNAVAILABLE instead.
 */
import { SYSTEM_ACTOR, type V5Command } from '../../src/domain/v5/stateMachine';
import { V5_STATE_LABELS, type EvidenceRef, type V5Actor, type V5Case } from '../../src/domain/v5/model';
import { fairCost } from '../../src/domain/v5/costEngine';
import { callInference } from '../services/inferenceClient';
import { actorFor, deviceActor, findDemoAccount } from './demoPeople';
import type { V5Store } from './store';
import type { RoadRegistry, RoutingDecision } from './routing';
import { isCaptureFailure, type CaptureService, type EvidenceRecord } from './capture';

const REASON = 'Checked against the photos and the road registry.';

// Jl. Matraman Raya, Jakarta Timur, and the Pantura road at Klari, Karawang.
export const SEED_JAKARTA = { lat: -6.2006, lon: 106.8574 };
export const SEED_KARAWANG = { lat: -6.3537, lon: 107.3669 };

export async function seedDemoCases(deps: { store: V5Store; capture: CaptureService; registry: RoadRegistry }): Promise<void> {
  const { store, capture, registry } = deps;
  if (store.list().length > 0) return;
  const staff = (accountId: string): V5Actor => actorFor(findDemoAccount(accountId)!);
  const inspector = staff('ACC-INSPECT');
  const coordinator = staff('ACC-COORD');
  const approver = staff('ACC-APPROVE');
  const crew = staff('ACC-CREW');
  const supervisor = staff('ACC-SUPERVISE');

  const photo = async (owner: V5Actor, sampleId: string, kind: EvidenceRecord['kind'], at: { lat: number; lon: number }, stage: string | null = null, values: Record<string, unknown> | null = null): Promise<{ ref: EvidenceRef; rec: EvidenceRecord }> => {
    const { nonce } = capture.issueNonce(owner.accountId, 'SEED');
    const rec = await capture.capture({ ownerId: owner.accountId, sampleId, nonce, kind, stage, gps: { lat: at.lat, lon: at.lon, accuracyM: 6, speedMps: 0 }, motionSamples: 0, values });
    if (isCaptureFailure(rec)) throw new Error(`seed photo failed: ${rec.message}`);
    return { rec, ref: { id: rec.id, sha256: rec.sha256Public, kind: rec.kind, stage: rec.stage, captureTrust: rec.captureTrust, demoSource: rec.demoSource, values: rec.values } };
  };

  const step = (c: V5Case, cmd: V5Command, actor: V5Actor, now: string): V5Case => {
    const out = store.apply(c, cmd, actor, now, c.version);
    if ('ok' in out) throw new Error(`seed step ${cmd.action} failed: ${out.message}`);
    return out.case;
  };

  const routingFor = (d: RoutingDecision): NonNullable<V5Case['routing']> => ({ segmentId: d.segment?.id ?? null, segmentName: d.segment?.name ?? null, roadStatus: d.status, authorityId: d.authorityId, authorityName: d.authorityName, authorityLevel: d.status, officeId: d.officeId, officeName: d.officeName, confidence: d.confidence, basis: `${d.basis} ${d.legalBasis}.`, note: d.coordinatorPrompt });

  const report = async (at: { lat: number; lon: number }, prefix: string, sampleId: string, sizeBand: string, classGuess: string): Promise<V5Case> => {
    const citizen = deviceActor(`DEV-SEED-${prefix}`);
    const now = new Date().toISOString();
    const first = await photo(citizen, sampleId, 'OVERVIEW', at);
    const decision = registry.decide(at.lat, at.lon, 6);
    const c0 = store.newCase({ isDemo: true, createdAt: now, createdBy: { kind: 'DEVICE', ref: store.chain.actorRef('DEVICE', citizen.accountId), personId: null }, mode: 'SINGLE', location: { latE6: Math.round(at.lat * 1e6), lonE6: Math.round(at.lon * 1e6), accuracyM: 6 }, captureTrust: 'DEMO' }, prefix);
    capture.claim([first.rec.id], citizen.accountId, c0.id);
    // Seed marker: the first event of a seeded case says it is sample data.
    store.record(c0, {}, 'demo.seeded', { label: 'DEMO' }, SYSTEM_ACTOR, now);
    let c = step(c0, { action: 'SUBMIT', evidence: [first.ref], classGuess, sizeBand }, citizen, now);
    c = step(c, { action: 'BEGIN_SCREENING' }, SYSTEM_ACTOR, now);
    const best = first.rec.ai.detections.sort((a, b) => b.confidence - a.confidence)[0] ?? null;
    return step(c, { action: 'SCREENING_DONE', screening: { status: first.rec.ai.status === 'REAL' ? 'REAL' : 'MODEL_UNAVAILABLE', modelId: first.rec.ai.modelId, label: best?.taxonomyCode ?? null, score: best?.confidence ?? null }, routing: routingFor(decision) }, SYSTEM_ACTOR, now);
  };

  // Karawang: waiting in the coordinator's queue, for the live walk-through.
  await report(SEED_KARAWANG, 'KRW', 'pothole-2', 'M', 'POTHOLE');

  // Jakarta: DEMO-0001 of the tour. Through every role, ending under watch.
  const at = SEED_JAKARTA;
  let c = await report(at, 'JKT', 'pothole', 'M', 'POTHOLE');
  let now = new Date().toISOString();
  c = step(c, { action: 'ACCEPT', reason: REASON, damageClass: 'POTHOLE' }, coordinator, now);
  c = step(c, { action: 'ASSIGN_INSPECTION', inspectorPersonId: inspector.personId, inspectorAccountId: inspector.accountId, dueAt: new Date(Date.now() + 3 * 86_400_000).toISOString() }, coordinator, now);
  const overview = await photo(inspector, 'pothole', 'OVERVIEW', at);
  const marker = await photo(inspector, 'marker-card', 'MARKER_NADIR', at);
  const ruler = await photo(inspector, 'ruler', 'DEPTH_RULER', at);
  c = step(c, { action: 'SUBMIT_INSPECTION', verdict: 'CONFIRMED', classConfirmed: 'POTHOLE', lengthMm: 800, widthMm: 600, depthMmTyped: 45, markerDetected: marker.rec.marker?.found === true, rulerCheck: 'AI_UNREADABLE', evidence: [overview.ref, marker.ref, ruler.ref] }, inspector, now);
  c = step(c, { action: 'VERIFY_INSPECTION', reason: 'Measurements and photos are complete.' }, coordinator, now);

  const diag = await callInference('POST', '/v1/diagnose', { segment_id: c.id, road_class: c.routing?.roadStatus === 'NASIONAL' ? 'NASIONAL' : 'PROVINSI', esal_year: 250000, n: 2000 }, 60_000);
  now = new Date().toISOString();
  if (!('unavailable' in diag) && diag.ok) {
    const b = diag.body as { verdict: string; title: string; confidence: string; samples: number; remaining_life_years: { p10: number; p50: number; p90: number }; solver: { dry: { device: string; openvino: string } } };
    const m = (y: number) => Math.round(y * 120) / 10;
    const run = { id: 'PINN-seed0001', status: 'COMPUTED' as const, esalYear: 250000, roadClass: 'PROVINSI', lifeMonths: { p10: m(b.remaining_life_years.p10), p50: m(b.remaining_life_years.p50), p90: m(b.remaining_life_years.p90) }, verdict: b.verdict, title: b.title, confidence: b.confidence, samples: b.samples, solver: `pi-surrogate-v1, OpenVINO ${b.solver.dry.openvino.split('-')[0]}`, device: b.solver.dry.device, hostLabel: 'HOST_NON_INTEL', repairOptions: ['HOT_MIX_FULL_DEPTH_PATCH', 'COLD_MIX_TEMPORARY'], ranAt: now };
    c = store.record(c, { pinnRun: run }, 'pinn.run', { pinn_run_id: run.id, status: 'COMPUTED', esal_year: 250000, life_days_p10: Math.round(run.lifeMonths.p10 * 30.44), life_days_p50: Math.round(run.lifeMonths.p50 * 30.44), life_days_p90: Math.round(run.lifeMonths.p90 * 30.44) }, inspector, now);
  } else {
    c = store.record(c, { pinnRun: { id: 'PINN-seed0001', status: 'PINN_UNAVAILABLE', reason: 'The physics service was not reachable when this demo case was seeded.', repairOptions: ['HOT_MIX_FULL_DEPTH_PATCH', 'COLD_MIX_TEMPORARY'], ranAt: now } }, 'pinn.run', { pinn_run_id: 'PINN-seed0001', status: 'PINN_UNAVAILABLE' }, inspector, now);
  }

  const cost = fairCost({ caseId: c.id, mode: 'SINGLE', mix: 'AC_WC', lengthM: 0.8, widthM: 0.6, depthCm: 4.5, sizeStatus: marker.rec.marker?.found ? 'MEASURED' : 'AI_ESTIMATE', sizeSource: 'Marker card in the photo; typed by the inspector (DEMO)', regionName: 'DKI Jakarta', regionIsJakarta: true });
  c = store.record(c, { costRun: { ...cost, id: 'COST-seed0001', ranAt: now } }, 'cost.estimated', { cost_estimate_id: 'COST-seed0001', fair_low_idr: cost.fairCostIdr!.low, fair_mid_idr: cost.fairCostIdr!.mid, fair_high_idr: cost.fairCostIdr!.high }, inspector, now);
  const areaCm2 = Math.round(cost.quantity.areaCutM2.mid * 10000);
  const thicknessMm = Math.round(cost.quantity.depthRepairCm * 10);
  c = step(c, { action: 'PROPOSE_PLAN', repairType: 'HOT_MIX_FULL_DEPTH_PATCH', category: 'PERMANENT', urgency: 'PRIORITY', rationale: 'Pothole in the wheel path. Full-depth hot-mix patch.', areaCm2, thicknessMm, volumeCm3: (areaCm2 * thicknessMm) / 10, costEstimateId: 'COST-seed0001', pinnRunId: c.pinnRun?.status === 'COMPUTED' ? c.pinnRun.id : null }, inspector, now);
  c = step(c, { action: 'APPROVE_PLAN', reason: 'Size, fair-cost range and urgency look right.', budgetSource: 'APBD' }, approver, now);
  c = step(c, { action: 'ISSUE_WORK_ORDER', type: 'SWAKELOLA', crewPersonId: crew.personId, crewAccountId: crew.accountId, crewOrgId: crew.orgId, supervisorPersonId: supervisor.personId, supervisorAccountId: supervisor.accountId, supervisorOrgId: supervisor.orgId, targetDate: new Date(Date.now() + 7 * 86_400_000).toISOString(), category: 'PERMANENT' }, coordinator, now);

  const stages: [string, Record<string, unknown> | null][] = [['BEFORE', null], ['CUT_EDGES', { cutLengthCm: 140, cutWidthCm: 120 }], ['CLEAN_DRY', null], ['TACK_COAT', { material: 'CSS-1' }], ['DELIVERY_TICKET', { mixType: 'AC-WC', weightKg: 300 }], ['MIX_TEMP_TRUCK', { temperatureC: 142 }], ['MIX_TEMP_MAT', { temperatureC: 128 }], ['LOOSE_THICKNESS', { thicknessMm: 55 }], ['COMPACTION', { passes: 6, compactor: 'STAMPER' }], ['AFTER', null]];
  const shots: EvidenceRef[] = [];
  for (const [stage, values] of stages) shots.push((await photo(crew, `stage-${stage.toLowerCase().replace(/_/g, '-')}`, 'WORK_STAGE', at, stage, values)).ref);
  now = new Date().toISOString();
  c = step(c, { action: 'START_WORK', evidence: shots.filter((s) => s.stage === 'BEFORE' || s.stage === 'CUT_EDGES') }, crew, now);
  c = step(c, { action: 'SUBMIT_WORK_EVIDENCE', evidence: shots.filter((s) => s.stage !== 'BEFORE' && s.stage !== 'CUT_EDGES') }, crew, now);
  c = store.record(c, { declared: { areaCm2, thicknessMm, tonnageKg: 300, reportedSpendIdr: 900000 } }, 'work.declared', { area_cm2: areaCm2, thickness_mm: thicknessMm, tonnage_kg: 300, reported_spend_idr: 900000, flags: [] }, crew, now);
  const own = await photo(supervisor, 'stage-supervisor-after', 'WORK_STAGE', at, 'SUPERVISOR_AFTER');
  c = step(c, { action: 'VERIFY_WORK', evidence: [own.ref] }, supervisor, now);
  c = step(c, { action: 'ACCEPT_WORK', reason: 'The supervisor checked every stage. Accepted.' }, approver, now);
  console.log(`[v5] demo seed ready: ${c.publicCode} (${V5_STATE_LABELS[c.state!].en}), Karawang queued`);
}
