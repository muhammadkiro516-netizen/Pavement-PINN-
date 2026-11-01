/**
 * Creates one staff account per role with a random password, and writes the list to
 * <DATA_DIR>/staff-logins.json (a gitignored folder) for the team and the browser tests.
 * Running it again gives new passwords.
 *
 *   DATA_DIR=.data/v5-live npx tsx scripts/v5-create-accounts.ts
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PILOT_ROSTER, StaffAccounts } from '../server/v5/staffAccounts';

const dataDir = process.env.DATA_DIR;
if (!dataDir) throw new Error('Set DATA_DIR to the data folder of the server.');
const store = new StaffAccounts(path.join(dataDir, 'v5'));
const logins = PILOT_ROSTER.map((account) => {
  const password = `Pinn-${randomBytes(6).toString('base64url')}`;
  store.upsert(account, password);
  return { accountId: account.accountId, role: account.role, email: account.email, password };
});
fs.writeFileSync(path.join(dataDir, 'staff-logins.json'), JSON.stringify(logins, null, 1));
console.log(`${logins.length} accounts in ${path.join(dataDir, 'staff-logins.json')}`);
