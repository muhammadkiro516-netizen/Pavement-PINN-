/**
 * PINN tab. The heatmap is drawn only from a field grid that a real MLET (PyMastic) run
 * returned; "PINN" is the project name (D-02), the PI-surrogate stays PLANNED. The Ops
 * Manager sees a decision summary above it; deciding on ASSUMED inputs needs explicit consent.
 */
import React, { Suspense, useEffect, useRef, useState } from 'react';
import { Bar, BarChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { useWsT } from '../i18n';
import { useWorkspace } from '../WorkspaceContext';
import { ActionButton, ColorLegend, MeasuredValue, rdylbu, Row, SectionTitle, SOURCE_TONE, StatusBadge, UnavailableCard } from '../components/shared';
import { CorrectionDialog, Modal } from '../components/dialogs';
import { structuralMayUseGeometry } from '../../../domain/workspace/rerun';
import { VehiclePanel } from '../components/VehiclePanel';
import type { VehicleScenario } from '../api';
import type { FieldGrid, Layer, StructuralRun } from '../../../domain/workspace/types';
import { PinnDecisionCard } from '../../road-intelligence/PinnDecisionCard';
import type { EngineAssessRequest } from '../../../types/engine';

const Pavement3D = React.lazy(() => import('../components/Pavement3D'));

type Variable = FieldGrid['variable'];

/** Bin label nearest to a percentile, so P10/P50/P90 lines sit on the categorical axis. */
function nearest(life: NonNullable<StructuralRun['lifeIndexYr']>, v: number): string | number {
  const e = life.binEdges;
  if (!e) return 0;
  let k = 0;
  for (let i = 0; i < e.length - 1; i++) if (v >= e[i]) k = i;
  return ((e[k] + e[k + 1]) / 2).toFixed(1);
}
/**
 * Request for the decision engine from the workspace layers. Needs every bound layer measured;
 * subgrade CBR from E ≈ 10·CBR MPa (Heukelom-Klomp), shown as an assumption by the engine card.
 */
function decideBase(layers: Layer[]): EngineAssessRequest | null {
  const bound = layers.filter((l) => l.name !== 'Subgrade');
  const sub = layers.find((l) => l.name === 'Subgrade');
  if (!sub?.modulusMPa.value || bound.some((l) => !l.thicknessMm.value || !l.modulusMPa.value)) return null;
  return {
    segment_id: 'workspace',
    layers: bound.map((l) => ({ h_mm: l.thicknessMm.value!, E_mpa: l.modulusMPa.value!, nu: l.poisson.value ?? 0.35, source: l.source })),
    subgrade: { cbr: Math.max(1, Math.round(sub.modulusMPa.value / 10)) },
    criterion: 'AI'
  };
}

const VAR_LABEL: Record<Variable, string> = { eps_xx: 'Strain εxx', eps_zz: 'Strain εzz', sigma_zz: 'Stress σzz' };

function currentRun(runs: StructuralRun[], objectId: string | undefined): StructuralRun | null {
  const live = runs.filter((r) => r.status === 'completed');
  return live.find((r) => r.objectId === objectId) ?? live.at(-1) ?? null;
}

const Heatmap: React.FC<{ grid: FieldGrid; range: number; markers: Array<{ x: number; z: number; label: string }> }> = ({ grid, range, markers }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const W = 640;
  const H = 400;
  const xmin = grid.xMm[0];
  const xmax = grid.xMm[grid.xMm.length - 1];
  const zmax = grid.zMm[grid.zMm.length - 1];
  const px = (x: number) => ((x - xmin) / (xmax - xmin)) * W;
  const pz = (z: number) => (z / zmax) * H;
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    const nx = grid.xMm.length;
    const nz = grid.zMm.length;
    for (let zi = 0; zi < nz; zi++) {
      for (let xi = 0; xi < nx; xi++) {
        const v = grid.values[zi][xi];
        const x0 = xi === 0 ? 0 : (px(grid.xMm[xi - 1]) + px(grid.xMm[xi])) / 2;
        const x1 = xi === nx - 1 ? W : (px(grid.xMm[xi]) + px(grid.xMm[xi + 1])) / 2;
        const z0 = zi === 0 ? 0 : (pz(grid.zMm[zi - 1]) + pz(grid.zMm[zi])) / 2;
        const z1 = zi === nz - 1 ? H : (pz(grid.zMm[zi]) + pz(grid.zMm[zi + 1])) / 2;
        ctx.fillStyle = v === null ? '#333' : rdylbu(v / range);
        ctx.fillRect(x0, z0, x1 - x0 + 0.5, z1 - z0 + 0.5);
      }
    }
  }, [grid, range]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="relative w-full" style={{ aspectRatio: `${W + 70} / ${H + 50}` }} data-testid="pinn-heatmap">
      <svg viewBox={`-60 -20 ${W + 70} ${H + 50}`} className="absolute inset-0 h-full w-full">
        <foreignObject x={0} y={0} width={W} height={H}>
          <canvas ref={ref} width={W} height={H} style={{ width: '100%', height: '100%' }} />
        </foreignObject>
        {(grid.interfacesMm ?? []).map((z) => (
          <line key={z} x1={0} x2={W} y1={pz(z)} y2={pz(z)} stroke="#fff" strokeOpacity={0.7} strokeWidth={1} />
        ))}
        {(grid.wheelsXMm ?? []).map((x) => (
          <text key={x} x={px(x)} y={-4} fill="#fff" fontSize={14} textAnchor="middle">↓</text>
        ))}
        {markers.map((m) => (
          <g key={m.label}>
            <circle cx={px(m.x)} cy={pz(m.z)} r={5} fill="#fff" stroke="#000" />
            <text x={px(m.x) + 8} y={pz(m.z) - 6} fill="#fff" fontSize={11} stroke="#000" strokeWidth={2.5} paintOrder="stroke">{m.label}</text>
          </g>
        ))}
        {[0, 200, 400, 600, 800].filter((z) => z <= zmax).map((z) => (
          <text key={z} x={-8} y={pz(z) + 4} fill="#8B9BB0" fontSize={11} textAnchor="end">{z}</text>
        ))}
        {[-800, -400, 0, 400, 800].filter((x) => x >= xmin && x <= xmax).map((x) => (
          <text key={x} x={px(x)} y={H + 16} fill="#8B9BB0" fontSize={11} textAnchor="middle">{x}</text>
        ))}
        <text x={W / 2} y={H + 30} fill="#8B9BB0" fontSize={11} textAnchor="middle">jarak melintang (mm)</text>
        <text x={-44} y={H / 2} fill="#8B9BB0" fontSize={11} transform={`rotate(-90 -44 ${H / 2})`} textAnchor="middle">kedalaman (mm)</text>
      </svg>
    </div>
  );
};

