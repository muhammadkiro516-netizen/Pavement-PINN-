/**
 * Vehicle Load Configuration (PINN tab). Totals and axle/wheel loads are computed in the
 * browser from the same domain module the server uses; strains come only from the server's
 * MLET run ("Jalankan MLET"). Speed is recorded but has no effect: the solver is static.
 */
import React, { useMemo, useState } from 'react';
import { VEHICLE_PRESETS, vehicleLoads, type VehicleConfig, type VehicleType } from '../../../domain/workspace/vehicles';
import type { VehicleScenario } from '../api';
import { useWorkspace } from '../WorkspaceContext';
import { StatusBadge } from './shared';

const fmt = (v: number, d = 2) => v.toLocaleString('id-ID', { maximumFractionDigits: d, minimumFractionDigits: d });

export const VehiclePanel: React.FC<{ scenario: VehicleScenario | null; onScenario: (s: VehicleScenario | null) => void }> = ({ scenario, onScenario }) => {
  const { gateway, reportId } = useWorkspace();
  const [v, setV] = useState<VehicleConfig>(VEHICLE_PRESETS.car);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loads = useMemo(() => vehicleLoads(v), [v]);
  const range: Record<VehicleType, [number, number]> = { motorcycle: [100, 400], car: [800, 3500], truck: [5000, 40000] };
  const total = v.emptyMassKg + v.payloadKg;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      onScenario(await gateway.vehicleScenario(reportId, v));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-[#273244] bg-[#0B121A] p-3" data-testid="vehicle-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[13px] font-semibold">Vehicle Load Configuration</div>
        <StatusBadge tone="violet">skenario · tidak disimpan ke versi</StatusBadge>
      </div>
      <div className="mt-2 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-2 text-[12px]">
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(VEHICLE_PRESETS) as VehicleType[]).map((k) => (
              <button key={k} type="button" data-testid={`vehicle-${k}`} onClick={() => { setV(VEHICLE_PRESETS[k]); onScenario(null); }} className={`rounded-md px-2.5 py-1 ${v.type === k ? 'bg-[#FFD60A] text-[#0A0F14]' : 'bg-[#16202C] text-[#C9D4E3]'}`}>
                {VEHICLE_PRESETS[k].label}
              </button>
            ))}
          </div>
          <label className="block">
            Massa total {fmt(total, 0)} kg <span className="text-[#6B7A90]">(kosong {fmt(v.emptyMassKg, 0)} + muatan)</span>
            <input type="range" className="w-full accent-[#FFD60A]" min={range[v.type][0]} max={range[v.type][1]} step={v.type === 'truck' ? 500 : 10} value={total} onChange={(e) => { setV({ ...v, payloadKg: Math.max(0, Number(e.target.value) - v.emptyMassKg) }); onScenario(null); }} data-testid="vehicle-mass" />
          </label>
          <label className="block">
            Kecepatan {v.speedKmh} km/jam
            <input type="range" className="w-full accent-[#FFD60A]" min={0} max={100} value={v.speedKmh} onChange={(e) => setV({ ...v, speedKmh: Number(e.target.value) })} />
            <span className="text-[11px] text-[#8B9BB0]">Beban dinamis tidak dimodelkan: MLET statis-linear, kecepatan tidak mengubah hasil.</span>
          </label>
          <label className="block">
            Tekanan ban {fmt(v.tyrePressureMPa)} MPa
            <input type="range" className="w-full accent-[#FFD60A]" min={0.15} max={1} step={0.01} value={v.tyrePressureMPa} onChange={(e) => { setV({ ...v, tyrePressureMPa: Number(e.target.value) }); onScenario(null); }} />
          </label>
          <div className="rounded-lg bg-[#0F1720] p-2">
            <div className="text-[11px] text-[#8B9BB0]">Beban gravitasi total (massa × g)</div>
            <div className="text-[22px] font-bold tabular-nums" data-testid="vehicle-total-kn">{fmt(loads.totalKn)} kN</div>
            <div className="text-[11px] text-[#8B9BB0]">Bukan beban per roda. Pembagian sumbu = nilai awal ASSUMED, kalibrasi ke kendaraan yang dianalisis.</div>
          </div>
        </div>
        <div className="text-[12px]">
          <table className="w-full" data-testid="axle-table">
            <thead className="text-left text-[#8B9BB0]">
              <tr><th className="py-1">Sumbu</th><th>Posisi</th><th>Bagian</th><th>Beban sumbu</th><th>Roda</th><th>Per roda</th><th>Jari-jari kontak</th><th>εt (MLET)</th><th>εv (MLET)</th></tr>
            </thead>
            <tbody>
              {loads.axles.map((a) => {
                const res = scenario?.axles.find((x) => x.index === a.index);
                const gov = scenario?.governingIndex === a.index;
                return (
                  <tr key={a.index} className={`border-b border-[#1A2430] ${gov ? 'bg-[#13243A]' : ''}`}>
                    <td className="py-1.5">{a.index + 1}{gov && <StatusBadge tone="amber" className="ml-1">menentukan</StatusBadge>}</td>
                    <td>{fmt(a.positionM, 2)} m</td>
                    <td>{fmt(v.axles[a.index].share * 100, 1)} %</td>
                    <td>{fmt(a.axleKn)} kN</td>
                    <td>{a.wheels}</td>
                    <td>{fmt(a.wheelKn)} kN</td>
                    <td>{fmt(a.contactRadiusMm, 0)} mm</td>
                    <td>{res ? (res.etUe !== null ? `${fmt(res.etUe, 0)} µε` : <span className="text-[#F59AA3]">{res.error}</span>) : <span className="italic text-[#6B7A90]">belum dijalankan</span>}</td>
                    <td>{res && res.evUe !== null ? `${fmt(res.evUe, 0)} µε` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="mt-1 text-[11px] text-[#8B9BB0]">Σ beban sumbu − berat total = {fmt(loads.balanceKn, 6)} kN{loads.warnings.length ? ` · ${loads.warnings.join('; ')}` : ''}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={run} disabled={busy} data-testid="run-vehicle" className="rounded-lg bg-[#FFD60A] px-3 py-1.5 text-[12px] font-semibold text-[#0A0F14] disabled:opacity-50">
              {busy ? 'Menjalankan MLET…' : 'Jalankan MLET untuk kendaraan ini'}
            </button>
            {scenario && <button type="button" onClick={() => onScenario(null)} className="rounded-lg border border-[#273244] px-3 py-1.5 text-[12px]">Kembali ke run tersimpan</button>}
          </div>
          {error && <p className="mt-2 text-[12px] text-[#F59AA3]" data-testid="vehicle-error">{error}</p>}
          {scenario && <p className="mt-2 text-[11px] text-[#9AA8BC]">Lapisan dipakai: {scenario.layersUsed.map((l) => `${l.name} ${l.thicknessMm ?? '∞'} mm/E ${l.modulusMPa} MPa (${l.source})`).join(' · ')}. {scenario.dynamic}.</p>}
        </div>
      </div>
    </div>
  );
};
