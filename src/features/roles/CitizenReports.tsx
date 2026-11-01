/** Citizen tabs on the real case store: Kawal (my reports) and Notifikasi (what changed, what is due). */
import React, { useEffect, useState } from 'react';
import { Pavi } from '../../components/brand/Pavi';
import { Glyph } from '../../components/ui/brand';
import { Empty, Pill, SnapButton, SnapCard, SnapPage } from '../../components/ui/snap';
import { V5_STATE_LABELS, type V5State } from '../../domain/v5/model';
import { ensureDeviceSession, v5 } from './api';
import { apiUrl } from './Capture';
import type { PublicCase } from './TrackPages';

const STAGES = ['Diterima', 'Diperiksa', 'Dikerjakan', 'Selesai'] as const;

function stageOf(state: string): number {
  if (['MONITORING', 'CLOSED', 'REPAIRED_TEMPORARY'].includes(state)) return 3;
  if (['PLAN_APPROVED', 'WORK_ORDERED', 'IN_PROGRESS', 'WORK_SUBMITTED', 'WORK_VERIFIED'].includes(state)) return 2;
  if (['INSPECTION_ASSIGNED', 'INSPECTED', 'INSPECTION_VERIFIED', 'PLAN_PROPOSED'].includes(state)) return 1;
  return 0;
}

