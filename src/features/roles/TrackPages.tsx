/** Linimasa publik sebuah kasus: tanpa login, tanpa data pelapor atau petugas. */
import { useState } from 'react';
import { v5 } from './api';
import { useV5 } from './context';
import { Capture, apiUrl } from './Capture';
import { Card, Chip, Confidence, ErrorNote, Ladder, Timeline, dateOnly, useAction, useLoad, type LadderView, type TimelineItem } from './ui';
import { V5_STATE_LABELS, type V5State } from '../../domain/v5/model';
import { ROAD_STATUS_WORD } from '../road-owner/RoadOwnerCard';

export interface PublicCase {
  publicCode: string;
  state: string;
  stateLabel: string;
  createdAt: string;
  mode: string;
  damageClass: string | null;
  sizeBand: string | null;
  captureTrust: string;
  isDemo: boolean;
  demoClockDays: number;
  routing: { segmentName: string | null; roadStatus: string; authorityName: string; officeName: string; confidence: 'HIGH' | 'MEDIUM' | 'LOW'; basis: string; note: string | null } | null;
  pending: { code: string; until: string; note: string } | null;
  hazard: boolean;
  underTechnicalReview: boolean;
  trace: { lengthM: number; quality: string } | null;
  warrantyFlag: boolean;
  photos: { id: string; kind: string; stage: string | null; demo: boolean }[];
  followUps: { milestone: string; dueAt: string | null; trigger: string; result: string | null; recordedAt: string | null; due: boolean; overdue: boolean }[];
  confirmations: { stillFixed: number; brokeAgain: number };
  ladder: LadderView;
  complaintDraftAvailable: boolean;
  timeline: TimelineItem[];
}

const MILESTONE: Record<string, string> = { M1: '1 bulan', M3: '3 bulan', M6: '6 bulan', HEAVY_RAIN: 'Setelah hujan lebat pertama', PRE_FHO: 'Sebelum masa pemeliharaan habis', EVERY_6M: 'Tiap 6 bulan' };
const FOLLOW_RESULT: Record<string, string> = { OK: 'Masih bagus', DEFECT: 'Ada kerusakan' };
const DELAY: Record<string, string> = { AWAITING_BUDGET: 'menunggu anggaran', AWAITING_SCHEDULE: 'menunggu jadwal', AWAITING_CONTRACT: 'menunggu pengadaan', RAINY_SEASON: 'perbaikan setelah musim hujan', TECHNICAL_REVIEW: 'perlu kajian teknis' };

export function FollowUps({ items }: { items: PublicCase['followUps'] }) {
  if (items.length === 0) return <p className="v5-muted">Pemeriksaan lanjutan dimulai setelah perbaikan diterima.</p>;
  return (
    <>
      <ul className="v5-followups" data-testid="v5-followups">
        {items.map((f) => (
          <li key={f.milestone} data-milestone={f.milestone}>
            <strong>{MILESTONE[f.milestone] ?? f.milestone}</strong>
            <span>{f.dueAt ? dateOnly(f.dueAt) : 'Saat hujan lebat tiba'}{f.overdue ? ' · terlambat' : f.due ? ' · waktunya sekarang' : ''}</span>
            <span className={f.result === 'OK' ? 'v5-good' : f.result ? 'v5-bad' : 'v5-muted'}>{f.result ? FOLLOW_RESULT[f.result] ?? f.result : 'Belum'}</span>
          </li>
        ))}
      </ul>
      <p className="v5-caption">Jadwal dari studi perbaikan jalan, belum dikonfirmasi instansi di Indonesia.</p>
    </>
  );
}

