/**
 * SPEC M4.4 on the public page: agency, how long it waits, the public reason for waiting,
 * how many people guard it, unique visits, and "Saya juga melihat ini".
 */
import React, { useEffect, useState } from 'react';
import { apiUrl } from '../../services/api/client';
import { PENDING_LABEL, type PendingCode } from '../../domain/workflow/escalation';

interface Facts { caseId: string; agency: string | null; pending: { code: string; until: string; note: string } | null; hazard: boolean; waitingDays: number; escalation: string; witnesses: number; visits: number }

export const PublicKawal: React.FC<{ code: string }> = ({ code }) => {
  const [f, setF] = useState<Facts | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    fetch(apiUrl(`/api/public/share/${encodeURIComponent(code)}`)).then((r) => r.json()).then((j) => j?.success && setF(j)).catch(() => undefined);
  }, [code]);
  if (!f) return null;
  const witness = async () => {
    const r = await fetch(apiUrl(`/api/workflow/reports/${encodeURIComponent(f.caseId)}/witness`), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const j = await r.json().catch(() => null);
    if (j?.success) { setF({ ...f, witnesses: j.count }); setMsg('Terima kasih, tercatat.'); } else setMsg(r.status === 401 ? 'Buka aplikasi PavementPINN dulu agar perangkat Anda tercatat.' : j?.error?.message ?? 'Gagal.');
  };
  return (
    <section className="rounded-2xl border border-[#1A2430] bg-[#0F1720] p-3 text-[13px]">
      <p>Instansi: <b>{f.agency ?? 'sedang ditentukan'}</b></p>
      {f.escalation !== 'NONE' || f.waitingDays > 0 ? <p className="mt-1">⏳ Menunggu {f.waitingDays} hari{f.waitingDays > 14 && !f.pending ? ' · Belum ditangani > 14 hari' : ''}</p> : null}
      {f.pending && <p className="mt-1 rounded-lg bg-[#4C8DFF]/10 p-2 text-[#BFD4FF]">{PENDING_LABEL[f.pending.code as PendingCode] ?? f.pending.code} · perkiraan {new Date(f.pending.until).toLocaleDateString('id-ID')} — {f.pending.note}</p>}
      {f.hazard && <p className="mt-1 text-[#FF8A5B]">Rambu peringatan sementara sudah dipasang.</p>}
      <p className="mt-1 text-[#9AA8BC]">{f.witnesses} orang juga melihat ini · dilihat {f.visits} orang lewat tautan</p>
      <button type="button" onClick={() => void witness()} className="mt-2 min-h-11 w-full cursor-pointer rounded-xl bg-[#FFD60A] font-bold text-[#0B0D10]">Saya juga melihat ini</button>
      {msg && <p className="mt-1 text-[12px] text-[#9AA8BC]">{msg}</p>}
    </section>
  );
};
