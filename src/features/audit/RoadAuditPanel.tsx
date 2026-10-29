/**
 * SPEC M5.1 + M6 on a road: PINN-2 diagnosis with the Koordinator's agree/override, audit flags
 * with mandatory responses, project data, and the fair-cost calculator. All numbers come from the
 * server and carry their labels; nothing is filled in by the browser.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { apiUrl } from '../../services/api/client';

type Role = 'FIELD_ENGINEER' | 'OPERATIONS_MANAGER' | 'POLICY_MAKER' | string;

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(apiUrl(path), { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.success) throw new Error(j?.error?.message ?? `HTTP ${r.status}`);
  return j as T;
}

const box = 'rounded-[24px] border border-[#FFFFFF]/8 bg-[#15181D] p-4 text-[#FFFFFF]';
const input = 'w-full rounded-xl border border-[#FFFFFF]/10 bg-[#0B0D10] px-3 py-2 text-sm text-[#FFFFFF]';
const btn = 'min-h-10 cursor-pointer rounded-xl px-3 text-sm font-extrabold disabled:opacity-40';
const Tag: React.FC<{ children: React.ReactNode; tone?: string }> = ({ children, tone = '#8E8E93' }) => (
  <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: `${tone}22`, color: tone }}>{children}</span>
);

interface Diagnosis {
  verdict: 'RED' | 'YELLOW' | 'GREEN';
  title: string;
  confidence: string;
  dominant_factor: string;
  remaining_life_years: { p10: number; p50: number; p90: number };
  reasons: string[];
  observations_used: string[];
  assumptions: string[];
  prior: { source: string; road_class: string };
  solver: { dry: { surrogate: number; pymastic: number; dropped_out_of_domain?: number; device?: string; openvino?: string } };
  elapsed_ms: number;
}
const VERDICT = { RED: { dot: '🔴', tone: '#FF4D5E' }, YELLOW: { dot: '🟡', tone: '#FFD60A' }, GREEN: { dot: '🟢', tone: '#2BD67B' } } as const;

const DiagnosisCard: React.FC<{ segmentId: string; role: Role }> = ({ segmentId, role }) => {
  const [form, setForm] = useState({ esalYear: '', wetMonths: '5', odolShare: '' });
  const [d, setD] = useState<Diagnosis | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [decision, setDecision] = useState<{ kind: 'SETUJU' | 'TIMPA'; override: string; reason: string } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const run = async () => {
    setBusy(true); setErr(null); setSaved(null);
    try {
      const j = await call<{ result: Diagnosis }>('POST', '/api/engine/diagnose', { segmentId, esalYear: Number(form.esalYear), wetMonths: Number(form.wetMonths), odolShare: form.odolShare === '' ? null : Number(form.odolShare) / 100 });
      setD(j.result);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const decide = async () => {
    if (!d || !decision) return;
    try {
      await call('POST', `/api/roads/${encodeURIComponent(segmentId)}/diagnosis-decision`, { decision: decision.kind, modelVerdict: d.verdict, overrideVerdict: decision.kind === 'TIMPA' ? decision.override : null, reason: decision.reason, remainingLife: d.remaining_life_years });
      setSaved('Keputusan tersimpan untuk kalibrasi model.'); setDecision(null);
    } catch (e) { setErr((e as Error).message); }
  };
  const v = d ? VERDICT[d.verdict] : null;
  return (
    <div className={box}>
      <div className="flex items-center justify-between"><p className="font-extrabold">Diagnosis PINN-2</p><Tag tone="#4C8DFF">AI_PERKIRAAN</Tag></div>
      <p className="mt-1 text-xs text-[#FFFFFF]/55">2.000 kemungkinan struktur dibobot oleh kondisi yang tercatat di ruas ini (retak buaya, umur perbaikan nyata, data proyek). Lalu lintas diisi manusia.</p>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <label>ESAL / tahun *<input className={input} inputMode="numeric" value={form.esalYear} onChange={(e) => setForm({ ...form, esalYear: e.target.value.replace(/\D/g, '') })} placeholder="mis. 150000" /></label>
        <label>Bulan basah<input className={input} type="number" min={0} max={12} value={form.wetMonths} onChange={(e) => setForm({ ...form, wetMonths: e.target.value })} /></label>
        <label>Truk ODOL (%)<input className={input} type="number" min={0} max={100} value={form.odolShare} onChange={(e) => setForm({ ...form, odolShare: e.target.value })} placeholder="opsional" /></label>
      </div>
      <button type="button" disabled={busy || !(Number(form.esalYear) > 0)} onClick={() => void run()} className={`${btn} mt-3 w-full bg-[#FFD60A] text-[#0B0D10]`}>{busy ? 'Menghitung…' : 'Jalankan diagnosis'}</button>
      {err && <p className="mt-2 text-sm text-[#FF6B6B]">{err}</p>}
      {d && v && (
        <div className="mt-3 space-y-2">
          <div className="rounded-2xl p-3" style={{ background: `${v.tone}14`, border: `1px solid ${v.tone}55` }}>
            <p className="text-lg font-extrabold" style={{ color: v.tone }}>{v.dot} {d.title}</p>
            <p className="text-xs text-[#FFFFFF]/70">Keyakinan {d.confidence} · faktor dominan: {d.dominant_factor}</p>
            <p className="tabular mt-1 text-sm">Sisa umur P10 / P50 / P90: <b>{d.remaining_life_years.p10} / {d.remaining_life_years.p50} / {d.remaining_life_years.p90} tahun</b></p>
          </div>
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-[#FFFFFF]/80">{d.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          {d.observations_used.length > 0 && <p className="text-[11px] text-[#FFFFFF]/55">Observasi dipakai: {d.observations_used.join('; ')}.</p>}
          <details className="text-[11px] text-[#FFFFFF]/55"><summary className="cursor-pointer">Asumsi & mesin</summary>
            <ul className="mt-1 list-disc pl-5">{d.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
            <p className="mt-1">Prior: {d.prior.source} ({d.prior.road_class}). Surrogate OpenVINO {d.solver.dry.openvino ?? '—'} ({d.solver.dry.device ?? '—'}): {d.solver.dry.surrogate} sampel; PyMastic: {d.solver.dry.pymastic}; di luar domain: {d.solver.dry.dropped_out_of_domain ?? 0}. {d.elapsed_ms} ms.</p>
          </details>
          {role === 'OPERATIONS_MANAGER' && !decision && (
            <div className="flex gap-2">
              <button type="button" className={`${btn} flex-1 bg-[#2BD67B] text-[#0B0D10]`} onClick={() => setDecision({ kind: 'SETUJU', override: d.verdict, reason: '' })}>Setuju</button>
              <button type="button" className={`${btn} flex-1 bg-[#FFFFFF]/10`} onClick={() => setDecision({ kind: 'TIMPA', override: d.verdict === 'RED' ? 'YELLOW' : 'RED', reason: '' })}>Timpa</button>
            </div>
          )}
          {decision && (
            <div className="space-y-2 rounded-2xl bg-[#FFFFFF]/5 p-3 text-xs">
              {decision.kind === 'TIMPA' && (
                <select className={input} value={decision.override} onChange={(e) => setDecision({ ...decision, override: e.target.value })}>
                  <option value="RED">🔴 Perlu lapis ulang</option><option value="YELLOW">🟡 Pantau</option><option value="GREEN">🟢 Tambal cukup</option>
                </select>
              )}
              <textarea className={input} rows={2} placeholder="Alasan (wajib, tercatat untuk kalibrasi)" value={decision.reason} onChange={(e) => setDecision({ ...decision, reason: e.target.value })} />
              <div className="flex gap-2"><button type="button" className={`${btn} flex-1 bg-[#FFFFFF]/10`} onClick={() => setDecision(null)}>Batal</button><button type="button" disabled={decision.reason.trim().length < 5} className={`${btn} flex-1 bg-[#FFD60A] text-[#0B0D10]`} onClick={() => void decide()}>Simpan</button></div>
            </div>
          )}
          {saved && <p className="text-xs text-[#2BD67B]">{saved}</p>}
        </div>
      )}
    </div>
  );
};

interface Flag { id: string; kind: string; caseId: string; title: string; detail: string; possibleCauses: string[]; recommendedTests: string[]; response: { response: string; reason: string; at: string; testResult?: string | null } | null }
const RESP_LABEL: Record<string, string> = { JELASKAN: 'Dijelaskan', JADWALKAN_UJI: 'Uji dijadwalkan', TOLAK: 'Ditolak beralasan' };

export const AuditFlagsPanel: React.FC<{ segmentId?: string; role: Role }> = ({ segmentId, role }) => {
  const [items, setItems] = useState<Flag[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<{ id: string; response: string; reason: string; testResult: string } | null>(null);
  const load = useCallback(() => {
    call<{ items: Flag[] }>('GET', `/api/audit/flags${segmentId ? `?segment=${encodeURIComponent(segmentId)}` : ''}`).then((j) => setItems(j.items)).catch((e) => setErr((e as Error).message));
  }, [segmentId]);
  useEffect(load, [load]);
  const send = async () => {
    if (!open) return;
    try { await call('POST', `/api/audit/flags/${encodeURIComponent(open.id)}/response`, { response: open.response, reason: open.reason, testResult: open.testResult || null }); setOpen(null); load(); } catch (e) { setErr((e as Error).message); }
  };
  if (role !== 'OPERATIONS_MANAGER' && role !== 'POLICY_MAKER') return null;
  return (
    <div className={box}>
      <div className="flex items-center justify-between"><p className="font-extrabold">Flag audit</p><Tag>internal</Tag></div>
      <p className="mt-1 text-xs text-[#FFFFFF]/55">Permintaan klarifikasi atau uji teknis, bukan tuduhan. Publik hanya melihat “Sedang dalam pemeriksaan teknis”.</p>
      {err && <p className="mt-2 text-sm text-[#FF6B6B]">{err}</p>}
      {items?.length === 0 && <p className="mt-2 text-sm text-[#FFFFFF]/55">Tidak ada flag. Flag muncul dari biaya, umur perbaikan, dan masa pemeliharaan yang tercatat.</p>}
      <div className="mt-2 space-y-2">
        {items?.map((f) => (
          <div key={f.id} className="rounded-2xl bg-[#FFFFFF]/5 p-3 text-xs">
            <div className="flex items-center justify-between gap-2"><p className="font-extrabold">{f.title}</p>{f.response ? <Tag tone="#2BD67B">{RESP_LABEL[f.response.response]}</Tag> : <Tag tone="#FFD60A">perlu ditanggapi</Tag>}</div>
            <p className="mt-1 text-[#FFFFFF]/80">{f.detail}</p>
            <p className="mt-1 text-[#FFFFFF]/55">Kemungkinan penyebab: {f.possibleCauses.join(' / ')}. Rekomendasi: {f.recommendedTests.join('; ')}.</p>
            <p className="text-[#FFFFFF]/40">{f.caseId}</p>
            {f.response && <p className="mt-1 text-[#BFD4FF]">“{f.response.reason}”{f.response.testResult ? ` · hasil uji: ${f.response.testResult}` : ''}</p>}
            {role === 'OPERATIONS_MANAGER' && open?.id !== f.id && <button type="button" className={`${btn} mt-2 bg-[#FFFFFF]/10`} onClick={() => setOpen({ id: f.id, response: 'JELASKAN', reason: '', testResult: '' })}>{f.response ? 'Perbarui tanggapan' : 'Tanggapi'}</button>}
            {open?.id === f.id && (
              <div className="mt-2 space-y-2">
                <select className={input} value={open.response} onChange={(e) => setOpen({ ...open, response: e.target.value })}>
                  <option value="JELASKAN">Jelaskan</option><option value="JADWALKAN_UJI">Jadwalkan uji (core / DCP / drainase)</option><option value="TOLAK">Tolak beralasan</option>
                </select>
                <textarea className={input} rows={2} placeholder="Alasan (wajib)" value={open.reason} onChange={(e) => setOpen({ ...open, reason: e.target.value })} />
                <input className={input} placeholder="Hasil uji core/DCP (opsional)" value={open.testResult} onChange={(e) => setOpen({ ...open, testResult: e.target.value })} />
                <div className="flex gap-2"><button type="button" className={`${btn} flex-1 bg-[#FFFFFF]/10`} onClick={() => setOpen(null)}>Batal</button><button type="button" disabled={open.reason.trim().length < 5} className={`${btn} flex-1 bg-[#FFD60A] text-[#0B0D10]`} onClick={() => void send()}>Kirim</button></div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

interface Project { id: string; name: string; year: number; mix: string | null; thicknessCm: number | null; areaM2: number | null; valueIdr: number | null; maintenanceMonths: number | null; source: string; verifiedBy: string | null; photoUrl: boolean }

const ProjectsCard: React.FC<{ segmentId: string; role: Role }> = ({ segmentId, role }) => {
  const [items, setItems] = useState<Project[]>([]);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({ name: '', year: String(new Date().getFullYear()), mix: 'AC-WC', thicknessCm: '', areaM2: '', valueIdr: '', maintenanceMonths: '', source: 'PAPAN_PROYEK', photoUrl: '', h1: '', h2: '', E1: '', E2: '', cbr: '' });
  const load = useCallback(() => { call<{ items: Project[] }>('GET', `/api/projects?segment=${encodeURIComponent(segmentId)}`).then((j) => setItems(j.items)).catch(() => undefined); }, [segmentId]);
  useEffect(load, [load]);
  const pick = (file?: File) => { if (!file) return; const r = new FileReader(); r.onload = () => setF((x) => ({ ...x, photoUrl: String(r.result) })); r.readAsDataURL(file); };
  const save = async () => {
    setErr(null);
    const layers = f.h1 && f.h2 && f.E1 && f.E2 && f.cbr ? { h1: Number(f.h1), h2: Number(f.h2), E1: Number(f.E1), E2: Number(f.E2), cbr: Number(f.cbr) } : null;
    try {
      await call('POST', '/api/projects', { segmentId, name: f.name, year: Number(f.year), mix: f.mix, thicknessCm: f.thicknessCm, areaM2: f.areaM2, valueIdr: f.valueIdr, maintenanceMonths: f.maintenanceMonths, source: f.source, photoUrl: f.photoUrl || null, layers });
      setOpen(false); load();
    } catch (e) { setErr((e as Error).message); }
  };
  const verify = async (id: string) => { try { await call('POST', `/api/projects/${encodeURIComponent(id)}/verify`); load(); } catch (e) { setErr((e as Error).message); } };
  return (
    <div className={box}>
      <div className="flex items-center justify-between"><p className="font-extrabold">Data proyek ruas</p><Tag>DARI_INPUT</Tag></div>
      <p className="mt-1 text-xs text-[#FFFFFF]/55">Dari papan proyek, SIRUP/LPSE atau Dinas. Data terverifikasi menjadi prior diagnosis PINN-2.</p>
      {items.map((p) => (
        <div key={p.id} className="mt-2 rounded-2xl bg-[#FFFFFF]/5 p-3 text-xs">
          <div className="flex items-center justify-between gap-2"><b>{p.name} ({p.year})</b>{p.verifiedBy ? <Tag tone="#2BD67B">terverifikasi</Tag> : <Tag tone="#FFD60A">belum diverifikasi</Tag>}</div>
          <p className="text-[#FFFFFF]/70">{p.mix ?? '—'} · {p.thicknessCm ?? '—'} cm · {p.areaM2 ?? '—'} m² · {p.valueIdr ? `Rp${p.valueIdr.toLocaleString('id-ID')}` : 'nilai —'} · pemeliharaan {p.maintenanceMonths ?? '—'} bln · sumber {p.source}{p.photoUrl ? ' · ada foto papan' : ''}</p>
          {role === 'OPERATIONS_MANAGER' && !p.verifiedBy && <button type="button" className={`${btn} mt-2 bg-[#2BD67B] text-[#0B0D10]`} onClick={() => void verify(p.id)}>Verifikasi</button>}
        </div>
      ))}
      {(role === 'FIELD_ENGINEER' || role === 'OPERATIONS_MANAGER') && !open && <button type="button" className={`${btn} mt-3 w-full bg-[#FFFFFF]/10`} onClick={() => setOpen(true)}>Tambah data proyek</button>}
      {open && (
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <label className="col-span-2">Nama kegiatan *<input className={input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label>Tahun *<input className={input} type="number" value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} /></label>
          <label>Campuran<input className={input} value={f.mix} onChange={(e) => setF({ ...f, mix: e.target.value })} /></label>
          <label>Tebal (cm)<input className={input} type="number" value={f.thicknessCm} onChange={(e) => setF({ ...f, thicknessCm: e.target.value })} /></label>
          <label>Luas (m²)<input className={input} type="number" value={f.areaM2} onChange={(e) => setF({ ...f, areaM2: e.target.value })} /></label>
          <label>Nilai (Rp)<input className={input} inputMode="numeric" value={f.valueIdr} onChange={(e) => setF({ ...f, valueIdr: e.target.value.replace(/\D/g, '') })} /></label>
          <label>Masa pemeliharaan (bln)<input className={input} type="number" value={f.maintenanceMonths} onChange={(e) => setF({ ...f, maintenanceMonths: e.target.value })} /></label>
          <label className="col-span-2">Sumber
            <select className={input} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}><option value="PAPAN_PROYEK">Papan proyek</option><option value="SIRUP_LPSE">SIRUP / LPSE</option><option value="DINAS">Dinas</option><option value="LAINNYA">Lainnya</option></select>
          </label>
          <label className="col-span-2">Foto papan proyek<input className={input} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(e) => pick(e.target.files?.[0])} /></label>
          <p className="col-span-2 pt-1 text-[#FFFFFF]/55">Struktur lapisan (opsional, dari dokumen/core): tebal aspal h1, tebal fondasi h2 (mm), modulus E1, E2 (MPa), CBR tanah dasar (%).</p>
          {(['h1', 'h2', 'E1', 'E2', 'cbr'] as const).map((k) => <label key={k}>{k}<input className={input} type="number" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>)}
          {err && <p className="col-span-2 text-[#FF6B6B]">{err}</p>}
          <button type="button" className={`${btn} bg-[#FFFFFF]/10`} onClick={() => setOpen(false)}>Batal</button>
          <button type="button" disabled={!f.name.trim()} className={`${btn} bg-[#FFD60A] text-[#0B0D10]`} onClick={() => void save()}>Simpan</button>
        </div>
      )}
    </div>
  );
};

interface Fair { status: string; reason: string | null; volumeM3: number; tonnage: number; fairCostIdr: number | null; breakdown: Array<{ item: string; amountIdr: number; label: string; source: string }>; diffPct: number | null; thresholdPct: number }

export const FairCostCalculator: React.FC = () => {
  const [f, setF] = useState({ materialId: 'AC-WC', thicknessCm: '4', areaM2: '', valueIdr: '' });
  const [r, setR] = useState<Fair | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => { setErr(null); try { setR((await call<{ result: Fair }>('POST', '/api/audit/fair-cost', f)).result); } catch (e) { setErr((e as Error).message); } };
  return (
    <div className={box}>
      <div className="flex items-center justify-between"><p className="font-extrabold">Kalkulator kewajaran</p><Tag tone="#FFD60A">harga ASUMSI</Tag></div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <label>Material<select className={input} value={f.materialId} onChange={(e) => setF({ ...f, materialId: e.target.value })}>{['AC-WC', 'AC-BC', 'AC-BASE', 'HRS-WC', 'HRS-BASE'].map((m) => <option key={m}>{m}</option>)}</select></label>
        <label>Tebal (cm)<input className={input} type="number" value={f.thicknessCm} onChange={(e) => setF({ ...f, thicknessCm: e.target.value })} /></label>
        <label>Luas (m²)<input className={input} type="number" value={f.areaM2} onChange={(e) => setF({ ...f, areaM2: e.target.value })} /></label>
        <label>Nilai SPK (Rp)<input className={input} inputMode="numeric" value={f.valueIdr} onChange={(e) => setF({ ...f, valueIdr: e.target.value.replace(/\D/g, '') })} placeholder="opsional" /></label>
      </div>
      <button type="button" disabled={!(Number(f.areaM2) > 0)} className={`${btn} mt-3 w-full bg-[#FFD60A] text-[#0B0D10]`} onClick={() => void run()}>Hitung</button>
      {err && <p className="mt-2 text-sm text-[#FF6B6B]">{err}</p>}
      {r && (
        <div className="mt-3 space-y-1 text-xs">
          <p>Volume {r.volumeM3} m³ · {r.tonnage} ton</p>
          {r.breakdown.map((b) => <p key={b.item} className="text-[#FFFFFF]/70">{b.item}: <b>Rp{b.amountIdr.toLocaleString('id-ID')}</b> <Tag>{b.label}</Tag></p>)}
          <p className="text-sm font-extrabold">Perkiraan biaya wajar: {r.fairCostIdr === null ? '–' : `Rp${r.fairCostIdr.toLocaleString('id-ID')}`}</p>
          {r.diffPct !== null && <p style={{ color: r.status === 'PERLU_KLARIFIKASI' ? '#FFD60A' : '#2BD67B' }}>Selisih nilai SPK: {r.diffPct > 0 ? '+' : ''}{r.diffPct}% (ambang ±{r.thresholdPct}%){r.reason ? ` — ${r.reason}` : ''}</p>}
          {r.reason && r.diffPct === null && <p className="text-[#FFFFFF]/55">{r.reason}</p>}
          <p className="text-[10px] text-[#FFFFFF]/40">Harga indikatif berlabel; ganti dengan HSPK/SSH daerah atau AHSP Permen PUPR 1/2022 sebelum dipakai resmi.</p>
        </div>
      )}
    </div>
  );
};

export const RoadAuditPanel: React.FC<{ segmentId: string; role: Role }> = ({ segmentId, role }) => {
  if (role !== 'FIELD_ENGINEER' && role !== 'OPERATIONS_MANAGER' && role !== 'POLICY_MAKER') return null;
  return (
    <div className="space-y-3">
      <DiagnosisCard segmentId={segmentId} role={role} />
      <AuditFlagsPanel segmentId={segmentId} role={role} />
      <ProjectsCard segmentId={segmentId} role={role} />
    </div>
  );
};
