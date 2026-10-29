/**
 * SPEC §9: write docs/GENAI_DISCLOSURE.md from the git history. A commit counts as AI-assisted when
 * its message carries "Assisted-by: Claude Code" or a "Co-Authored-By: Claude" trailer.
 * Run: npx tsx scripts/genai-disclosure.ts
 */
import fs from "node:fs";
import { execSync } from "node:child_process";

const SEP = "\u001e";
const log = execSync(`git log --no-merges --format=%H%x1f%an%x1f%ad%x1f%B${SEP} --date=short`, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const commits = log.split(SEP).map((c) => c.trim()).filter(Boolean).map((c) => {
  const [hash, author, date, body] = c.split("\u001f");
  return { hash, author, date, body: body ?? "" };
});
const assisted = commits.filter((c) => /Assisted-by:\s*Claude Code/i.test(c.body) || /Co-Authored-By:\s*Claude/i.test(c.body));
const pct = commits.length ? Math.round((assisted.length / commits.length) * 1000) / 10 : 0;
const first = commits.at(-1)?.date ?? "-";
const last = commits[0]?.date ?? "-";

const md = `# Pengungkapan penggunaan GenAI (dibuat otomatis, SPEC §9)

Dibuat ${new Date().toISOString().slice(0, 10)} dari riwayat git (${first} s.d. ${last}) oleh \`scripts/genai-disclosure.ts\`.

## Alat
| Alat | Dipakai untuk |
|---|---|
| Claude / Claude Code (Anthropic) | menulis dan merevisi kode, tes dan dokumen atas arahan tim; setiap commit yang dibantu diberi trailer |
| Qwen2.5-1.5B-Instruct (lokal, OpenVINO GenAI) | fitur aplikasi: draf kalimat Usulan Penanganan (angka diisi kode, wajib disetujui manusia) |
| (alat lain yang dipakai tim — isi manual) | |

## Angka dari riwayat git
- Total commit (tanpa merge): **${commits.length}**
- Commit dengan trailer bantuan AI: **${assisted.length} (${pct}%)**
- Commit tanpa trailer: ${commits.length - assisted.length} (ditulis tim atau sebelum trailer dipakai; trailer baru konsisten sejak fase v4)

## Wajib dilengkapi tim sebelum interview
Dokumen lama menyebut \`AGENTS.md\` dan keputusan "HD-08 commit trailer (Assisted-by)", tanda bahwa tool AI lain juga pernah dipakai. Rubrik: tidak mengungkapkan = 0 poin; tulis semuanya dengan jujur.

| Tool | Dipakai untuk | Siapa |
|---|---|---|
| _(contoh: ChatGPT / Codex / Copilot / Gemini / Midjourney)_ | | |

## Peran manusia (tim)
- Ide masalah, konsep human-in-the-loop, pilihan role dan alur, keputusan produk.
- Memilih model (YOLO, MLET/PyMastic, PINN surrogate) dan memeriksa hasilnya.
- Uji coba aplikasi, pengumpulan data dan masukan pengguna, verifikasi sumber berita.

## Kalimat untuk interview
"Kami memakai asisten coding AI, terutama Claude Code, untuk mempercepat penulisan kode dan tes; setiap commit yang dibantu diberi tanda. Ide, alur human-in-the-loop dan keputusan produk berasal dari tim, dan kami memeriksa hasilnya. Di dalam aplikasi, satu-satunya GenAI adalah model bahasa kecil yang berjalan lokal di OpenVINO untuk draf usulan; angkanya diisi kode dan draf wajib disetujui pejabat."

## Ditulis atau ditinjau manusia (isi oleh tim)
| Modul | Penulis/peninjau | Catatan |
|---|---|---|
| Rumus PINN-2 & asumsi (inference/app/diagnose.py, decide.py) | | |
| Kalkulator kewajaran & buku harga (config/prices) | | |
| Data instansi (config/authorities) | | |
| Teks publik & caption | | |

Catatan: persentase commit bukan ukuran kontribusi intelektual; keputusan desain, data lapangan, wawancara dan verifikasi sumber dilakukan tim.
`;
fs.writeFileSync("docs/GENAI_DISCLOSURE.md", md);
console.log(`commits ${commits.length}, assisted ${assisted.length} (${pct}%)`);
