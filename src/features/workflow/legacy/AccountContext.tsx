import React from 'react';
import type { ReportCase } from '../../../domain/workflow/model';
import type { GatewayMode } from '../../../services/api/workflowClient';
import { canonicalStatusOf, CanonicalStatusKey } from '../../../domain/workflow/canonicalStatus';
import { isOverdue } from '../queues';

export type BoardTab = CanonicalStatusKey | 'ALL';

export interface AccountInfo {
  name: string;
  title: string;
  agency: string;
  email: string;
  avatarUrl: string;
}

interface Tile {
  label: string;
  value: number | string;
  hint: string;
  tab?: BoardTab;
  tone?: 'warn' | 'good' | 'info' | 'danger' | 'neutral';
}

const TONE: Record<NonNullable<Tile['tone']>, string> = {
  warn: 'text-amber-400',
  good: 'text-emerald-400',
  info: 'text-sky-400',
  danger: 'text-rose-400',
  neutral: 'text-slate-200'
};

function opsTiles(cases: ReportCase[]): Tile[] {
  const n = (key: CanonicalStatusKey) => cases.filter((c) => canonicalStatusOf(c) === key).length;
  const realCount = cases.filter((c) => c.dataStatus !== 'SYNTHETIC').length;

  return [
    {
      label: 'Menunggu Peninjauan',
      value: n('MENUNGGU_PENINJAUAN'),
      hint: `${cases.filter((c) => canonicalStatusOf(c) === 'MENUNGGU_PENINJAUAN' && c.dataStatus !== 'SYNTHETIC').length} laporan warga`,
      tab: 'MENUNGGU_PENINJAUAN',
      tone: 'warn'
    },
    {
      label: 'Belum Ditugaskan',
      value: n('BELUM_DITUGASKAN'),
      hint: 'Valid, siap terbit SPK',
      tab: 'BELUM_DITUGASKAN',
      tone: 'neutral'
    },
    {
      label: 'Menunggu F.E',
      value: n('MENUNGGU_FE'),
      hint: `${cases.filter((c) => canonicalStatusOf(c) === 'MENUNGGU_FE' && isOverdue(c)).length} lewat batas waktu`,
      tab: 'MENUNGGU_FE',
      tone: 'info'
    },
    {
      label: 'Sedang Dikerjakan',
      value: n('SEDANG_DIKERJAKAN'),
      hint: 'Tugas aktif di lapangan',
      tab: 'SEDANG_DIKERJAKAN',
      tone: 'info'
    },
    {
      label: 'Menunggu Verifikasi',
      value: n('MENUNGGU_VERIFIKASI'),
      hint: 'Bukti perbaikan dari F.E',
      tab: 'MENUNGGU_VERIFIKASI',
      tone: 'warn'
    },
    {
      label: 'Perlu Revisi',
      value: n('PERLU_REVISI'),
      hint: 'Pekerjaan diulang F.E',
      tab: 'PERLU_REVISI',
      tone: 'danger'
    },
    {
      label: 'Selesai',
      value: n('SELESAI'),
      hint: `${realCount} nyata · ${cases.length - realCount} contoh`,
      tab: 'SELESAI',
      tone: 'good'
    }
  ];
}