const Progress: React.FC<{ state: string }> = ({ state }) => {
  const at = stageOf(state);
  return (
    <div className="mt-3">
      <div className="flex gap-1.5">
        {STAGES.map((_, i) => (
          <span key={i} className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#FFFFFF]/10">
            <span className="block h-full rounded-full transition-[width] duration-700" style={{ width: i <= at ? '100%' : '0%', background: i === 3 && at === 3 ? '#2BD67B' : '#FFD60A', transitionDelay: `${i * 120}ms` }} />
          </span>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] font-bold text-[#FFFFFF]/45">
        {STAGES.map((st, i) => <span key={st} className={i === at ? 'text-[#FFFFFF]' : ''}>{st}</span>)}
      </div>
    </div>
  );
};

function useMyCases(): { cases: PublicCase[] | null; failed: boolean } {
  const [cases, setCases] = useState<PublicCase[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    ensureDeviceSession()
      .then(() => v5<PublicCase[]>('/me/cases'))
      .then((list) => { if (live) setCases([...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);
  return { cases, failed };
}

const label = (state: string) => V5_STATE_LABELS[state as V5State]?.id ?? state;

const BADGES = [
  { need: 1, name: 'Pelapor Pertama' },
  { need: 5, name: 'Penjaga Jalan' },
  { need: 20, name: 'Pahlawan Jalan' }
];

/** Optional (docs/v6 §1): counted from this phone's real reports. A name is asked only for the certificate, and stays on the phone. */
const Contribution: React.FC<{ count: number }> = ({ count }) => {
  const [name, setName] = useState('');
  const [show, setShow] = useState(false);
  const next = BADGES.find((b) => count < b.need);
  return (
    <SnapCard>
      <p className="font-extrabold">Kontribusi saya</p>
      <p className="mt-1 text-sm text-[#D1D1D6]" data-testid="v6-contribution-count">{count} laporan dari HP ini{next ? `. ${next.need - count} lagi menuju ${next.name}.` : '.'}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {BADGES.map((b) => <span key={b.name} data-testid={count >= b.need ? `v6-badge-${b.need}` : undefined} className={`rounded-full px-3 py-1 text-xs font-bold ${count >= b.need ? 'bg-[#FFD60A] text-[#0B0D10]' : 'bg-white/5 text-[#6E6E73]'}`}>{b.name}</span>)}
      </div>
      {count >= 1 && (
        <div className="mt-3">
          <label className="block text-xs font-bold text-[#A1A1AA]">Nama untuk sertifikat
            <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-[#2A2F37] bg-[#0B0D10] px-3 text-white" data-testid="v6-certificate-name" />
          </label>
          <button type="button" disabled={name.trim().length < 2} onClick={() => setShow(true)} className="mt-2 h-11 w-full cursor-pointer rounded-xl border border-[#2A2F37] text-sm font-bold disabled:opacity-50" data-testid="v6-certificate-make">Buat sertifikat</button>
          {show && (
            <div className="v6-badge mt-3" data-testid="v6-certificate">
              <strong>Terima kasih, {name}</strong>
              <span>telah mengirim {count} laporan jalan rusak lewat PavementPINN.</span>
              <button type="button" onClick={() => window.print()} className="underline">Cetak</button>
            </div>
          )}
        </div>
      )}
    </SnapCard>
  );
};

export const CitizenReportsPage: React.FC<{ onOpen: (code: string) => void; onReport: () => void }> = ({ onOpen, onReport }) => {
  const { cases, failed } = useMyCases();
  return (
    <SnapPage title="Kawal" subtitle="Laporan Anda, sampai mana penanganannya.">
      {failed && <SnapCard><p className="text-sm">Laporan tidak bisa dimuat. Coba lagi sebentar.</p></SnapCard>}
      {cases?.length === 0 && (
        <Empty icon={<Pavi size={44} mood="sleep" />} title="Belum ada laporan" text="Lihat jalan rusak? Potret saja. AI mengenali kerusakannya dan laporan dikirim ke instansi yang tepat." action={<SnapButton variant="accent" onClick={onReport}><Glyph name="camera" size={18} /> Lapor sekarang</SnapButton>} />
      )}
      {cases?.map((c) => {
        const photo = c.photos[0];
        return (
          <SnapCard key={c.publicCode} onClick={() => onOpen(c.publicCode)}>
            <div className="flex gap-3" data-testid="my-report" data-code={c.publicCode}>
              {photo && <img src={apiUrl(`/api/v5/evidence/${photo.id}/image`)} alt="" className="h-20 w-20 shrink-0 rounded-2xl object-cover" />}
              <div className="min-w-0 flex-1">
                <Pill tone={c.state === 'MONITORING' ? 'green' : 'blue'}>{label(c.state)}</Pill>
                <p className="mt-2 truncate text-[15px] font-extrabold">{c.publicCode}</p>
                <p className="truncate text-xs text-[#8E8E93]">{c.routing?.officeName ?? 'Instansi sedang ditentukan'}</p>
                {c.ladder.applies && <p className="tabular mt-1 text-xs font-bold text-[#FFD60A]">Menunggu {c.ladder.daysWaiting} hari</p>}
              </div>
            </div>
            <Progress state={c.state} />
          </SnapCard>
        );
      })}
      <Contribution count={cases?.length ?? 0} />
    </SnapPage>
  );
};

export const CitizenNotificationsPage: React.FC<{ onOpen: (code: string) => void }> = ({ onOpen }) => {
  const { cases } = useMyCases();
  const due = (cases ?? []).flatMap((c) => c.followUps.filter((f) => f.due && !f.result).map((f) => ({ c, f })));
  const news = (cases ?? []).map((c) => ({ c, last: c.timeline[c.timeline.length - 1] })).filter((x) => x.last);
  return (
    <SnapPage title="Notifikasi" subtitle="Kabar terbaru tentang laporan Anda.">
      {due.map(({ c, f }) => (
        <SnapCard key={`${c.publicCode}-${f.milestone}`} onClick={() => onOpen(c.publicCode)}>
          <p className="font-extrabold">Jalan ini sudah diperbaiki. Bagaimana kondisinya sekarang?</p>
          <p className="mt-0.5 text-sm text-[#D1D1D6]">{c.publicCode}: ketuk untuk menjawab "masih bagus" atau "rusak lagi".</p>
        </SnapCard>
      ))}
      {cases !== null && news.length === 0 && due.length === 0 && <Empty icon={<Glyph name="bell" size={26} />} title="Belum ada kabar" text="Saat petugas memeriksa atau memperbaiki laporan Anda, kabarnya muncul di sini." />}
      {news.map(({ c }) => (
        <SnapCard key={c.publicCode} onClick={() => onOpen(c.publicCode)}>
          <p className="font-extrabold">{label(c.state)}</p>
          <p className="mt-0.5 text-sm text-[#D1D1D6]">{c.routing?.officeName ?? 'Instansi sedang ditentukan'}</p>
          <p className="mt-1 text-xs text-[#6E6E73]">{c.publicCode}</p>
        </SnapCard>
      ))}
    </SnapPage>
  );
};
