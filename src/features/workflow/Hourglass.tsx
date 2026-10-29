/**
 * SPEC M3.1-M3.3 for citizens: how long a report has waited, why (if the agency said so),
 * the public "> 14 hari" label, and from day 30 a complaint draft to send oneself.
 */
import React from 'react';
import { complaintDraft, escalationOf, PENDING_LABEL, reached, type PendingCode } from '../../domain/workflow/escalation';
import type { WorkflowState } from '../../domain/workflow/model';
import { WORKFLOW_STATE_LABEL } from './workflowLabels';

interface CaseLike {
  id: string;
  state: WorkflowState;
  createdAt: string;
  report: { damageTypeLabel: string; segmentName: string; coordinates: [number, number] };
  authority?: { name: string } | null;
  pending?: { code: string; until: string; note: string } | null;
}

const fmt = (iso: string) => new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

function download(name: string, blob: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function savePdf(name: string, text: string) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  doc.setFontSize(11);
  doc.text(doc.splitTextToSize(text, 180), 15, 20);
  doc.save(name);
}

export const Hourglass: React.FC<{ c: CaseLike; allowComplaint?: boolean }> = ({ c, allowComplaint = false }) => {
  const e = escalationOf({ state: c.state, createdAt: c.createdAt, pending: c.pending ? { ...c.pending, code: c.pending.code as PendingCode, by: '', at: '' } : null });
  if (!e.open) return null;
  const draft = () =>
    complaintDraft({
      caseId: c.id,
      damage: c.report.damageTypeLabel,
      location: c.report.segmentName,
      coordinates: c.report.coordinates,
      createdAt: c.createdAt,
      agency: c.authority?.name ?? null,
      waitingDays: e.waitingDays,
      statusLabel: WORKFLOW_STATE_LABEL[c.state] ?? c.state,
      publicUrl: typeof window !== 'undefined' ? window.location.origin : null
    });
  return (
    <div className="mt-2 space-y-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="tabular rounded-full bg-[#FFFFFF]/8 px-2.5 py-1 font-bold text-[#FFFFFF]">⏳ Menunggu {e.waitingDays} hari</span>
        {reached(e, 'PUBLIK') && <span className="rounded-full bg-[#FF4D5E]/15 px-2.5 py-1 font-bold text-[#FF6B6B]">Belum ditangani &gt; 14 hari</span>}
      </div>
      {c.pending && (
        <p className="rounded-xl bg-[#4C8DFF]/10 px-3 py-2 text-[#BFD4FF]">
          <b>{PENDING_LABEL[c.pending.code as PendingCode] ?? c.pending.code}</b> · perkiraan {fmt(c.pending.until)}
          {c.pending.note ? ` — ${c.pending.note}` : ''}
        </p>
      )}
      {allowComplaint && reached(e, 'PENGADUAN') && (
        <div className="rounded-xl border border-[#FFD60A]/30 p-3">
          <p className="font-bold text-[#FFD60A]">Sudah {e.waitingDays} hari. Anda dapat menyampaikan pengaduan resmi.</p>
          <p className="mt-0.5 text-[#FFFFFF]/55">Draf disusun dari data laporan dan tidak dikirim otomatis. Kirim sendiri lewat SP4N-LAPOR! (lapor.go.id).</p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => download(`pengaduan-${c.id}.txt`, new Blob([draft()], { type: 'text/plain;charset=utf-8' }))} className="min-h-10 flex-1 cursor-pointer rounded-xl bg-[#FFFFFF]/10 font-bold">Unduh teks</button>
            <button type="button" onClick={() => void savePdf(`pengaduan-${c.id}.pdf`, draft())} className="min-h-10 flex-1 cursor-pointer rounded-xl bg-[#FFD60A] font-bold text-[#0B0D10]">Unduh PDF</button>
          </div>
        </div>
      )}
    </div>
  );
};
