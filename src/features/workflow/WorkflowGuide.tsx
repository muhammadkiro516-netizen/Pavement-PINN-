/**
 * "Alur kerja" strip for the two staff roles: each step says in plain words what happens there,
 * who acts, and how many cases sit in it right now (from the shared server workflow). The case
 * map shows the same cases where they are, coloured by step, so the list and the map agree.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { ReportCase } from '../../domain/workflow/model';
import { samePerson } from '../../domain/identity/people';
import { basemapCandidates } from '../../components/maps/vectorBasemap';

export interface GuideStep {
  key: string;
  title: string;
  what: string;
  who: 'Anda' | 'Petugas' | 'Koordinator' | 'Warga';
  color: string;
  match: (c: ReportCase) => boolean;
}

maplibregl.setWorkerUrl(maplibreWorkerUrl);

const workDone = (c: ReportCase) => c.workOrder?.status === 'COMPLETED' || !!c.workOrder?.completedAt;

export const OPS_STEPS: GuideStep[] = [
  { key: 'new', title: 'Periksa laporan baru', what: 'Lihat foto & hasil AI warga, lalu terima, tolak, atau alihkan ke instansi yang berwenang.', who: 'Anda', color: '#FFD60A', match: (c) => c.state === 'NEEDS_REVIEW' },
  { key: 'assign', title: 'Tugaskan inspeksi', what: 'Pilih petugas lapangan dan tenggat. Pasang rambu bila rusak berat.', who: 'Anda', color: '#FF6B2C', match: (c) => c.state === 'VERIFIED' },
  { key: 'field', title: 'Petugas di lapangan', what: 'Petugas memotret dari 3–5 sisi, AI menganalisis tiap foto, lalu petugas mengukur dengan meteran.', who: 'Petugas', color: '#4C8DFF', match: (c) => c.state === 'FIELD_INSPECTION_REQUESTED' },
  { key: 'verify', title: 'Cek ringkasan kasus', what: 'Bandingkan foto semua sisi, temuan AI, dan ukuran. Setujui atau minta inspeksi ulang.', who: 'Anda', color: '#E879F9', match: (c) => c.state === 'INSPECTED' && !workDone(c) },
  { key: 'plan', title: 'Rekomendasi & persetujuan', what: 'Petugas menyusun penanganan dari analisis PINN; Anda menyetujui lalu menerbitkan SPK.', who: 'Anda', color: '#F59E0B', match: (c) => ['INSPECTION_VERIFIED', 'ACTION_RECOMMENDED', 'ACTION_APPROVED'].includes(c.state) },
  { key: 'work', title: 'Perbaikan berjalan', what: 'Kontraktor bekerja; petugas mengirim foto sesudah & material yang dipakai.', who: 'Petugas', color: '#38BDF8', match: (c) => c.state === 'IN_PROGRESS' && !workDone(c) },
  { key: 'check', title: 'Cek hasil perbaikan', what: 'Bandingkan foto sebelum–sesudah dan cek AI pada foto sesudah. Terima atau minta perbaikan ulang.', who: 'Anda', color: '#A3E635', match: (c) => (c.state === 'IN_PROGRESS' || c.state === 'INSPECTED') && workDone(c) },
  { key: 'done', title: 'Selesai', what: 'Warga sekitar diminta mengonfirmasi hasil; ruas dipantau bila rusak lagi.', who: 'Warga', color: '#2BD67B', match: (c) => c.state === 'RESOLVED' || c.state === 'CLOSED' }
];

export const fieldSteps = (me: string): GuideStep[] => {
  const mine = (c: ReportCase) => !!c.assignment && samePerson(c.assignment.engineerId, me);
  return [
    { key: 'inspect', title: 'Inspeksi lapangan', what: 'Datangi lokasi, foto dari 3–5 sisi (AI menganalisis), ukur panjang × lebar × dalam, kirim.', who: 'Anda', color: '#FFD60A', match: (c) => mine(c) && c.state === 'FIELD_INSPECTION_REQUESTED' },
    { key: 'wait', title: 'Diperiksa koordinator', what: 'Koordinator membaca ringkasan kasus Anda.', who: 'Koordinator', color: '#4C8DFF', match: (c) => mine(c) && c.state === 'INSPECTED' && !workDone(c) },
    { key: 'recommend', title: 'Susun rekomendasi', what: 'Buka Analisis PINN: sisa umur & opsi penanganan, lalu ajukan.', who: 'Anda', color: '#FF6B2C', match: (c) => mine(c) && c.state === 'INSPECTION_VERIFIED' },
    { key: 'work', title: 'Awasi & kirim bukti perbaikan', what: 'Setelah SPK terbit: foto sesudah, material, dan alat pemadat.', who: 'Anda', color: '#FFD60A', match: (c) => mine(c) && c.state === 'IN_PROGRESS' && !workDone(c) },
    { key: 'done', title: 'Selesai', what: 'Koordinator memverifikasi hasil perbaikan.', who: 'Koordinator', color: '#2BD67B', match: (c) => mine(c) && (workDone(c) || c.state === 'RESOLVED' || c.state === 'CLOSED') }
  ];
};

export const WorkflowGuide: React.FC<{ title: string; steps: GuideStep[]; cases: ReportCase[]; onPick?: (step: GuideStep, first: ReportCase | null) => void }> = ({ title, steps, cases, onPick }) => {
  const counts = useMemo(() => steps.map((s) => cases.filter(s.match).length), [steps, cases]);
  const next = steps.findIndex((s, i) => s.who === 'Anda' && counts[i] > 0);
  return (
    <section className="mx-4 mt-4 rounded-[28px] border border-white/8 bg-[#15181D] p-4 text-white" aria-label={title}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-extrabold">{title}</p>
        <p className="text-xs text-[#A1A1AA]">{next >= 0 ? <>Berikutnya untuk Anda: <b className="text-[#FFD60A]">{steps[next].title}</b> ({counts[next]} kasus)</> : 'Tidak ada yang menunggu Anda saat ini.'}</p>
      </div>
      <ol className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {steps.map((s, i) => (
          <li key={s.key} className="pp-rise min-w-[170px] flex-1" style={{ animationDelay: `${i * 55}ms` }}>
            <button type="button" onClick={() => onPick?.(s, cases.find(s.match) ?? null)} className={`h-full w-full cursor-pointer rounded-2xl border p-3 text-left transition-colors hover:border-white/30 ${i === next ? 'border-[#FFD60A] bg-[#FFD60A]/10' : 'border-white/8 bg-white/[0.03]'}`}>
            <div className="flex items-center justify-between">
              <span className="grid h-6 w-6 place-items-center rounded-full text-[11px] font-extrabold text-[#0B0D10]" style={{ background: s.color }}>{i + 1}</span>
              <span className="tabular text-xl font-extrabold">{counts[i]}</span>
            </div>
            <p className="mt-2 text-[13px] font-extrabold leading-tight">{s.title}</p>
            <p className="mt-1 line-clamp-3 text-[11px] leading-snug text-[#A1A1AA]" title={s.what}>{s.what}</p>
            <p className="mt-1.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: s.color }}>{s.who === 'Anda' ? 'Tugas Anda' : `Oleh ${s.who}`}{counts[i] > 0 ? ' · lihat →' : ''}</p>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
};

/** Network overview: every case where it is, coloured by its step; tap for what is needed. */
export const CaseMap: React.FC<{ steps: GuideStep[]; cases: ReportCase[] }> = ({ steps, cases }) => {
  const el = useRef<HTMLDivElement | null>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  useEffect(() => {
    if (!el.current || map.current) return;
    const style = basemapCandidates('DARK', import.meta.env.VITE_MAPTILER_KEY)[0]?.style;
    map.current = new maplibregl.Map({ container: el.current, style: style as maplibregl.StyleSpecification | string, center: [106.85, -6.25], zoom: 9, attributionControl: { compact: true } });
    map.current.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    markers.current.forEach((k) => k.remove());
    markers.current = [];
    const bounds = new maplibregl.LngLatBounds();
    for (const c of cases) {
      const step = steps.find((s) => s.match(c));
      if (!step) continue;
      const [lat, lng] = c.report.coordinates;
      const dot = document.createElement('div');
      dot.style.cssText = `width:18px;height:18px;border-radius:50%;background:${step.color};border:3px solid #0B0D10;box-shadow:0 0 0 2px ${step.color}66;cursor:pointer`;
      const html = `<div style="font:12px system-ui;color:#0B0D10;max-width:220px"><b>${c.report.damageTypeLabel}</b><br>${c.report.segmentName}<br><span style="color:#555">Langkah: ${step.title}</span></div>`;
      markers.current.push(new maplibregl.Marker({ element: dot }).setLngLat([lng, lat]).setPopup(new maplibregl.Popup({ offset: 12 }).setHTML(html)).addTo(m));
      bounds.extend([lng, lat]);
    }
    if (!bounds.isEmpty()) m.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 0 });
  }, [cases, steps]);
  return (
    <section className="mx-4 mt-4 overflow-hidden rounded-[28px] border border-white/8 bg-[#15181D] text-white" aria-label="Peta kasus">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
        <p className="text-sm font-extrabold">Peta kasus · {cases.length} laporan</p>
        <div className="flex flex-wrap gap-2 text-[10px]">
          {steps.map((s) => (
            <span key={s.key} className="flex items-center gap-1 text-[#A1A1AA]"><span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />{s.title}</span>
          ))}
        </div>
      </div>
      <div ref={el} className="mt-2 h-[340px] w-full" />
    </section>
  );
};
