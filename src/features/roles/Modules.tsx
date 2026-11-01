/**
 * Workspace modules (docs/v6/V6_UPDATE_TWO_PORTALS.md §2.4-2.5, §3). One shared dashboard; what appears
 * follows the person's role. Plain words on the screen, technical words behind a toggle.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as maplibregl from 'maplibre-gl';
import { V5_STATE_LABELS, type V5State } from '../../domain/v5/model';
import { v5, v6 } from './api';
import { useV5 } from './context';
import { Card, ErrorNote, RolePavi, useAction, useLoad, when } from './ui';
import { CaseList, type StaffCase } from './StaffPages';

export type ModuleId = 'today' | 'inbox' | 'field' | 'work' | 'cost' | 'monitor' | 'report' | 'audit' | 'team' | 'settings';

/** The matrix of §2.4. */
export const MODULES_BY_ROLE: Record<string, ModuleId[]> = {
  OM: ['today', 'inbox', 'work', 'cost', 'monitor', 'report', 'audit', 'team', 'settings'],
  FE: ['today', 'inbox', 'field', 'work', 'cost', 'monitor', 'report'],
  AUDITOR: ['today', 'inbox', 'work', 'cost', 'monitor', 'report', 'audit', 'team', 'settings'],
  CONTRACTOR: ['today']
};

export const MODULE_LABEL: Record<ModuleId, string> = {
  today: 'Hari Ini', inbox: 'Inbox & Peta', field: 'Lapangan', work: 'Perintah Kerja', cost: 'Biaya & Material', monitor: 'Pantau', report: 'Rapor', audit: 'Audit', team: 'Tim & Kode', settings: 'Pengaturan'
};

export const MODULE_ICON: Record<ModuleId, string> = {
  today: 'M12 3v2m0 14v2m9-9h-2M5 12H3m15.4-6.4-1.4 1.4M7 17l-1.4 1.4m12.8 0L17 17M7 7 5.600 5.600M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  inbox: 'M9 20l-5-2V5l5 2m0 13l6-2m-6 2V7m6 11l5 2V7l-5-2m0 13V5m0 0L9 7',
  field: 'M4 8h3l2-3h6l2 3h3v11H4zM12 11a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  work: 'M9 4h6l1 2h3v14H5V6h3zM9 11h6M9 15h6',
  cost: 'M12 3v18M16.500 7.500A4 3.500 0 0 0 12 6c-2.500 0-4.500 1.300-4.500 3s2 2.700 4.500 3 4.500 1.300 4.500 3-2 3-4.500 3a4.500 3.500 0 0 1-4.500-1.500',
  monitor: 'M3 12h4l3-7 4 14 3-7h4',
  report: 'M5 21V10m7 11V4m7 17v-7',
  audit: 'M12 3l8 3v6c0 5-3.500 8-8 9-4.500-1-8-4-8-9V6zM9 12l2 2 4-4',
  team: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.500 10a3.500 3.500 0 1 0 0-7 3.500 3.500 0 0 0 0 7zM21 19v-1a4 4 0 0 0-3-3.800M15 3.200a3.500 3.500 0 0 1 0 6.600',
  settings: 'M4 7h10M18 7h2M4 17h2M10 17h10M14 5v4M6 15v4'
};

const Stat = ({ label, value, tone, testId }: { label: string; value: ReactNode; tone?: string; testId?: string }) => (
  <div className="v6-stat" data-testid={testId}>
    <span className="v6-stat-num" style={tone ? { color: tone } : undefined}>{value}</span>
    <span className="v6-stat-label">{label}</span>
  </div>
);

interface Today {
  numbers: { newCases: number; late: number; inRepair: number; failedInWarranty: number };
  briefing: string[];
  briefingSource: string;
  rain: { heavyDays: number; openHoles: number; days: string[]; source: string } | null;
  holes: { id: string; publicCode: string; place: string }[];
}

