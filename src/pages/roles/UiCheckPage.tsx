/** Route /ui-check/ — every screen per role, for quick review. Only in the dev server; see pageRegistry. */
import React from 'react';

const BASE = import.meta.env.BASE_URL;

const SCREENS: { role: string; links: [string, string][] }[] = [
  { role: 'Warga', links: [['Beranda', 'beranda/'], ['Peta dan lapor', 'peta/'], ['Kawal', 'laporanku/'], ['Aman', 'aman/'], ['Notifikasi', 'notifikasi/'], ['Profil', 'profil/']] },
  { role: 'Petugas, Koordinator, Penyetuju, Regu, Pengawas, Auditor, Pimpinan, Admin', links: [['Masuk', 'login/'], ['Layar kerja (sesuai akun)', 'kerja/']] },
  { role: 'Terbuka untuk umum', links: [['Kenapa penting', 'why/'], ['Tur', 'tour/'], ['Periksa keaslian', 'verify/'], ['Bukti', 'bukti/']] }
];

export const UiCheckPage: React.FC<{ params: Record<string, string> }> = () => (
  <main className="min-h-full bg-[#0B0D10] px-5 py-8 text-white">
    <h1 className="text-2xl font-extrabold">Semua layar per peran</h1>
    {SCREENS.map((s) => (
      <section key={s.role} className="mt-6">
        <h2 className="text-sm font-bold text-[#FFD60A]">{s.role}</h2>
        <ul className="mt-2 space-y-1">
          {s.links.map(([label, path]) => <li key={path}><a className="underline" href={`${BASE}${path}`}>{label}</a></li>)}
        </ul>
      </section>
    ))}
  </main>
);