function fieldTiles(cases: ReportCase[]): Tile[] {
  const n = (key: CanonicalStatusKey) => cases.filter((c) => canonicalStatusOf(c) === key).length;
  const openTasks = cases.filter((c) => c.assignment && c.state === 'FIELD_INSPECTION_REQUESTED').sort((a, b) => Date.parse(a.assignment!.dueAt) - Date.parse(b.assignment!.dueAt));
  const nextDue = openTasks[0]?.assignment?.dueAt;

  return [
    {
      label: 'Menunggu F.E',
      value: n('MENUNGGU_FE'),
      hint: 'SPK baru belum dimulai',
      tab: 'MENUNGGU_FE',
      tone: 'warn'
    },
    {
      label: 'Sedang Dikerjakan',
      value: n('SEDANG_DIKERJAKAN'),
      hint: 'Dalam pelaksanaan Anda',
      tab: 'SEDANG_DIKERJAKAN',
      tone: 'info'
    },
    {
      label: 'Menunggu Verifikasi',
      value: n('MENUNGGU_VERIFIKASI'),
      hint: 'Bukti terkirim ke O.M',
      tab: 'MENUNGGU_VERIFIKASI',
      tone: 'neutral'
    },
    {
      label: 'Perlu Revisi',
      value: n('PERLU_REVISI'),
      hint: 'Diminta perbaikan ulang O.M',
      tab: 'PERLU_REVISI',
      tone: 'danger'
    },
    {
      label: 'Selesai',
      value: n('SELESAI'),
      hint: 'Disetujui & ditutup',
      tab: 'SELESAI',
      tone: 'good'
    },
    {
      label: 'Batas Terdekat',
      value: nextDue ? new Date(nextDue).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) : '—',
      hint: `${cases.filter((c) => isOverdue(c)).length} lewat batas waktu`,
      tab: 'MENUNGGU_FE',
      tone: cases.some((c) => isOverdue(c)) ? 'danger' : 'neutral'
    }
  ];
}

export const AccountContext: React.FC<{
  role: 'OPS' | 'FE';
  account: AccountInfo | null;
  cases: ReportCase[];
  mode: GatewayMode;
  syncedAt: string | null;
  onTab: (tab: BoardTab) => void;
}> = ({ role, account, cases, mode, syncedAt, onTab }) => {
  const tiles = role === 'OPS' ? opsTiles(cases) : fieldTiles(cases);
  return (
    <section className="grid grid-cols-1 gap-4 rounded-xl border border-[#202B3B] bg-[#080E1B] p-4 sm:p-5 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] shadow-sm" aria-label="Konteks akun">
      <div className="flex items-start gap-3">
        {account?.avatarUrl && <img src={account.avatarUrl} alt="" className="h-12 w-12 shrink-0 rounded-full border border-[#202B3B] object-cover" />}
        <div className="min-w-0">
          <span className="rounded-md border border-[#FFD60A]/40 bg-[#FFD60A]/10 px-2 py-0.5 font-mono text-[10px] font-bold text-[#FFD60A]">
            {role === 'OPS' ? 'OPERATIONS MANAGER · M.O' : 'FIELD ENGINEER · F.E'}
          </span>
          <p className="mt-1.5 truncate font-bold text-slate-100">{account?.name ?? '—'}</p>
          <p className="truncate text-xs text-slate-400">{account?.title}</p>
          <p className="truncate text-xs text-slate-400">{account?.agency}</p>
          <p className="mt-1.5 text-[11px] text-slate-500">
            {mode === 'SERVER' ? 'Data server bersama · dimuat ulang tiap 15 detik' : 'DEMO OFFLINE di browser ini'}
            {syncedAt && <> · terakhir {new Date(syncedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</>}
          </p>
        </div>
      </div>
      <div className={`grid gap-2 ${role === 'OPS' ? 'grid-cols-2 sm:grid-cols-4 xl:grid-cols-7' : 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-6'}`}>
        {tiles.map((t) => (
          <button
            key={t.label}
            type="button"
            onClick={() => t.tab && onTab(t.tab)}
            className="rounded-xl border border-[#202B3B] bg-[#0E1726] hover:bg-[#131F33] p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFD60A]/60 cursor-pointer"
          >
            <span className="block text-[11px] font-semibold text-slate-400 truncate">{t.label}</span>
            <span className={`mt-1 block text-2xl font-bold tabular-nums ${TONE[t.tone ?? 'neutral']}`}>{t.value}</span>
            <span className="mt-0.5 block text-[11px] leading-snug text-slate-500 truncate">{t.hint}</span>
          </button>
        ))}
      </div>
    </section>
  );
};