/** Grid cell holding the extreme of a variable just above/below a depth. */
function markerAt(grid: FieldGrid, zTarget: number, above: boolean, label: string) {
  const zi = above ? grid.zMm.map((z, i) => [z, i]).filter(([z]) => z <= zTarget).at(-1)?.[1] : grid.zMm.findIndex((z) => z >= zTarget);
  if (zi === undefined || zi < 0) return null;
  let best = -1;
  let bx = 0;
  grid.values[zi].forEach((v, xi) => {
    if (v !== null && v > best) {
      best = v;
      bx = grid.xMm[xi];
    }
  });
  return { x: bx, z: grid.zMm[zi], label };
}

export const PinnMain: React.FC = () => {
  const t = useWsT();
  const { workspace: w, activeObject: o, isOpsManager } = useWorkspace();
  const [variable, setVariable] = useState<Variable>('eps_xx');
  const [scenario, setScenario] = useState<VehicleScenario | null>(null);
  if (!w) return null;
  const run = currentRun(w.structuralRuns, o?.objectId);
  if (!run) {
    const bound = w.layers.filter((l) => l.name !== 'Subgrade');
    const reason = bound.some((l) => l.thicknessMm.value === null) ? `${t('modelNotRun')}: data lapisan belum diisi (tab Structure).` : `${t('modelNotRun')}.`;
    return <UnavailableCard reason={reason} />;
  }
  // A vehicle scenario (server MLET run) replaces the stored run's field while it is shown.
  const sf = scenario?.field;
  const grid: FieldGrid | null = sf
    ? { variable, unit: sf[variable].unit, xMm: sf.x_mm, zMm: sf.z_mm, values: sf[variable].values, wheelsXMm: sf.wheels_x_mm, interfacesMm: sf.interfaces_mm }
    : run.fieldGrids.find((g) => g.variable === variable) ?? null;
  const vehicleView = scenario
    ? { type: scenario.vehicle.type, axlePositionsM: scenario.vehicle.axles.map((a) => a.positionM), wheelsPerAxle: scenario.vehicle.axles.map((a) => a.wheels), governingIndex: scenario.governingIndex, dualSpacingMm: scenario.vehicle.dualSpacingMm }
    : null;
  const abs = grid ? Math.max(...grid.values.flat().filter((v): v is number => v !== null).map(Math.abs)) : 1;
  const range = Math.max(1e-9, abs);
  const acBottom = grid?.interfacesMm?.[0];
  const subTop = grid?.interfacesMm?.at(-1);
  const markers =
    grid && variable === 'eps_xx' && acBottom !== undefined
      ? [markerAt(grid, acBottom, true, `εt maks (grid)`)].filter(Boolean)
      : grid && variable === 'eps_zz' && subTop !== undefined
        ? [markerAt(grid, subTop, false, 'εv di atas subgrade')].filter(Boolean)
        : [];
  const assumed = [
    ...run.layers.filter((l) => l.source === 'ASSUMED' || l.source === 'DEFAULT' || l.source === 'MISSING').map((l) => `Lapis ${l.name}: ${l.source}`),
    `Beban: ${run.load.source}`,
    `ESAL: ${run.load.esalSource}`
  ];

  return (
    <div className="space-y-3">
      {isOpsManager && (
        <div className="rounded-xl border border-[#273244] bg-[#0B121A] p-3" data-testid="decision-summary">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[13px] font-semibold">Ringkasan keputusan</div>
            <StatusBadge tone="violet">{t('simulatedScenario')}</StatusBadge>
          </div>
          <div className="mt-2 grid gap-2 text-[12px] md:grid-cols-3">
            <div>Indeks Umur P10/P50/P90: {run.lifeIndexYr ? `${run.lifeIndexYr.p10.toFixed(1)} / ${run.lifeIndexYr.p50.toFixed(1)} / ${run.lifeIndexYr.p90.toFixed(1)} th (${run.lifeIndexYr.criterion})` : <span className="italic text-[#8B9BB0]">belum dihitung — data lalu lintas belum diisi</span>}</div>
            <div>Opsi perbaikan: lihat perbandingan di bawah (umur per opsi; biaya HSPK belum dimasukkan)</div>
            <div className="flex flex-wrap gap-1">{assumed.map((a) => <StatusBadge key={a} tone="amber">{a}</StatusBadge>)}</div>
          </div>
          <p className="mt-2 text-[11px] text-[#8B9BB0]">Keputusan penanganan dicatat lewat rekomendasi petugas dan persetujuan Koordinator di Antrian, bukan di halaman ini.</p>
        </div>
      )}
      {decideBase(w.layers) && <PinnDecisionCard base={decideBase(w.layers)!} />}
      <div className="flex flex-wrap items-center gap-2">
        {(['eps_xx', 'eps_zz', 'sigma_zz'] as Variable[]).map((v) => (
          <button key={v} type="button" onClick={() => setVariable(v)} className={`rounded-md px-2.5 py-1 text-[12px] ${variable === v ? 'bg-[#1D4573] text-white' : 'bg-[#16202C] text-[#C9D4E3]'}`}>{VAR_LABEL[v]}</button>
        ))}
        <span className="rounded-md bg-[#16202C] px-2.5 py-1 text-[12px] text-[#6B7A90]" title="Lendutan belum diminta dari solver">Deflection (belum dihitung)</span>
        <span className="rounded-md bg-[#1D4573] px-2.5 py-1 text-[12px] text-white">Beban: {run.load.axleT} t, {run.load.config} · {run.load.source}</span>
        <span className="rounded-md bg-[#16202C] px-2.5 py-1 text-[12px] text-[#C9D4E3]">Kondisi: {run.condition === 'dry' ? 'kering' : 'basah'}</span>
        {grid && <span className="rounded-md bg-[#16202C] px-2.5 py-1 text-[12px] text-[#C9D4E3]">Skala: ±{range.toFixed(grid.unit === 'MPa' ? 3 : 0)} {grid.unit}</span>}
      </div>
      <VehiclePanel scenario={scenario} onScenario={setScenario} />
      {scenario && <p className="text-[11px] text-[#F5C451]" data-testid="scenario-banner">Menampilkan skenario {scenario.vehicle.label}: medan dari sumbu {scenario.governingIndex + 1} (εt terbesar), run MLET {scenario.at.slice(11, 19)} — tidak disimpan ke versi laporan.</p>}
      {grid && (
        <div data-testid="pinn-3d">
          <Suspense fallback={<div className="h-[420px] rounded-xl bg-[#0B121A]" />}>
            <Pavement3D mode="pinn" vehicle={vehicleView} layers={run.layers} surface={w.surfaces.find((sf) => sf.objectId === run.objectId) ?? null} field={grid} fieldRange={range} wheelsXMm={grid.wheelsXMm ?? []} />
          </Suspense>
          <p className="mt-1 text-[11px] text-[#8B9BB0]">
            Preview 3D: irisan {VAR_LABEL[variable]} pada bidang melalui pusat roda, dari run {run.runId} ({run.engineVersion}). Medan adalah respons statis MLET saat roda tepat di bidang potong; gerakan roda hanya ilustrasi posisi beban, bukan simulasi dinamis. Mesin = MLET, bukan jaringan saraf (surrogate PI-NN masih RENCANA).
          </p>
        </div>
      )}
      {grid ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div>
            <Heatmap grid={grid} range={range} markers={markers as Array<{ x: number; z: number; label: string }>} />
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
              <ColorLegend unit={grid.unit} min={-range} max={range} scale="diverging" label={variable === 'eps_xx' ? 'tarik positif' : 'tekan positif'} />
              <span className="text-[11px] text-[#6B7A90]">Grid dari run {run.runId} ({run.engineVersion}); garis putih = batas lapis.</span>
            </div>
          </div>
          <div>
            <div className="mb-1 text-[12px] text-[#C9D4E3]">Indeks Umur (tahun) · sampel lalu lintas ASSUMED{run.lifeIndexYr ? ` n=${run.lifeIndexYr.samples} · P10/P50/P90` : ''}</div>
            {run.lifeIndexYr?.histogram ? (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={run.lifeIndexYr.histogram.map((v, i) => ({ i: run.lifeIndexYr!.binEdges ? ((run.lifeIndexYr!.binEdges[i] + run.lifeIndexYr!.binEdges[i + 1]) / 2).toFixed(1) : i, v }))}>
                    <XAxis dataKey="i" tick={{ fill: '#8B9BB0', fontSize: 10 }} label={{ value: 'tahun', fill: '#8B9BB0', fontSize: 10, position: 'insideBottomRight', offset: -2 }} />
                    <ReferenceLine x={nearest(run.lifeIndexYr, run.lifeIndexYr.p10)} stroke="#F5C451" strokeDasharray="4 3" />
                    <ReferenceLine x={nearest(run.lifeIndexYr, run.lifeIndexYr.p50)} stroke="#fff" strokeDasharray="4 3" />
                    <ReferenceLine x={nearest(run.lifeIndexYr, run.lifeIndexYr.p90)} stroke="#F5C451" strokeDasharray="4 3" />
                    <YAxis tick={{ fill: '#8B9BB0', fontSize: 10 }} />
                    <Bar dataKey="v" fill="#38BDF8" isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <UnavailableCard reason="Histogram Monte Carlo belum tersedia: data lalu lintas (ESAL) belum diisi dan surrogate PI-NN masih RENCANA." />
            )}
          </div>
        </div>
      ) : (
        <UnavailableCard reason={`Grid ${VAR_LABEL[variable]} tidak dikembalikan oleh run ini.`} />
      )}
    </div>
  );
};

