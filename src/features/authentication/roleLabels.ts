import type { UserRole } from '../../types';

/** Display names of the five role identifiers (the identifiers themselves never change). */
export const ROLE_LABELS: Record<UserRole, string> = {
  FIELD_ENGINEER: 'Insinyur Lapangan',
  OPERATIONS_MANAGER: 'Manajer Operasional',
  POLICY_MAKER: 'Pimpinan Instansi',
  PUBLIC_REPORTER: 'Pelapor Publik',
  PUBLIC_VIEWER: 'Pengamat Publik'
};
