/** Pieces shared by the role workspaces. Everyday words first; technical words stay behind a toggle. */
import { useEffect, useState, type ReactNode } from 'react';
import { Pavi, type PaviMood } from '../../components/brand/Pavi';
import type { V5Role } from '../../domain/v5/model';

export type ChipKind = 'MEASURED' | 'OFFICIAL' | 'INPUT' | 'ASSUMED' | 'AI_ESTIMATE' | 'TODO_VERIFY' | 'COMPUTED' | 'NOT_MEASURED';

const CHIP_TEXT: Record<ChipKind, string> = { MEASURED: 'terukur', OFFICIAL: 'resmi', INPUT: 'diisi petugas', ASSUMED: 'perkiraan', AI_ESTIMATE: 'perkiraan AI', TODO_VERIFY: 'belum dipastikan', COMPUTED: 'dihitung', NOT_MEASURED: 'belum diukur' };

/** The small label beside every number. */
export function Chip({ kind, title }: { kind: ChipKind; title?: string }) {
  return <span className={`v5-chip v5-chip-${kind.toLowerCase()}`} title={title}>{CHIP_TEXT[kind]}</span>;
}

/** Technical terms live here only: for inspectors and auditors who want them. */
export function TechDetails({ children }: { children: ReactNode }) {
  return <details className="v5-tech"><summary>Detail teknis</summary>{children}</details>;
}

/** Pavi per role, in the app's own palette. */
const PAVI_LOOK: Record<V5Role, { helmet: string; vest: string }> = {
  CITIZEN: { helmet: '#FFD60A', vest: '#FFFFFF' },
  FIELD_INSPECTOR: { helmet: '#FF6B2C', vest: '#FFD60A' },
  COORDINATOR: { helmet: '#4C8DFF', vest: '#FFFFFF' },
  APPROVER: { helmet: '#E5E7EB', vest: '#FFD60A' },
  REPAIR_CREW: { helmet: '#FFD60A', vest: '#FF4D5E' },
  SUPERVISOR: { helmet: '#2BD67B', vest: '#FFFFFF' },
  AUDITOR: { helmet: '#FFFFFF', vest: '#38BDF8' },
  AGENCY_HEAD: { helmet: '#E5E7EB', vest: '#2BD67B' },
  ADMIN: { helmet: '#8E8E93', vest: '#FFFFFF' }
};

export function RolePavi({ role, mood = 'idle', size = 64 }: { role: V5Role; mood?: PaviMood; size?: number }) {
  const look = PAVI_LOOK[role];
  return <span className="v5-pavi" aria-hidden="true" style={{ flex: 'none', lineHeight: 0 }}><Pavi size={size} mood={mood} helmet={look.helmet} vest={look.vest} /></span>;
}

export const rupiah = (n: number) => `Rp${Math.round(n).toLocaleString('id-ID')}`;

export function when(iso: string | null | undefined): string {
  if (!iso) return '–';
  return `${new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })} WIB`;
}

export function dateOnly(iso: string | null | undefined): string {
  if (!iso) return '–';
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' });
}

export function Card({ title, children, testId, actions }: { title?: ReactNode; children: ReactNode; testId?: string; actions?: ReactNode }) {
  return (
    <section className="v5-card" data-testid={testId}>
      {(title || actions) && <div className="v5-card-head">{title && <h2>{title}</h2>}{actions}</div>}
      {children}
    </section>
  );
}

export function Confidence({ level }: { level: 'HIGH' | 'MEDIUM' | 'LOW' }) {
  const text = { HIGH: 'Sudah pasti', MEDIUM: 'Kemungkinan besar', LOW: 'Perlu dipastikan' }[level];
  return <span className={`v5-conf v5-conf-${level.toLowerCase()}`}>{text}</span>;
}

export interface LadderView {
  daysWaiting: number;
  level: string | null;
  paused: boolean;
  applies: boolean;
  steps: { day: number; level: string; label: string; reached: boolean }[];
}

const LADDER_WORD: Record<string, string> = { COORDINATOR: 'Koordinator diberi tahu', AGENCY_HEAD: 'Pimpinan diberi tahu', PUBLIC: 'Tampil: belum ditangani', COMPLAINT: 'Draf pengaduan tersedia' };

export function Ladder({ ladder }: { ladder: LadderView }) {
  if (!ladder.applies) return <p className="v5-muted">Hitungan waktu berhenti: kasus ini sudah tidak terbuka.</p>;
  return (
    <div data-testid="v5-ladder">
      <p><strong data-testid="v5-days-waiting">{ladder.paused ? 'Waktu dihentikan sementara karena ada alasan menunggu' : `Sudah menunggu ${ladder.daysWaiting} hari`}</strong></p>
      <ol className="v5-ladder">
        {ladder.steps.map((s) => (
          <li key={s.level} className={s.reached ? 'is-reached' : ''} data-reached={s.reached}>
            <span className="v5-ladder-day">Hari ke-{s.day}</span>
            <span>{LADDER_WORD[s.level] ?? s.label}</span>
          </li>
        ))}
      </ol>
      <p className="v5-caption">Batas hari ini target internal, bukan aturan hukum.</p>
    </div>
  );
}

export interface TimelineItem { type: string; label: string; at: string; role: string; hash: string; state?: string | null }

const ROLE_WORD: Record<string, string> = { CITIZEN: 'Warga', FIELD_INSPECTOR: 'Petugas', COORDINATOR: 'Koordinator', APPROVER: 'Pejabat penyetuju', REPAIR_CREW: 'Regu perbaikan', SUPERVISOR: 'Pengawas', AUDITOR: 'Auditor', AGENCY_HEAD: 'Pimpinan', ADMIN: 'Admin', SYSTEM: 'Sistem' };
export const roleWord = (r: string) => ROLE_WORD[r] ?? r;

