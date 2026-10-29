/**
 * Pimpinan Instansi (SPEC §2, M3.2, M3.5): reports escalated past the internal targets, and the
 * agency report card. Read-only for the Pimpinan; decisions stay with the Koordinator.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Glyph } from '../../components/ui/brand';
import { Empty, Pill, SnapCard, SnapPage, Stat } from '../../components/ui/snap';
import { useAppState } from '../../app/providers/AppStateProvider';
import { useSession } from '../../app/providers/SessionProvider';
import { escalationOf, LADDER, PENDING_LABEL, reached, type PendingCode } from '../../domain/workflow/escalation';
import type { ReportCase } from '../../domain/workflow/model';
import { apiUrl } from '../../services/api/client';
import { StatusPill } from './CitizenPages';

export const EscalationsPage: React.FC = () => {
  const { workflow } = useAppState();
  const { currentAccount } = useSession();
  const agencyId = (currentAccount as { agencyId?: string | null }).agencyId ?? null;
  const rows = useMemo(() => {
    const cases = Object.values(workflow.views).filter((v) => v.audience === 'STAFF').map((v) => v.case as ReportCase);
    return cases
      .filter((c) => c.dataStatus !== 'SYNTHETIC' && (!agencyId || c.authority?.agencyId === agencyId))
      .map((c) => ({ c, e: escalationOf(c) }))
      .filter((x) => reached(x.e, 'PIMPINAN') || x.e.paused)
      .sort((a, b) => b.e.ladderDays - a.e.ladderDays);
  }, [workflow.views, agencyId]);
  const active = rows.filter((r) => !r.e.paused);
  const paused = rows.filter((r) => r.e.paused);
  return (
    <SnapPage title="Eskalasi" subtitle={`Laporan yang melewati target internal (H+${LADDER[1].days}). Target internal, bukan batas hukum.`}>
      <div className="grid grid-cols-3 gap-3">
        <Stat value={active.length} label="perlu perhatian" />
        <Stat value={active.filter((r) => reached(r.e, 'PUBLIK')).length} label="> 14 hari (tampil publik)" />
        <Stat value={paused.length} label="ditunda beralasan" />
      </div>
      {rows.length === 0 && <Empty icon={<Glyph name="inbox" size={26} />} title="Tidak ada eskalasi" text="Semua laporan instansi Anda masih dalam target tanggapan." />}
      {active.map(({ c, e }) => (
        <SnapCard key={c.id}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-extrabold">{c.report.damageTypeLabel} · {c.report.segmentName}</p>
              <p className="text-xs text-[#8E8E93]">{c.id} · {c.authority?.name ?? 'instansi belum ditentukan'}</p>
            </div>
            <StatusPill state={c.state} />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Pill tone={reached(e, 'PUBLIK') ? 'red' : 'orange'}>Menunggu {e.waitingDays} hari</Pill>
            {e.label && <Pill tone="grey">{e.label}</Pill>}
            {c.hazard ? <Pill tone="green">Rambu terpasang</Pill> : <Pill tone="red">Belum ada rambu</Pill>}
          </div>
        </SnapCard>
      ))}
      {paused.length > 0 && <h2 className="pt-2 text-lg font-extrabold">Ditunda dengan alasan</h2>}
      {paused.map(({ c, e }) => (
        <SnapCard key={c.id}>
          <p className="truncate font-extrabold">{c.report.damageTypeLabel} · {c.report.segmentName}</p>
          <p className="text-xs text-[#8E8E93]">
            {PENDING_LABEL[c.pending!.code as PendingCode]} · sampai {new Date(e.pausedUntil!).toLocaleDateString('id-ID')} — {c.pending!.note}
          </p>
        </SnapCard>
      ))}
    </SnapPage>
  );
};

interface Card {
  agency: string;
  reports: number;
  respondedIn48hPct: number | null;
  medianResolveDays: number | null;
  openOver14Pct: number | null;
  held3mPct: number | null;
  held6mPct: number | null;
  temporaryMadePermanentPct: number | null;
  publishable: boolean;
  label: string;
}

const v = (x: number | null, unit = '%') => (x === null ? '–' : unit === '%' ? `${x}%` : `${x.toFixed(1)} ${unit}`);

export const ReportCardPage: React.FC = () => {
  const [items, setItems] = useState<Card[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch(apiUrl('/api/agencies/report-card'), { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => (j?.success ? setItems(j.items) : setErr(j?.error?.message ?? 'gagal')))
      .catch((e) => setErr((e as Error).message));
  }, []);
  return (
    <SnapPage title="Rapor Instansi" subtitle="Metrik operasional dari riwayat laporan, bukan penilaian resmi. Publik hanya melihat instansi dengan ≥ 10 laporan.">
      {err && <p className="text-sm text-[#FF6B6B]">{err}</p>}
      {items?.length === 0 && <Empty icon={<Glyph name="chart" size={26} />} title="Belum ada data" text="Rapor muncul setelah ada laporan nyata." />}
      {items?.map((c) => (
        <SnapCard key={c.agency}>
          <div className="flex items-center justify-between gap-2">
            <p className="font-extrabold">{c.agency}</p>
            <Pill tone={c.publishable ? 'green' : 'grey'}>{c.publishable ? 'publik' : `internal (n=${c.reports})`}</Pill>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-center">
            <Stat value={v(c.respondedIn48hPct)} label="ditanggapi ≤ 2×24 jam" />
            <Stat value={v(c.medianResolveDays, 'hari')} label="median waktu perbaikan" />
            <Stat value={v(c.openOver14Pct)} label="laporan terbuka > 14 hari" />
            <Stat value={`${v(c.held3mPct)} / ${v(c.held6mPct)}`} label="perbaikan bertahan 3 / 6 bulan" />
            <Stat value={v(c.temporaryMadePermanentPct)} label="tambalan sementara dipermanenkan" />
            <Stat value={c.reports} label="laporan" />
          </div>
          <p className="mt-2 text-[11px] text-[#8E8E93]">{c.label}. “–” = belum ada data untuk dihitung.</p>
        </SnapCard>
      ))}
    </SnapPage>
  );
};