export function TrackPage({ code }: { code: string }) {
  const { demoServer, demoEnabled, role } = useV5();
  const { data, error, setData, reload } = useLoad(() => v5<PublicCase>(`/public/track/${encodeURIComponent(code)}`), [code]);
  const action = useAction();
  const [askPhoto, setAskPhoto] = useState(false);

  if (error) return <Card title="Tidak ditemukan"><p>{error.message}</p></Card>;
  if (!data) return <Card><p>Memuat…</p></Card>;
  const canConfirm = data.followUps.length > 0;

  const answer = (result: 'OK' | 'DAMAGED', evidenceIds: string[] = []) => action.run(async () => {
    setData(await v5<PublicCase>(`/public/track/${encodeURIComponent(code)}/confirm`, { result, evidenceIds }));
    setAskPhoto(false);
  });

  const forward = (days: number) => action.run(async () => setData(await v5<PublicCase>('/demo/fast-forward', { code, days })));

  return (
    <>
      <Card testId="v5-track-head">
        <p className="v5-eyebrow">Kode lacak</p>
        <p className="v5-code" data-testid="v5-track-code">{data.publicCode}</p>
        <p className="v5-state" data-testid="v5-state-label">{V5_STATE_LABELS[data.state as V5State]?.id ?? data.stateLabel}</p>
                {data.captureTrust === 'DEMO' && <p className="v5-caption">Kasus contoh dengan foto contoh.</p>}
        {data.routing && <p>Ditangani <strong>{data.routing.officeName}</strong> · {ROAD_STATUS_WORD[data.routing.roadStatus] ?? data.routing.roadStatus} <Confidence level={data.routing.confidence} /></p>}
        {data.routing?.confidence === 'LOW' && <p className="v5-warn">Koordinator akan memastikan instansinya.</p>}
        {data.trace && <p>Panjang kerusakan {Math.round(data.trace.lengthM)} m <Chip kind="MEASURED" /></p>}
        {data.pending && <p className="v5-warn">Alasan menunggu: {DELAY[data.pending.code] ?? data.pending.code}, sampai {dateOnly(data.pending.until)}.</p>}
        {data.hazard && <p className="v5-warn">Rambu peringatan sudah dipasang di lokasi.</p>}
        {data.underTechnicalReview && <p className="v5-warn" data-testid="v5-under-review">Sedang dalam pemeriksaan teknis.</p>}
        {data.warrantyFlag && <p className="v5-warn">Kerusakan muncul lagi dalam masa pemeliharaan. Instansi diminta memeriksa.</p>}
      </Card>

      {data.photos.length > 0 && (
        <Card title="Foto">
          <div className="v5-strip">
            {data.photos.map((p) => <img key={p.id} src={apiUrl(`/api/v5/evidence/${p.id}/image`)} alt={p.stage ? `Tahap ${p.stage}` : 'Kerusakan jalan'} loading="lazy" />)}
          </div>
          {data.photos.some((p) => p.demo) && <p className="v5-caption">Foto contoh. Wajah disamarkan.</p>}
        </Card>
      )}

      <Card title="Lama menunggu"><Ladder ladder={data.ladder} /></Card>

      {data.complaintDraftAvailable && (
        <Card title="Belum ditangani lebih dari 14 hari" testId="v5-complaint">
          <p>Anda bisa mengunduh draf pengaduan untuk SP4N-LAPOR! atau Ombudsman. Tidak ada yang terkirim otomatis.</p>
          <a className="v5-btn" href={apiUrl(`/api/v5/public/track/${encodeURIComponent(code)}/complaint-draft`)} data-testid="v5-complaint-link">Unduh draf</a>
        </Card>
      )}

      <Card title="Setelah diperbaiki">
        <FollowUps items={data.followUps} />
        {canConfirm && role === 'CITIZEN' && (
          <div className="v5-confirm" data-testid="v5-confirm">
            <p><strong>Bagaimana kondisinya sekarang?</strong> Masih bagus: {data.confirmations.stillFixed}, rusak lagi: {data.confirmations.brokeAgain}</p>
            {askPhoto ? (
              <Capture kind="FOLLOW_UP" purpose="FOLLOW_UP" title="Tunjukkan kerusakannya" hint="Foto membantu instansi memeriksa." sampleId="pothole-2" onDone={(e) => answer('DAMAGED', [e.id])} />
            ) : (
              <div className="v5-row">
                <button type="button" className="v5-btn" disabled={action.busy} onClick={() => answer('OK')} data-testid="v5-still-fixed">Masih bagus</button>
                <button type="button" className="v5-btn" disabled={action.busy} onClick={() => setAskPhoto(true)} data-testid="v5-broke-again">Rusak lagi</button>
                <button type="button" className="v5-link" disabled={action.busy} onClick={() => answer('DAMAGED')} data-testid="v5-broke-no-photo">Rusak lagi, tanpa foto</button>
              </div>
            )}
          </div>
        )}
        {canConfirm && role !== 'CITIZEN' && <p className="v5-caption">Warga menjawab "masih bagus" atau "rusak lagi" di sini.</p>}
      </Card>

      <Card title="Perjalanan laporan"><Timeline items={data.timeline} /></Card>

      {demoServer && demoEnabled && (
        <Card title="Alat uji: majukan waktu" testId="v5-fast-forward">
          <p>Khusus uji coba. Menambah hari pada jam kasus ini untuk melihat eskalasi. Catatan asli tetap memakai waktu sebenarnya.</p>
          {data.demoClockDays > 0 && <p data-testid="v5-clock-days">Kasus ini dimajukan {data.demoClockDays} hari.</p>}
          <div className="v5-row">
            {[2, 7, 14, 30].map((d) => <button key={d} type="button" className="v5-btn" disabled={action.busy} onClick={() => forward(d)} data-testid={`v5-ff-${d}`}>+{d} hari</button>)}
            <button type="button" className="v5-link" onClick={reload}>Muat ulang</button>
          </div>
        </Card>
      )}
      <ErrorNote error={action.error} />
    </>
  );
}