/** Today: four big numbers, the briefing, and what this person should do now. */
export function TodayModule() {
  const { v6Role, role, go } = useV5();
  const { data, error } = useLoad(() => v6<Today>('/today'), []);
  return (
    <>
      {v6Role !== 'CONTRACTOR' && (
        <>
          <div className="v6-stats" data-testid="v6-today-numbers">
            <Stat label="Kasus baru" value={data?.numbers.newCases ?? '–'} tone="#FFD60A" testId="v6-num-new" />
            <Stat label="Lewat tenggat" value={data?.numbers.late ?? '–'} tone="#FF6B2C" testId="v6-num-late" />
            <Stat label="Sedang diperbaiki" value={data?.numbers.inRepair ?? '–'} tone="#22D3EE" testId="v6-num-repair" />
            <Stat label="Gagal dalam pemeliharaan" value={data?.numbers.failedInWarranty ?? '–'} tone="#FF6B6B" testId="v6-num-warranty" />
          </div>
          <Card title="Ringkasan hari ini" testId="v6-briefing">
            <div className="v6-briefing">
              <RolePavi role={role} mood="scan" size={56} />
              <div>
                {error && <p>{error.message}</p>}
                {(data?.briefing ?? ['Memuat…']).map((line) => <p key={line}>{line}</p>)}
                <p className="v5-caption">{data?.briefingSource}</p>
              </div>
            </div>
          </Card>
          {data && data.holes.length > 0 && (
            <Card title="Tambal sebelum hujan" testId="v6-rain">
              <p>Hujan lebat diperkirakan {data.rain?.days.join(', ')}. Lubang tergenang sulit terlihat pengendara.</p>
              <ul className="v5-list">{data.holes.map((h) => <li key={h.id}><button type="button" onClick={() => go(`/kerja/${h.id}`)}><strong>{h.publicCode}</strong><span>{h.place}</span></button></li>)}</ul>
              <p className="v5-caption">Sumber: {data.rain?.source}</p>
            </Card>
          )}
        </>
      )}
      <CaseList title={v6Role === 'CONTRACTOR' ? 'Perintah kerja Anda' : v6Role === 'AUDITOR' ? 'Temuan dan kasus' : 'Perlu tindakan kamu'} scope="ACTION" />
    </>
  );
}

const INBOX_COLORS: Record<string, string> = { POTHOLE: '#FF6B2C', SEVERE_BREAKUP: '#FF3B30', ALLIGATOR: '#FFD60A' };

