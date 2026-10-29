/**
 * SPEC M3.1-M3.3: a report cannot sink silently. The hourglass counts days since the report
 * (or since the promised date of a pending reason), and the ladder rises at fixed internal
 * targets. A pending reason with a date pauses the ladder until that date; afterwards the clock
 * restarts from the promised date. Pure: computed from the case on every read, so there is no
 * stored escalation state that could drift.
 */
import type { ReportCase } from './model';

export const PENDING_CODES = ['MENUNGGU_ANGGARAN', 'MENUNGGU_JADWAL', 'CUACA_MUSIM_HUJAN', 'KEWENANGAN_LAIN', 'LAINNYA'] as const;
export type PendingCode = (typeof PENDING_CODES)[number];
export const PENDING_LABEL: Record<PendingCode, string> = {
  MENUNGGU_ANGGARAN: 'Menunggu anggaran',
  MENUNGGU_JADWAL: 'Menunggu jadwal pekerjaan',
  CUACA_MUSIM_HUJAN: 'Perbaikan permanen setelah musim hujan',
  KEWENANGAN_LAIN: 'Kewenangan instansi lain',
  LAINNYA: 'Alasan lain'
};

export interface PendingReason {
  code: PendingCode;
  /** Expected date (ISO) the work resumes; escalation pauses until then. */
  until: string;
  note: string;
  by: string;
  at: string;
}

/** Internal targets in days (SPEC M3.2). Editable here; shown as "target internal", not law. */
export const LADDER = [
  { days: 2, level: 'KOORDINATOR', label: 'Pengingat ke Koordinator' },
  { days: 7, level: 'PIMPINAN', label: 'Diteruskan ke Pimpinan Instansi' },
  { days: 14, level: 'PUBLIK', label: 'Belum ditangani > 14 hari' },
  { days: 30, level: 'PENGADUAN', label: 'Warga dapat mengunduh draf surat pengaduan' }
] as const;
export type EscalationLevel = 'NONE' | (typeof LADDER)[number]['level'];

const DAY = 86_400_000;
const OPEN = new Set(['NEEDS_REVIEW', 'VERIFIED', 'FIELD_INSPECTION_REQUESTED', 'INSPECTED', 'INSPECTION_VERIFIED', 'ACTION_RECOMMENDED', 'ACTION_APPROVED', 'IN_PROGRESS']);

export interface Escalation {
  open: boolean;
  /** Whole days the report has been waiting (hourglass). */
  waitingDays: number;
  level: EscalationLevel;
  label: string | null;
  paused: boolean;
  pausedUntil: string | null;
  /** Days counted by the ladder (since the report, or since the promised date). */
  ladderDays: number;
}

export function escalationOf(c: Pick<ReportCase, 'state' | 'createdAt'> & { pending?: PendingReason | null }, now: number = Date.now()): Escalation {
  const open = OPEN.has(c.state);
  const waitingDays = Math.max(0, Math.floor((now - Date.parse(c.createdAt)) / DAY));
  const p = c.pending ?? null;
  const until = p ? Date.parse(p.until) : NaN;
  if (!open) return { open, waitingDays, level: 'NONE', label: null, paused: false, pausedUntil: null, ladderDays: 0 };
  if (p && until > now) return { open, waitingDays, level: 'NONE', label: null, paused: true, pausedUntil: p.until, ladderDays: 0 };
  const start = p && Number.isFinite(until) ? Math.max(until, Date.parse(c.createdAt)) : Date.parse(c.createdAt);
  const ladderDays = Math.max(0, Math.floor((now - start) / DAY));
  let step: (typeof LADDER)[number] | null = null;
  for (const s of LADDER) if (ladderDays >= s.days) step = s;
  return { open, waitingDays, level: step?.level ?? 'NONE', label: step?.label ?? null, paused: false, pausedUntil: null, ladderDays };
}

const RANK: Record<EscalationLevel, number> = { NONE: 0, KOORDINATOR: 1, PIMPINAN: 2, PUBLIK: 3, PENGADUAN: 4 };
export const reached = (e: Escalation, level: EscalationLevel) => RANK[e.level] >= RANK[level];

/**
 * SPEC M3.2 (H+30): neutral complaint draft for SP4N-LAPOR! or another official channel.
 * Only facts from the case; no names, no accusations (SPEC 0.4). Never sent automatically.
 */
export function complaintDraft(input: {
  caseId: string;
  publicCode?: string | null;
  damage: string;
  location: string;
  coordinates: [number, number];
  createdAt: string;
  agency: string | null;
  waitingDays: number;
  statusLabel: string;
  publicUrl?: string | null;
}): string {
  const d = new Date(input.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  return [
    'Perihal: Permohonan tindak lanjut laporan kerusakan jalan',
    '',
    `Kepada Yth. ${input.agency ?? 'Instansi pengelola jalan terkait'}`,
    '',
    'Dengan hormat,',
    '',
    `Pada ${d} kami melaporkan kerusakan jalan berikut melalui aplikasi PAVEMENT-PINN:`,
    `- Nomor laporan : ${input.caseId}${input.publicCode ? ` (kode ${input.publicCode})` : ''}`,
    `- Jenis kerusakan: ${input.damage}`,
    `- Lokasi        : ${input.location} (${input.coordinates[0].toFixed(5)}, ${input.coordinates[1].toFixed(5)})`,
    `- Status saat ini: ${input.statusLabel}`,
    `- Lama menunggu : ${input.waitingDays} hari`,
    input.publicUrl ? `- Halaman laporan: ${input.publicUrl}` : null,
    '',
    'Kami mohon informasi jadwal penanganan atau, bila perlu, rambu peringatan sementara di lokasi demi keselamatan pengguna jalan.',
    '',
    'Terima kasih atas perhatian dan tindak lanjutnya.',
    '',
    'Hormat kami,',
    'Warga pelapor',
    '',
    'Catatan: draf ini disusun otomatis dari data laporan dan tidak dikirim oleh aplikasi. Silakan periksa, lalu kirim sendiri melalui SP4N-LAPOR! (lapor.go.id) atau kanal resmi instansi.'
  ]
    .filter((l) => l !== null)
    .join('\n');
}
