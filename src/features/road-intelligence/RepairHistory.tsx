/**
 * SPEC M2.2: how long repairs on a road (or everywhere) really lasted, and M2.3: the
 * citizen's 1/3/6-month question. Everything is read from /api/roads/repairs, which computes
 * it from recorded events (TERUKUR); nothing is estimated here.
 */
import React, { useEffect, useState } from 'react';
import { apiUrl } from '../../services/api/client';
import { lastDeviceFix } from '../location/deviceLocation';

const METHOD: Record<string, string> = {
  TAMBAL_DINGIN: 'Tambal dingin',
  TAMBAL_PANAS: 'Tambal panas',
  PATCHING_DALAM: 'Patching dalam',
  OVERLAY: 'Overlay',
  REKONSTRUKSI: 'Rekonstruksi',
  TIDAK_DICATAT: 'Metode tidak dicatat'
};

interface Summary { windowMonths: number; recurred: number; observed: number; tooRecent: number; pct: number | null }
interface Life { caseId: string; method: string | null; category: string | null; repairedAt: string; failedAt: string | null; days: number; censored: boolean; inMaintenance?: boolean }
interface RepairsResponse {
  items: Life[];
  byMethod: Array<{ method: string; repairs: number; failed: number; medianFailDays: number | null; recurred3m: Summary }>;
  recurrence3m: Summary;
  recurrence6m: Summary;
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });

export function recurrenceLine(s: Summary): string {
  if (s.observed === 0) return `Belum ada perbaikan yang teramati ${s.windowMonths} bulan penuh${s.tooRecent ? ` (${s.tooRecent} masih terlalu baru)` : ''}.`;
  return `${s.recurred} dari ${s.observed} perbaikan rusak lagi dalam ${s.windowMonths} bulan (${s.pct}%).`;
}

export const RepairHistory: React.FC<{ segmentId?: string; title?: string }> = ({ segmentId, title = 'Riwayat perbaikan' }) => {
  const [d, setD] = useState<RepairsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const q = segmentId ? `?segment=${encodeURIComponent(segmentId)}` : '';
    fetch(apiUrl(`/api/roads/repairs${q}`), { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => (j?.success ? setD(j) : setErr(j?.error?.message ?? 'gagal dimuat')))
      .catch((e) => setErr((e as Error).message));
  }, [segmentId]);

  return (
    <div className="rounded-[24px] border border-[#FFFFFF]/8 bg-[#15181D] p-4 text-[#FFFFFF]">
      <div className="flex items-center justify-between gap-2">
        <p className="font-extrabold">{title}</p>
        <span className="rounded-full bg-[#2BD67B]/12 px-2 py-0.5 text-[10px] font-bold text-[#2BD67B]">TERUKUR</span>
      </div>
      {err && <p className="mt-2 text-sm text-[#FF6B6B]">Belum dapat dimuat: {err}</p>}
      {!d && !err && <p className="mt-2 text-sm text-[#FFFFFF]/50">Memuat…</p>}
      {d && d.items.length === 0 && <p className="mt-2 text-sm text-[#FFFFFF]/55">Belum ada perbaikan terverifikasi. Umur perbaikan dihitung setelah ada perbaikan yang selesai.</p>}
      {d && d.items.length > 0 && (
        <>
          <p className="mt-2 text-sm text-[#FFFFFF]/85">{recurrenceLine(d.recurrence3m)}</p>
          <p className="text-xs text-[#FFFFFF]/55">{recurrenceLine(d.recurrence6m)}</p>
          <div className="mt-3 space-y-1.5">
            {d.byMethod.map((m) => (
              <div key={m.method} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate">{METHOD[m.method] ?? m.method}</span>
                <span className="tabular text-[#FFFFFF]/60">{m.repairs} perbaikan · {m.failed} rusak lagi</span>
                <span className="tabular w-28 text-right font-bold">{m.medianFailDays === null ? '–' : `median ${Math.round(m.medianFailDays)} hari`}</span>
              </div>
            ))}
          </div>
          <ol className="mt-3 space-y-2 border-l border-[#FFFFFF]/10 pl-3">
            {d.items.slice(0, 12).map((l) => (
              <li key={l.caseId} className="text-xs">
                <span className="font-bold">{fmtDate(l.repairedAt)}</span> · {METHOD[l.method ?? 'TIDAK_DICATAT']}
                {l.category ? ` (${l.category.toLowerCase()})` : ''} ·{' '}
                {l.censored ? <span className="text-[#2BD67B]">masih baik {Math.round(l.days)} hari</span> : <span className="text-[#FF6B6B]">rusak lagi setelah {Math.round(l.days)} hari</span>}
                {l.inMaintenance && <span className="ml-1 rounded bg-[#FFD60A]/15 px-1.5 text-[10px] font-bold text-[#FFD60A]">masih dalam masa pemeliharaan — minta pelaksana memperbaiki</span>}
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[10px] text-[#FFFFFF]/40">Rusak lagi = laporan baru ≤ 10 m atau konfirmasi warga. Perbaikan yang belum teramati selama jendela penuh tidak dihitung.</p>
        </>
      )}
    </div>
  );
};

/** SPEC M2.3: "Bagaimana kondisi jalan yang sudah diperbaiki?" for the reporter and neighbours. */
export const RepairConfirmPrompts: React.FC = () => {
  const [items, setItems] = useState<Array<{ caseId: string; milestone: number }>>([]);
  const [done, setDone] = useState<Record<string, string>>({});
  const fix = lastDeviceFix(24 * 3600_000);
  const near = fix ? fix.coordinates : null;
  useEffect(() => {
    const q = near ? `?lat=${near[0]}&lng=${near[1]}` : '';
    fetch(apiUrl(`/api/me/confirmations${q}`), { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => j?.success && setItems(j.items))
      .catch(() => undefined);
  }, [near?.[0], near?.[1]]);
  const answer = async (caseId: string, milestone: number, result: 'OK' | 'BROKEN') => {
    const r = await fetch(apiUrl(`/api/workflow/reports/${encodeURIComponent(caseId)}/repair-confirmations`), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ milestone, result, near })
    });
    const j = await r.json().catch(() => null);
    setDone((x) => ({ ...x, [caseId]: j?.success ? 'Terima kasih, jawaban tercatat.' : j?.error?.message ?? 'Gagal mengirim.' }));
  };
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      {items.map((it) => (
        <div key={it.caseId} className="rounded-[24px] border border-[#FFD60A]/30 bg-[#FFD60A]/[0.06] p-4 text-[#FFFFFF]">
          <p className="font-extrabold">Jalan ini diperbaiki {it.milestone} bulan lalu. Bagaimana kondisinya sekarang?</p>
          <p className="text-xs text-[#FFFFFF]/55">{it.caseId} · jawaban Anda dipakai untuk menghitung umur perbaikan yang sebenarnya.</p>
          {done[it.caseId] ? (
            <p className="mt-2 text-sm text-[#2BD67B]">{done[it.caseId]}</p>
          ) : (
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => void answer(it.caseId, it.milestone, 'OK')} className="min-h-11 flex-1 cursor-pointer rounded-2xl bg-[#2BD67B] px-3 text-sm font-extrabold text-[#0B0D10]">Masih baik</button>
              <button type="button" onClick={() => void answer(it.caseId, it.milestone, 'BROKEN')} className="min-h-11 flex-1 cursor-pointer rounded-2xl bg-[#FF4D5E] px-3 text-sm font-extrabold text-[#0B0D10]">Berlubang lagi</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