function InboxMap({ cases }: { cases: StaffCase[] }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  useEffect(() => {
    if (!box.current || cases.length === 0 || map.current) return;
    map.current = new maplibregl.Map({
      container: box.current,
      style: { version: 8, sources: { osm: { type: 'raster', tiles: ['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap, © CARTO' } }, layers: [{ id: 'osm', type: 'raster', source: 'osm' }] },
      center: [cases[0].location.lonE6 / 1e6, cases[0].location.latE6 / 1e6],
      zoom: 12,
      attributionControl: { compact: true }
    });
    return () => { map.current?.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cases.length > 0]);
  useEffect(() => {
    if (!map.current) return;
    const pins = cases.map((c) => {
      const dot = document.createElement('div');
      dot.className = 'v6-pin';
      dot.style.background = INBOX_COLORS[c.damageClass ?? ''] ?? '#FFD60A';
      dot.title = c.publicCode;
      return new maplibregl.Marker({ element: dot }).setLngLat([c.location.lonE6 / 1e6, c.location.latE6 / 1e6]).addTo(map.current!);
    });
    return () => pins.forEach((p) => p.remove());
  }, [cases]);
  if (cases.length === 0) return null;
  return <div ref={box} className="v6-map" data-testid="v6-inbox-map" />;
}

export function InboxModule() {
  const { data } = useLoad(() => v5<StaffCase[]>('/cases'), []);
  return (
    <>
      <InboxMap cases={data ?? []} />
      <CaseList title="Inbox, urut prioritas" scope="INBOX" />
    </>
  );
}

export const FieldModule = () => <CaseList title="Tugasku di lapangan" scope="FIELD" />;
export const WorkModule = () => <CaseList title="Perintah kerja" scope="WORK" />;

interface MonitorRow { caseId: string; publicCode: string; place: string; milestone: string; dueAt: string | null; result: string | null; warranty: boolean }
const MILESTONE: Record<string, string> = { M1: '1 bulan', M3: '3 bulan', M6: '6 bulan', PRE_FHO: 'Akhir masa pemeliharaan', HEAVY_RAIN: 'Setelah hujan lebat pertama', EVERY_6M: 'Tiap 6 bulan' };
const RESULT: Record<string, string> = { OK: 'Masih bagus', GOOD: 'Masih bagus', DAMAGED: 'Rusak lagi', DEFECT: 'Ada cacat' };

export function MonitorModule() {
  const { go } = useV5();
  const { data, error } = useLoad(() => v6<MonitorRow[]>('/monitor'), []);
  return (
    <Card title="Jadwal pemeriksaan setelah perbaikan" testId="v6-monitor">
      {error && <p>{error.message}</p>}
      {data?.length === 0 && <div className="v5-empty"><RolePavi role="SUPERVISOR" mood="sleep" /><p>Belum ada perbaikan yang dipantau.</p></div>}
      <ul className="v5-list">
        {(data ?? []).map((r) => (
          <li key={`${r.caseId}-${r.milestone}`}><button type="button" onClick={() => go(`/kerja/${r.caseId}`)}>
            <span className="v5-row-between"><strong>{r.publicCode}</strong><span>{MILESTONE[r.milestone] ?? r.milestone}</span></span>
            <span>{r.place}</span>
            <span className="v5-caption">{r.result ? RESULT[r.result] ?? r.result : r.dueAt ? `Jadwal ${when(r.dueAt)}` : 'Menunggu pemicu'}{r.warranty ? ' · Tanda garansi' : ''}</span>
          </button></li>
        ))}
      </ul>
    </Card>
  );
}

interface Rank { name: string; cases: number; checks: number; durablePct: number | null; failedInWarranty: number }
interface Report {
  card: { totalCases: number; medianResponseDays: number | null; withinSlaPct: number | null; durable3: { checked: number; stillGoodPct: number | null }; durable6: { checked: number; stillGoodPct: number | null }; late: number; costPerM2Idr: number | null };
  byArea: Rank[];
  byExecutor: Rank[];
}
const orDash = (v: number | null, suffix = '') => (v === null ? 'Belum ada data' : `${Math.round(v * 10) / 10}${suffix}`);

function Ranking({ title, rows, testId }: { title: string; rows: Rank[]; testId: string }) {
  return (
    <Card title={title} testId={testId}>
      {rows.length === 0 && <p className="v5-muted">Belum ada data.</p>}
      <ol className="v6-rank">
        {rows.map((r) => <li key={r.name}><strong>{r.name}</strong><span className="v5-caption">{r.cases} kasus · {r.durablePct === null ? 'belum ada pemeriksaan' : `${r.durablePct}% masih bagus dari ${r.checks} pemeriksaan`}{r.failedInWarranty ? ` · ${r.failedInWarranty} rusak dalam pemeliharaan` : ''}</span></li>)}
      </ol>
    </Card>
  );
}

export function ReportModule({ head }: { head: ReactNode }) {
  const { data } = useLoad(() => v6<Report>('/report-card'), []);
  const c = data?.card;
  return (
    <>
      <div className="v6-stats" data-testid="v6-report-card">
        <Stat label="Waktu respons tengah" value={c ? orDash(c.medianResponseDays, ' hari') : '–'} />
        <Stat label="Ditindak sesuai tenggat" value={c ? orDash(c.withinSlaPct, '%') : '–'} />
        <Stat label="Masih bagus di 3 bulan" value={c ? orDash(c.durable3.stillGoodPct, '%') : '–'} />
        <Stat label="Masih bagus di 6 bulan" value={c ? orDash(c.durable6.stillGoodPct, '%') : '–'} />
        <Stat label="Lewat tenggat" value={c?.late ?? '–'} tone="#FF6B2C" />
        <Stat label="Biaya tengah per m²" value={c?.costPerM2Idr ? `Rp ${Math.round(c.costPerM2Idr).toLocaleString('id-ID')}` : 'Belum ada data'} />
      </div>
      <Ranking title="Peringkat per wilayah kerja" rows={data?.byArea ?? []} testId="v6-rank-area" />
      <Ranking title="Peringkat per pelaksana, dari ketahanan perbaikan" rows={data?.byExecutor ?? []} testId="v6-rank-executor" />
      {head}
    </>
  );
}

interface AuditView {
  chain: { ok: boolean; count?: number };
  anomalies: { caseId: string; publicCode: string; kind: string; text: string }[];
  exceptions: { caseId: string; type: string; basis: string; at: string }[];
  documents: number;
  aiDecisions: number;
}
const FILTERS: [string, string][] = [['ALL', 'Semua'], ['COST_GAP', 'Selisih biaya'], ['WARRANTY', 'Rusak dini'], ['PHOTO', 'Foto ditandai'], ['FLAG', 'Catatan lain']];

export function AuditModule() {
  const { go } = useV5();
  const { data } = useLoad(() => v6<AuditView>('/audit/overview'), []);
  const [filter, setFilter] = useState('ALL');
  const rows = (data?.anomalies ?? []).filter((a) => filter === 'ALL' || a.kind === filter);
  return (
    <>
      <Card title="Rantai bukti" testId="v6-chain">
        {!data && <p>Memuat…</p>}
        {data && <p className={data.chain.ok ? 'v6-ok' : 'v5-warn'} data-testid="v6-chain-status">{data.chain.ok ? 'Utuh. Tidak ada catatan yang berubah.' : 'Rusak. Ada catatan yang berubah.'}</p>}
        {data && <p className="v5-muted">{data.documents} laporan audit terbit · {data.aiDecisions} keputusan atas saran AI tercatat</p>}
      </Card>
      <Card title="Perlu klarifikasi" testId="v6-anomalies">
        <div className="v5-tabs-inline">{FILTERS.map(([id, label]) => <button key={id} type="button" className={`v5-tab${filter === id ? ' v5-tab-on' : ''}`} onClick={() => setFilter(id)}>{label}</button>)}</div>
        {rows.length === 0 && <p className="v5-muted">Tidak ada yang perlu klarifikasi.</p>}
        <ul className="v5-list">{rows.map((a, i) => <li key={i}><button type="button" onClick={() => go(`/kerja/${a.caseId}`)} data-testid={`v6-anomaly-${a.kind}`}><strong>{a.publicCode}</strong><span>{a.text}</span></button></li>)}</ul>
      </Card>
      <Card title="Pengecualian pemisahan tugas" testId="v6-exceptions">
        {data?.exceptions.length === 0 && <p className="v5-muted">Tidak ada pengecualian.</p>}
        <ul className="v5-list">{(data?.exceptions ?? []).map((e, i) => <li key={i}><button type="button" onClick={() => go(`/kerja/${e.caseId}`)}><span>{e.basis}</span><span className="v5-caption">{when(e.at)}</span></button></li>)}</ul>
      </Card>
      <CaseList title="Buka kasus untuk ekspor laporan" scope="ALL" />
    </>
  );
}

export function SettingsModule({ admin }: { admin: ReactNode }) {
  const { v6Role } = useV5();
  const { data, reload } = useLoad(() => v6<{ agency: { name: string; region: string; slaDays: number; sessionHours: number; logoUri: string | null } | null; jurisdictions: { adminArea: string; roadStatus: string; decreeRefs: string[] }[] }>('/agency'), []);
  const action = useAction();
  const [hours, setHours] = useState('');
  return (
    <>
      <Card title="Instansi" testId="v6-settings">
        <p><strong>{data?.agency?.name}</strong></p>
        <p className="v5-muted">Tenggat tindak lanjut: {data?.agency?.slaDays} hari</p>
        <p className="v5-muted">Lama sesi: {data?.agency?.sessionHours} jam</p>
        {v6Role === 'OM' && (
          <>
            <label className="v5-field"><span>Ubah lama sesi (jam)</span><input inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value.replace(/\D/g, ''))} data-testid="v6-session-hours" /></label>
            <button type="button" className="v5-btn" disabled={action.busy || !hours} onClick={() => action.run(async () => { await v6('/agency/session-hours', { hours: Number(hours) }); setHours(''); reload(); })} data-testid="v6-session-hours-save">Simpan</button>
            <ErrorNote error={action.error} />
          </>
        )}
      </Card>
      <Card title="Wilayah tanggung jawab" testId="v6-jurisdictions">
        {(data?.jurisdictions ?? []).map((j, i) => <p key={i}>{j.adminArea} · {j.roadStatus}{j.decreeRefs.length ? <span className="v5-caption"> · {j.decreeRefs.join('; ')}</span> : null}</p>)}
      </Card>
      {admin}
    </>
  );
}

export const stateId = (s: V5State) => V5_STATE_LABELS[s].id;
