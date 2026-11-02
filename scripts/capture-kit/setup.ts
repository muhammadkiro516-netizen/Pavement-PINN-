/**
 * Prepares a separate data folder for recording the product video: the real agencies, staff with display
 * names, and real road locations for cases A-D. Never touches the live data. Codes stay in .data/capture.
 *
 *   npx tsx scripts/capture-kit/setup.ts
 */
import { randomInt } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { RoadRegistry } from '../../server/v5/routing';
import { Workspaces, type Agency } from '../../server/v6/workspaces';
import { isWeakPin, type V6Role } from '../../src/domain/v6/roles';

const dataDir = '.data/capture';
fs.rmSync(dataDir, { recursive: true, force: true });
const spaces = new Workspaces(path.join(dataDir, 'v6'));

const base = { logoUri: null, contact: '', slaDays: 7, sessionHours: 12 };
const AGENCIES: { agency: Agency; area: string; status: string; staff: [string, string, string, V6Role][] }[] = [
  {
    agency: { ...base, id: 'dpupr-karawang', name: 'Dinas PUPR Kabupaten Karawang', kind: 'KABUPATEN', authorityIds: ['pemkab-karawang'], region: '3215' },
    area: 'Karawang',
    status: 'KABUPATEN',
    staff: [
      ['om1', 'Rina Hapsari', 'Kepala Seksi Pemeliharaan Jalan', 'OM'],
      ['om2', 'Bambang Setiawan', 'Pejabat Pembuat Komitmen', 'OM'],
      ['fe1', 'Dimas Pratama', 'Petugas Inspeksi Jalan', 'FE'],
      ['fe2', 'Sari Wulandari', 'Pengawas Lapangan', 'FE'],
      ['auditor', 'Hendra Gunawan', 'Auditor Internal', 'AUDITOR']
    ]
  },
  {
    agency: { ...base, id: 'sudin-bm-jaktim', name: 'Suku Dinas Bina Marga Jakarta Timur', kind: 'PROVINSI', authorityIds: ['pemprov-dki'], region: '3172' },
    area: 'Jakarta Timur',
    status: 'PROVINSI',
    staff: [
      ['om1', 'Maya Kartika', 'Kepala Seksi Pemeliharaan Jalan', 'OM'],
      ['fe1', 'Arif Budiman', 'Petugas Inspeksi Jalan', 'FE'],
      ['auditor', 'Nurul Aini', 'Auditor Internal', 'AUDITOR']
    ]
  },
  {
    agency: { ...base, id: 'bbpjn-dki-jabar', name: 'BBPJN DKI Jakarta - Jawa Barat', kind: 'NASIONAL', authorityIds: ['kementerian-pu'], region: '32' },
    area: 'Karawang',
    status: 'NASIONAL',
    staff: [['om1', 'Yusuf Maulana', 'Kepala Satuan Kerja Pemeliharaan', 'OM']]
  }
];

const newPin = () => {
  for (;;) {
    const pin = String(randomInt(100000, 1000000));
    if (!isWeakPin(pin)) return pin;
  }
};

const access: Record<string, { code: string; pin: string; name: string }> = {};
const now = new Date().toISOString();
for (const { agency, area, status, staff } of AGENCIES) {
  spaces.upsertAgency(agency, [{ adminArea: area, roadStatus: status, decreeRefs: [], priority: 10 }]);
  for (const [key, name, title, role] of staff) {
    const id = `${agency.id}-${key}`;
    const { code } = spaces.addMember({ agencyId: agency.id, name, title, role, id, personId: `PER-${id}` }, now);
    const pin = newPin();
    spaces.setPin(id, pin);
    access[id] = { code, pin, name };
  }
}

// ---- Real road locations
const registry = new RoadRegistry();
const poi: { schools: { lat: number; lon: number; name: string }[] } = JSON.parse(fs.readFileSync('config/v6/poi_near.json', 'utf8'));
const snapshot = JSON.parse(fs.readFileSync('config/v5/roads_snapshot.json', 'utf8'));

let caseA: { lat: number; lon: number; school: string; road: string; confidence: string } | null = null;
const nearSchools = poi.schools.filter((s) => s.lat > -6.5 && s.lat < -6.1 && s.lon > 107.15 && s.lon < 107.5);
outer: for (const road of snapshot.roads as { name: string | null; pts: [number, number][] }[]) {
  if (!road.name) continue;
  for (const [lat, lon] of road.pts) {
    if (lat < -6.5 || lat > -6.1 || lon < 107.15 || lon > 107.5) continue;
    const school = nearSchools.find((s) => Math.hypot((s.lat - lat) * 111_320, (s.lon - lon) * 110_600) < 250);
    if (!school) continue;
    const r = registry.decide(lat, lon, 8);
    if (r.status === 'KABUPATEN' && r.segment?.name) {
      caseA = { lat, lon, school: school.name, road: r.segment.name, confidence: r.confidence };
      break outer;
    }
  }
}

let caseC: { lat: number; lon: number; road: string; confidence: string; status: string } | null = null;
for (const road of snapshot.roads as { highway: string; name: string | null; toll: boolean; pts: [number, number][] }[]) {
  if (!road.highway.startsWith('trunk') || !road.name || road.toll) continue;
  const [lat, lon] = road.pts[Math.floor(road.pts.length / 2)];
  const r = registry.decide(lat, lon, 8);
  if (/Timur/.test(r.area.kota ?? '') && r.confidence === 'LOW') { caseC = { lat, lon, road: road.name, confidence: r.confidence, status: r.status }; break; }
}

const d = registry.decide(-6.2615, 106.8106, 8);
const caseD = { lat: -6.2615, lon: 106.8106, office: d.officeName, status: d.status };

fs.writeFileSync(path.join(dataDir, 'access.local.json'), JSON.stringify(access, null, 1));
fs.writeFileSync(path.join(dataDir, 'points.json'), JSON.stringify({ caseA, caseC, caseD }, null, 1));
console.log(JSON.stringify({ caseA, caseC, caseD }));
