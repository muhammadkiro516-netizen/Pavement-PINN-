/**
 * SPEC M10: the evidence page reads only measurements/*.json via /api/public/measurements.
 * Every card shows its label, date, commit and host label; a missing file reads "belum diukur".
 */
import React, { useEffect, useState } from 'react';
import { apiUrl } from '../../services/api/client';

type M = Record<string, any>;
const LABEL_TONE: Record<string, string> = { TERUKUR: '#2BD67B', BELUM_DIUKUR: '#8E8E93', CONTOH: '#C7B3FF', ASUMSI: '#FFD60A' };

const Card: React.FC<{ title: string; m?: M; children?: React.ReactNode; empty?: string }> = ({ title, m, children, empty }) => (
  <div className="rounded-[24px] border border-[#FFFFFF]/8 bg-[#15181D] p-4 text-[#FFFFFF]">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="font-extrabold">{title}</p>
      {m && (
        <div className="flex gap-1">
          <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: `${LABEL_TONE[m.label ?? m.status] ?? '#8E8E93'}22`, color: LABEL_TONE[m.label ?? m.status] ?? '#8E8E93' }}>{m.label ?? m.status ?? '—'}</span>
          {m.hostLabel === 'HOST_NON_INTEL' && <span className="rounded-full bg-[#FF6B2C]/15 px-2 py-0.5 text-[10px] font-bold text-[#FF8A5B]">HOST_NON_INTEL</span>}
        </div>
      )}
    </div>
    {m ? <div className="mt-2 space-y-1 text-sm text-[#FFFFFF]/85">{children}</div> : <p className="mt-2 text-sm text-[#FFFFFF]/50">{empty ?? 'Belum diukur.'}</p>}
    {m?.measuredAt && <p className="mt-2 text-[10px] text-[#FFFFFF]/40">Diukur {new Date(m.measuredAt).toLocaleString('id-ID')}{m.commit ? ` · commit ${m.commit}` : ''}{m.cpu || m.device?.cpu ? ` · ${m.cpu ?? m.device.cpu}` : ''}</p>}
  </div>
);

const pct = (x: number | null | undefined, d = 1) => (x == null ? '–' : `${(x * 100).toFixed(d)}%`);