const STEP_WORD: Record<string, string> = {
  'case.submitted': 'Laporan warga diterima', 'case.screened': 'Disaring dan diarahkan ke kantor', 'case.duplicate_suggested': 'Mungkin duplikat', 'case.accepted': 'Diterima instansi', 'case.transfer_requested': 'Pengalihan instansi diminta', 'case.transfer_confirmed': 'Pengalihan dikonfirmasi', 'case.referred': 'Diteruskan ke kanal resmi', 'case.pending_set': 'Alasan menunggu diumumkan', 'case.hazard_marked': 'Rambu peringatan dicatat', 'inspection.assigned': 'Petugas ditugaskan', 'inspection.submitted': 'Inspeksi di lokasi selesai', 'inspection.verified': 'Hasil inspeksi diperiksa', 'inspection.reinspection_requested': 'Inspeksi diulang', 'pinn.run': 'Perkiraan umur dihitung', 'cost.estimated': 'Biaya wajar dihitung', 'plan.proposed': 'Rencana perbaikan diusulkan', 'plan.returned': 'Rencana dikembalikan', 'plan.approved': 'Rencana disetujui', 'work_order.issued': 'Perbaikan dijadwalkan', 'work.started': 'Perbaikan dimulai', 'work.stage_evidence': 'Foto tahap perbaikan', 'work.declared': 'Volume dan biaya dilaporkan', 'work.submitted': 'Bukti perbaikan dikirim', 'work.rejected': 'Perbaikan perlu diulang', 'work.verified': 'Diperiksa pengawas', 'work.accepted': 'Perbaikan diterima, mulai dipantau', 'follow_up.recorded': 'Pemeriksaan lanjutan dicatat', 'follow_up.scheduled': 'Pemeriksaan lanjutan dijadwalkan', 'flag.created': 'Sedang dalam pemeriksaan teknis', 'response.added': 'Instansi menanggapi', 'case.reopened': 'Rusak lagi, kasus dibuka kembali', 'case.closed': 'Kasus ditutup', 'document.issued': 'Laporan audit diterbitkan'
};

export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <ol className="v5-timeline" data-testid="v5-timeline">
      {items.map((e, i) => (
        <li key={`${e.hash}-${i}`} style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}>
          <strong>{STEP_WORD[e.type] ?? e.label}</strong>
          <span className="v5-caption">{when(e.at)} · {roleWord(e.role)}</span>
        </li>
      ))}
    </ol>
  );
}

/** Refusals from the server, in everyday words. The rule number stays for staff who need it. */
const SOD_WORD: Record<string, string> = {
  'SOD-1': 'Pelaksana dan pemeriksa harus orang yang berbeda.',
  'SOD-2': 'Anda yang mengusulkan atau memeriksa kasus ini, jadi Anda tidak boleh menyetujuinya.',
  'SOD-3': 'Anda terkait dengan penyedia paket ini, jadi tidak boleh menanganinya.',
  'SOD-4': 'Anda ikut mengerjakan atau memeriksa perbaikan ini, jadi orang lain yang harus mencatat.',
  'SOD-5': 'Pengawas harus memeriksa perbaikan sebelum bisa diterima.',
  'SOD-7': 'Pengalihan harus menyebut SK, dan dikonfirmasi orang lain di instansi tujuan.',
  'SOD-8': 'Auditor dan admin tidak bisa mengubah kasus.',
  'SOD-9': 'Regulator tol hanya bisa memberi catatan.',
  'SOD-11': 'Anda yang membuat laporan ini, jadi orang lain yang harus menerimanya.',
  'SOD-13': 'Pimpinan harus menyetujui perpanjangan ini.'
};

const MESSAGE_WORD: Array<[RegExp, string]> = [
  [/at least \d+ characters/, 'Tulis alasan minimal 10 huruf.'],
  [/neutral wording/i, 'Gunakan kata yang netral, misalnya "perlu klarifikasi".'],
  [/changed\. Reload/, 'Kasus ini baru berubah. Muat ulang lalu coba lagi.'],
  [/Your role cannot/, 'Peran Anda tidak bisa melakukan ini.'],
  [/assigned to (someone else|another)/, 'Tugas ini milik orang lain.'],
  [/Checklist is not complete/, 'Daftar bukti belum lengkap.'],
  [/Add these photos first/, 'Foto sebelum dan tepi potongan harus ada dulu.'],
  [/Type the depth/, 'Isi kedalaman dalam mm, sesuai penggaris.'],
  [/length and width/, 'Isi panjang dan lebar.'],
  [/ruler-at-deepest/, 'Foto penggaris di titik terdalam wajib ada.'],
  [/Type the traffic load/, 'Isi beban lalu lintas per tahun.'],
  [/SK citation required/, 'Sebutkan nomor dan tanggal SK penetapan jalan.'],
  [/Volume must equal/, 'Volume harus sesuai luas dan tebal.']
];

export function ErrorNote({ error }: { error: { message: string; rule?: string } | null }) {
  if (!error) return null;
  const word = (error.rule && SOD_WORD[error.rule]) || MESSAGE_WORD.find(([re]) => re.test(error.message))?.[1] || error.message;
  return <p className="v5-error" role="alert" data-testid="v5-error" data-rule={error.rule}>{word}</p>;
}

/** Runs an async action with one busy flag and one error slot. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; rule?: string } | null>(null);
  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e as { message: string; rule?: string });
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

/** Loads once and on demand. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<{ message: string } | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    load().then((d) => { if (live) setData(d); }).catch((e) => { if (live) setError(e); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, reload: () => setTick((t) => t + 1), setData };
}
