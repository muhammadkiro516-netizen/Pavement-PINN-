/**
 * Test accounts for the original sign-in form, in the demo data folder only.
 * Safe to run again: an account that exists is left as it is.
 *
 *   DATA_DIR=.data/v5-demo npx tsx scripts/v5-seed-accounts.ts
 */
import path from 'node:path';
import { AccountStore } from '../server/repositories/accountStore';

const AGENCY = 'Dinas PUPR Kabupaten Karawang';
const ACCOUNTS = [
  { email: 'hendra.gunawan@pavement-pinn.example', name: 'Koordinator Uji', password: 'OpsPinn2026!', role: 'OPERATIONS_MANAGER' },
  { email: 'ahmad.subagyo@pavement-pinn.example', name: 'Petugas Uji', password: 'FieldPinn2026!', role: 'FIELD_ENGINEER' }
] as const;

const dir = process.env.DATA_DIR;
if (!dir) throw new Error('Set DATA_DIR to the demo data folder.');
const store = new AccountStore(path.join(dir, 'accounts.json'));
for (const account of ACCOUNTS) {
  try {
    store.create({ ...account, agency: AGENCY, agencyId: 'dpupr-karawang' });
    console.log(`created ${account.email}`);
  } catch (e) {
    console.log(`kept ${account.email}: ${(e as Error).message}`);
  }
}
