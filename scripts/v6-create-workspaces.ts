/**
 * Makes the test workspaces and their staff. The codes, PINs and QR badges go only to a local file under
 * .data (gitignored); the app keeps hashes. Running it again gives everyone new codes.
 *
 *   npx tsx scripts/v6-create-workspaces.ts [dataDir]
 */
import { randomInt } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import { Workspaces, type Agency } from '../server/v6/workspaces';
import { isWeakPin, type V6Role } from '../src/domain/v6/roles';

const dataDir = process.argv[2] ?? '.data/v5-live';
const publicUrl = process.env.V6_PUBLIC_URL ?? '';
const spaces = new Workspaces(path.join(dataDir, 'v6'));

const JURISDICTIONS: Record<string, { adminArea: string; roadStatus: string; decreeRefs: string[]; priority: number }[]> = {
  'sudin-bm-jaktim': [{ adminArea: 'Jakarta Timur', roadStatus: 'PROVINSI', decreeRefs: ['Satu Data Jakarta 2025: jalan umum non-tol berstatus provinsi'], priority: 10 }],
  'dpupr-karawang': [{ adminArea: 'Karawang', roadStatus: 'KABUPATEN', decreeRefs: [], priority: 10 }]
};

const AGENCIES: Agency[] = [
  { id: 'sudin-bm-jaktim', name: 'Suku Dinas Bina Marga Jakarta Timur', kind: 'PROVINSI', authorityIds: ['pemprov-dki'], region: '3175', logoUri: null, contact: '', slaDays: 7, sessionHours: 12 },
  { id: 'dpupr-karawang', name: 'Dinas PUPR Kabupaten Karawang', kind: 'KABUPATEN', authorityIds: ['pemkab-karawang'], region: '3215', logoUri: null, contact: '', slaDays: 7, sessionHours: 12 }
];

const STAFF: { label: string; title: string; role: V6Role }[] = [
  { label: 'OM 1', title: 'Uji: Kepala Seksi', role: 'OM' },
  { label: 'OM 2', title: 'Uji: Kepala Seksi', role: 'OM' },
  { label: 'FE 1', title: 'Uji: Petugas Inspeksi', role: 'FE' },
  { label: 'FE 2', title: 'Uji: Pengawas Lapangan', role: 'FE' },
  { label: 'Auditor', title: 'Uji: Auditor Internal', role: 'AUDITOR' }
];

const newPin = () => {
  for (;;) {
    const pin = String(randomInt(100000, 1000000));
    if (!isWeakPin(pin)) return pin;
  }
};

async function main() {
  const now = new Date().toISOString();
  const qrDir = path.join(dataDir, 'test-access-qr');
  fs.mkdirSync(qrDir, { recursive: true });
  const rows = [];
  for (const agency of AGENCIES) {
    spaces.upsertAgency(agency, JURISDICTIONS[agency.id]);
    for (const person of STAFF) {
      const id = `${agency.id}-${person.label.toLowerCase().replace(/\s+/g, '')}`;
      const { code } = spaces.addMember({ agencyId: agency.id, name: `Uji ${person.label}`, title: person.title, role: person.role, id, personId: `PER-${id}` }, now);
      const pin = newPin();
      spaces.setPin(id, pin);
      if (publicUrl) await QRCode.toFile(path.join(qrDir, `${id}.png`), `${publicUrl}/login/#kode=${code}`, { margin: 1, width: 360 });
      rows.push({ id, agencyId: agency.id, agency: agency.name, label: person.label, role: person.role, code, pin });
    }
  }
  const file = path.join(dataDir, 'test-access.local.json');
  fs.writeFileSync(file, JSON.stringify(rows, null, 1));
  console.log(`${rows.length} staff in ${AGENCIES.length} workspaces. Codes: ${file}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
