/** Redraws the QR badges in the local access file for the current public address. Codes do not change. */
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';

const dataDir = process.argv[2] ?? '.data/v5-live';
const url = fs.readFileSync('.data/v6-url.txt', 'utf8').trim();
const rows: { id: string; code: string }[] = JSON.parse(fs.readFileSync(path.join(dataDir, 'test-access.local.json'), 'utf8'));
const dir = path.join(dataDir, 'test-access-qr');
fs.mkdirSync(dir, { recursive: true });
Promise.all(rows.map((r) => QRCode.toFile(path.join(dir, `${r.id}.png`), `${url}/login/#kode=${r.code}`, { margin: 1, width: 360 }))).then(() => console.log(`${rows.length} badges for ${url}`));
