import type { WorkflowAction, WorkflowState } from '../../domain/workflow/model';

export { WORKFLOW_STATE_LABEL } from '../../domain/workflow/projections';

/** Button text for each workflow action (Indonesian UI). */
export const ACTION_LABEL: Record<WorkflowAction, string> = {
  SUBMIT: 'Kirim laporan',
  BEGIN_SCREENING: 'Mulai penyaringan',
  SCREENING_PASSED: 'Lolos penyaringan',
  SCREENING_NEEDS_REVIEW: 'Perlu peninjauan',
  REVIEW_ACCEPT: 'Terima untuk ditindaklanjuti',
  CLOSE_INVALID: 'Tutup: tidak valid / duplikat',
  REQUEST_INSPECTION: 'Tugaskan inspeksi lapangan',
  SUBMIT_INSPECTION: 'Kirim hasil inspeksi untuk verifikasi M.O',
  VERIFY_INSPECTION: 'Verifikasi hasil inspeksi',
  REQUEST_REINSPECTION: 'Minta inspeksi ulang ke F.E',
  RECOMMEND_ACTION: 'Ajukan penanganan ke M.O',
  CLOSE_NO_ACTION: 'Tutup tanpa penanganan',
  APPROVE_ACTION: 'Setujui penanganan',
  REJECT_ACTION: 'Kembalikan rekomendasi ke F.E',
  START_WORK: 'Terbitkan perintah kerja internal',
  COMPLETE_WORK_ORDER: 'Kirim bukti perbaikan ke M.O',
  REQUEST_REWORK: 'Minta perbaikan ulang ke F.E',
  RESOLVE: 'Setujui & verifikasi perbaikan',
  CLOSE_RESOLVED: 'Tutup laporan',
  TRANSFER_AUTHORITY: 'Alihkan ke instansi lain (disposisi)',
  MARK_HAZARD: 'Pasang rambu peringatan',
  SEED_IMPORT: 'Impor data contoh'
};

/** Visual tone per state: text label is always shown too (never colour alone). */
export function stateTone(state: WorkflowState | string): 'neutral' | 'review' | 'active' | 'done' | 'closed' {
  switch (state) {
    case 'SUBMITTED':
    case 'AI_SCREENING':
    case 'NEEDS_REVIEW':
      return 'review';
    case 'VERIFIED':
    case 'FIELD_INSPECTION_REQUESTED':
    case 'INSPECTED':
    case 'INSPECTION_VERIFIED':
    case 'ACTION_RECOMMENDED':
    case 'ACTION_APPROVED':
    case 'IN_PROGRESS':
      return 'active';
    case 'RESOLVED':
      return 'done';
    case 'CLOSED':
      return 'closed';
    default:
      return 'neutral';
  }
}

export const TONE_CLASS: Record<ReturnType<typeof stateTone>, string> = {
  neutral: 'bg-slate-700/40 text-slate-200 border-slate-500/40',
  review: 'bg-amber-500/15 text-amber-200 border-amber-500/40',
  active: 'bg-sky-500/15 text-sky-200 border-sky-500/40',
  done: 'bg-emerald-500/15 text-emerald-200 border-emerald-500/40',
  closed: 'bg-slate-700/40 text-slate-300 border-slate-500/40'
};

/** Same tones for light surfaces (task list, light pages). */
export const TONE_CLASS_LIGHT: Record<ReturnType<typeof stateTone>, string> = {
  neutral: 'bg-slate-100 text-slate-700 border-slate-300',
  review: 'bg-amber-50 text-amber-800 border-amber-300',
  active: 'bg-sky-50 text-sky-700 border-sky-200',
  done: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  closed: 'bg-slate-100 text-slate-600 border-slate-300'
};

/** Short role names used in the report flow R.E → M.O → F.E → D.M. */
export const ROLE_SHORT: Record<string, string> = {
  PUBLIC_REPORTER: 'R.E',
  PUBLIC_VIEWER: 'R.E',
  OPERATIONS_MANAGER: 'M.O',
  FIELD_ENGINEER: 'F.E',
  POLICY_MAKER: 'D.M',
  SYSTEM: 'Sistem'
};
