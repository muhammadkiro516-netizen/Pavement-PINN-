/**
 * /track/:code/ — citizen tracking page (mockup 7_pengguna). Shows only the public
 * projection: sanitised photo, type, severity and rounded size only after verification,
 * change summary, timeline, earlier versions, and "sudah diperbaiki?" after the after-photo.
 */
import React, { useEffect, useState } from 'react';
import { useWsT } from '../../features/workspace/i18n';
import { useWorkspaceDeps } from '../operations/useWorkspaceDeps';
import { StatusBadge } from '../../features/workspace/components/shared';
import type { PublicTrackView } from '../../domain/workspace/publicTrack';
import { useRouter } from '../../app/router';

const STATUS: Record<PublicTrackView['status'], [string, 'grey' | 'amber' | 'green']> = {
  received: ['Diterima', 'grey'],
  in_review: ['Sedang ditinjau petugas', 'amber'],
  verified: ['Diverifikasi petugas', 'green'],
  repaired: ['Sudah diperbaiki', 'green']
};
const SEV: Record<string, string> = { high: 'Tinggi', medium: 'Sedang', low: 'Rendah' };

export const TrackPage: React.FC<{ params: Record<string, string> }> = ({ params }) => {
  const t = useWsT();
  const { gateway } = useWorkspaceDeps();
  const { navigateTo } = useRouter();
  const [track, setTrack] = useState<PublicTrackView | null>(null);
  const [missing, setMissing] = useState(false);
  const [openVersion, setOpenVersion] = useState<number | null>(null);
  const code = (params.code ?? '').toUpperCase();

  useEffect(() => {
    gateway.track(code).then(setTrack, () => setMissing(true));
  }, [gateway, code]);

  if (missing) return <div className="p-6 text-[14px] text-[#C9D4E3]">{t('trackNotFound')}</div>;
  if (!track) return <div className="p-6 text-[13px] text-[#9AA8BC]">{t('loading')}</div>;
  const [label, tone] = STATUS[track.status];
  const fmt = (iso: string) => (iso ? new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) : '');
  return (
    <div className="h-full overflow-auto bg-[#0A0F14] text-[#E6EDF3]" data-testid="track-page">
      <div className="mx-auto max-w-md space-y-3 p-4">
        <div className="text-[13px] text-[#9AA8BC]">{t('trackTitle')}</div>
        <h1 className="text-[24px] font-bold">{track.trackingCode}</h1>
        <div className="flex gap-2">
          <StatusBadge tone={tone}>{label}</StatusBadge>
          {track.demo && <StatusBadge tone="violet">{t('demoBadge')}</StatusBadge>}
        </div>
        <section className="rounded-2xl border border-[#1A2430] bg-[#0F1720] p-3">
          {track.sanitizedPhotoUri ? (
            <>
              <img src={track.sanitizedPhotoUri} alt="" className="w-full rounded-xl" />
              <p className="mt-1 text-[11px] text-[#8B9BB0]">{track.photoKind === 'dataset' ? 'Foto referensi dataset publik RDD2022 (DATA CONTOH), bukan foto lokasi ini' : t('sanitizedNote')}</p>
            </>
          ) : (
            <p className="text-[12px] italic text-[#8B9BB0]">{t('noSanitizedPhoto')}</p>
          )}
          <dl className="mt-2 text-[14px]">
            {[
              ['Jenis', track.damageLabel],
              ['Tingkat keparahan', track.severity ? SEV[track.severity] : 'menunggu verifikasi petugas'],
              ['Ukuran', track.sizeCm ? `±${track.sizeCm.length ?? '?'} × ${track.sizeCm.width ?? '?'} cm, dalam ±${track.sizeCm.depth ?? '?'} cm` : 'belum divalidasi di lapangan'],
              ['Tindakan', track.action ?? 'belum ditetapkan']
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 border-b border-dashed border-[#273244] py-1.5">
                <dt className="text-[#C9D4E3]">{k}</dt>
                <dd className="text-right">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
        {track.changeSummary && (
          <section className="rounded-2xl border border-[#1A2430] bg-[#0F1720] p-3" data-testid="track-changes">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8B9BB0]">{t('changes')} · v{track.currentVersion}</h2>
            <p className="mt-1 text-[14px]">{track.changeSummary}</p>
          </section>
        )}
        <section className="rounded-2xl border border-[#1A2430] bg-[#0F1720] p-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8B9BB0]">{t('timeline')}</h2>
          <ul className="mt-1 space-y-1 text-[14px]">
            {track.timeline.map((e, i) => (
              <li key={i} className={e.done ? '' : 'text-[#8B9BB0]'}>{e.done ? `${fmt(e.at)} · ` : '○ '}{e.label}</li>
            ))}
          </ul>
        </section>
        {track.versions.length > 1 && (
          <section className="rounded-2xl border border-[#1A2430] bg-[#0F1720] p-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8B9BB0]">{t('previousVersions')}</h2>
            {track.versions.slice(0, -1).map((v) => (
              <button key={v.version} type="button" onClick={() => setOpenVersion(openVersion === v.version ? null : v.version)} className="mt-1 block w-full text-left text-[13px] text-[#8CC4FF]">
                v{v.version} · {fmt(v.approvedAt)}{openVersion === v.version && <span className="block text-[#C9D4E3]">{v.changeSummary}</span>}
              </button>
            ))}
          </section>
        )}
        {track.canConfirmRepair && (
          <section className="rounded-2xl border border-[#1A2430] bg-[#0F1720] p-3">
            <p className="text-[14px]">{t('confirmRepaired')}</p>
            <div className="mt-2 flex gap-2">
              {[true, false].map((yes) => (
                <button key={String(yes)} type="button" onClick={() => gateway.confirm(code, yes).then(setTrack)} className="rounded-lg border border-[#273244] px-3 py-1.5 text-[13px]">{yes ? t('yes') : t('notYet')}</button>
              ))}
            </div>
          </section>
        )}
        <div className="flex gap-2">
          <button type="button" onClick={() => navigateTo('map')} className="rounded-lg bg-[#1D6FD8] px-3 py-2 text-[13px] font-semibold">Lihat di peta</button>
        </div>
      </div>
    </div>
  );
};