export const PinnPanel: React.FC = () => {
  const t = useWsT();
  const { workspace: w, activeObject: o, isFieldEngineer, isOpsManager, setTab } = useWorkspace();
  const [dialog, setDialog] = useState<null | 'load' | 'rerun'>(null);
  const [axle, setAxle] = useState('8.16');
  const locked = isFieldEngineer ? null : t('feOnly');
  if (!w) return null;
  const run = currentRun(w.structuralRuns, o?.objectId);
  const measuredLayers = w.layers.filter((l) => l.source === 'MEASURED' || l.source === 'DOCUMENT').length;
  return (
    <div>
      <SectionTitle>Hasil run</SectionTitle>
      <Row label="Mesin">{run ? `${run.engine === 'MLET-PyMastic' ? 'MLET' : run.engine} ${run.engineVersion}` : <span className="italic text-[#8B9BB0]">{t('modelNotRun')}</span>}</Row>
      <Row label="εt bawah AC"><MeasuredValue m={run?.epsTUe} digits={0} /></Row>
      <Row label="εv atas subgrade"><MeasuredValue m={run?.epsVUe} digits={0} /></Row>
      <Row label="Indeks Umur P10/P50/P90">{run?.lifeIndexYr ? `${run.lifeIndexYr.p10.toFixed(1)} / ${run.lifeIndexYr.p50.toFixed(1)} / ${run.lifeIndexYr.p90.toFixed(1)} th` : <span className="italic text-[#8B9BB0]">belum dihitung</span>}</Row>
      <Row label="Kriteria">{run?.lifeIndexYr?.criterion ?? 'AI (dipilih eksplisit)'}</Row>
      <SectionTitle>Input & kondisi batas</SectionTitle>
      <Row label="Lapisan">{measuredLayers} terukur, {w.layers.length - measuredLayers} asumsi/kosong</Row>
      <Row label="Beban">{run ? <StatusBadge tone={SOURCE_TONE[run.load.source]}>{run.load.axleT} t · {run.load.source}</StatusBadge> : '—'}</Row>
      <Row label="ESAL">{run ? <StatusBadge tone={SOURCE_TONE[run.load.esalSource]}>{run.load.esalSource}</StatusBadge> : '—'}</Row>
      <Row label="Interface">terikat penuh</Row>
      <Row label="Geometri kerusakan">{structuralMayUseGeometry(w.stageRuns) ? 'dipakai (T5/T6 lulus)' : <span className="italic text-[#8B9BB0]">tidak dipakai — T5/T6 belum lulus</span>}</Row>
      <Row label="Surrogate PI-NN">dipakai untuk umur P10–P90 di kartu keputusan (OpenVINO)</Row>
      <SectionTitle>{t('validationStatus')}</SectionTitle>
      <StatusBadge tone="violet">{run?.scenarioLabel === 'validated' ? 'Tervalidasi' : t('simulatedScenario')}</StatusBadge>
      {run?.assumptions.length ? <ul className="mt-2 list-disc pl-4 text-[11px] text-[#9AA8BC]">{run.assumptions.map((a) => <li key={a}>{a}</li>)}</ul> : null}
      <SectionTitle>{isOpsManager ? t('omActions') : t('feActions')}</SectionTitle>
      <div className="flex flex-wrap gap-2">
        <ActionButton locked={locked} onClick={() => setDialog('load')}>Ubah beban</ActionButton>
        <ActionButton locked={locked} onClick={() => setTab('structure')}>Ubah material</ActionButton>
        <ActionButton primary locked={locked} testId="rerun-t7" onClick={() => setDialog('rerun')}>Jalankan ulang</ActionButton>
      </div>
      {dialog === 'load' && (
        <CorrectionDialog title="Ubah beban" kind="load" field="load" newValue={{ axleT: Number(axle), config: 'roda ganda 330 mm', source: 'MEASURED' }} valid={Number(axle) > 0} onClose={() => setDialog(null)}>
          <label className="block text-[12px]">Beban sumbu (t)<input type="number" value={axle} onChange={(e) => setAxle(e.target.value)} className="w-full rounded border border-[#273244] bg-[#0A0F14] p-1.5" /></label>
        </CorrectionDialog>
      )}
      {dialog === 'rerun' && <CorrectionDialog title="Jalankan ulang T7 (MLET)" kind="criterion" field="criterion" newValue="AI" onClose={() => setDialog(null)} />}
    </div>
  );
};