export const MeasuredEvidence: React.FC = () => {
  const [ms, setMs] = useState<Record<string, M> | null>(null);
  useEffect(() => {
    fetch(apiUrl('/api/public/measurements')).then((r) => r.json()).then((j) => j?.success && setMs(j.measurements)).catch(() => setMs({}));
  }, []);
  if (!ms) return <p className="text-sm text-[#FFFFFF]/50">Memuat bukti…</p>;
  const bench = Object.entries(ms).filter(([k]) => k.startsWith('bench_'));
  const p2 = ms.pinn2, f1 = ms.pinn1_forward, a1 = ms.pinn1_ablation, i1 = ms.pinn1_inverse, slm = ms.slm, rec = ms.recurrence, fa = ms.field_accuracy, pilot = ms.pilot, sus = ms.sus, cv = ms.cv_local, clip = ms.clip_scene;
  return (
    <div className="space-y-3">
      <Card title="PINN-2: surrogate fisika vs PyMastic" m={p2}>
        {p2 && <>
          <p>Error rata-rata εt <b>{p2.et.mape}%</b> (p95 {p2.et.p95}%), εv <b>{p2.ev.mape}%</b> (p95 {p2.ev.p95}%) pada {p2.samples} struktur acak.</p>
          <p>Kecepatan: {p2.speed.surrogatePerSampleUs} µs/struktur vs PyMastic {p2.speed.pymasticPerSampleMs} ms (≈{Math.round((p2.speed.pymasticPerSampleMs * 1000) / p2.speed.surrogatePerSampleUs)}× lebih cepat). Uji kesebangunan: {p2.similarityCheckPct}%.</p>
          <p className="text-xs text-[#FFFFFF]/55">OpenVINO {p2.device?.openvino} · {p2.device?.precision} · {p2.device?.device}</p>
        </>}
      </Card>
      <Card title="PINN-1: jaringan fisika medan regangan (riset)" m={f1} empty="Belum dilatih.">
        {f1 && <>
          <p>Error L2 relatif vs PyMastic: w <b>{pct(f1.relL2.w)}</b>, εzz <b>{pct(f1.relL2.eps_zz)}</b>, εrr {pct(f1.relL2.eps_rr)}.</p>
          {a1 && <p>Tanpa physics loss (ablasi): w {pct(a1.relL2.w)}, εzz {pct(a1.relL2.eps_zz)}; residu PDE {a1.residual.mean.toFixed(2)} vs {f1.residual.mean.toFixed(2)}.</p>}
          {i1 && <p>Mode invers (cekungan {i1.label}): error modulus {i1.errorPct.map((e: number) => `${e}%`).join(' / ')}.</p>}
          <p className="text-xs text-[#FF8A5B]">Target &lt; 10% belum tercapai. PINN-1 belum dipakai untuk keputusan; keputusan memakai PINN-2 + PyMastic.</p>
        </>}
      </Card>
      <Card title="SLM lokal (Usulan Penanganan)" m={slm}>
        {slm && <>
          <p>{slm.model} di <b>{slm.device}</b>: {slm.tokensPerSecMean} token/detik, TTFT median {Math.round(slm.ttftMsMedian)} ms.</p>
          <p>{slm.cases} kasus: teks SLM dipakai {slm.slmUsedPct}%, jatuh ke templat {slm.templateFallbackPct}% (lolos pemeriksa pada percobaan pertama {slm.acceptedFirstTryPct}%).</p>
          <p className="text-xs text-[#FFFFFF]/55">Alasan ditolak: {Object.entries(slm.rejectReasons ?? {}).map(([k, v]) => `${k} ${v}`).join(', ') || '—'}</p>
        </>}
      </Card>
      {bench.length ? bench.map(([k, b]) => (
        <Card key={k} title={`Latensi per perangkat · ${b.host}`} m={{ ...b, label: 'TERUKUR' }}>
          <p className="text-xs text-[#FFFFFF]/60">OpenVINO {b.openvino} · perangkat: {Object.entries(b.devices).map(([d, n]) => `${d} (${n})`).join(', ')} · AMX: {b.amxTile === null ? 'tidak terdeteksi di OS ini' : b.amxTile ? 'ya' : 'tidak'}</p>
          {Object.entries(b.engines).map(([e, v]: [string, any]) => (
            <p key={e} className="text-xs">{e}: {v.p50 != null ? `p50 ${v.p50} ms · p95 ${v.p95} · p99 ${v.p99}` : `${v.tokens_per_s} token/detik di ${v.device}`}</p>
          ))}
          {b.notes?.length ? <p className="text-[11px] text-[#FFFFFF]/45">{b.notes.join(' · ')}</p> : null}
        </Card>
      )) : <Card title="Latensi per perangkat" empty="Jalankan bench/run_all.py." />}
      <Card title="Deteksi kerusakan pada foto lokal" m={cv}>
        {cv && (cv.status === 'BELUM_DIUKUR' ? <p>Belum diukur: {cv.labelledImages} dari minimal {cv.required} foto lokal berlabel.</p> : <p>mAP@0,5 <b>{cv.map50}</b> pada {cv.images} foto lokal.</p>)}
      </Card>
      <Card title="CLIP: jalan/bukan jalan, genangan, kondisi permukaan" m={clip}>
        {clip && (clip.status === 'BELUM_DIUKUR' ? <p>Belum diukur: butuh minimal {clip.requiredPerClass} foto per kelas.</p> : <p>Akurasi: jalan {pct(clip.accuracy.road)}, genangan {pct(clip.accuracy.water)}, permukaan {pct(clip.accuracy.surface)}.</p>)}
      </Card>
      <Card title="Akurasi lapangan (AI dibenarkan petugas)" m={fa}>
        {fa && <p>{fa.fieldReviewed ? `${fa.fieldAccuracyPct}% dari ${fa.fieldReviewed} inspeksi` : 'Belum ada inspeksi yang meninjau hasil AI.'}</p>}
      </Card>
      <Card title="Masalah lokal: perbaikan yang berulang" m={rec}>
        {rec && <p>{rec.recurrence3m.observed ? `${rec.recurrence3m.recurred} dari ${rec.recurrence3m.observed} perbaikan rusak lagi dalam 3 bulan.` : `Belum ada perbaikan yang teramati 3 bulan penuh (${rec.repairs} perbaikan tercatat).`}</p>}
      </Card>
      <Card title="Pilot" m={pilot}>
        {pilot && <p>{pilot.reports} laporan nyata dari {pilot.uniqueReportingAccounts} akun pelapor · {pilot.resolved} diperbaiki · {pilot.witnesses} “saya juga melihat”.</p>}
      </Card>
      <Card title="Kemudahan pakai (SUS)" m={sus}>
        {sus && <p>{sus.n ? `Skor rata-rata ${sus.mean} dari ${sus.n} responden.` : 'Belum ada responden.'}</p>}
      </Card>
    </div>
  );
};
