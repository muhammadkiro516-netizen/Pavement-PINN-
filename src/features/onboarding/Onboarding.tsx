/** SPEC M9: three skippable onboarding screens (Lapor · Kawal · Audit), shown once per device. */
import React, { useState } from 'react';
import { Pavi } from '../../components/brand/Pavi';

const KEY = 'pp-onboarded';
const SLIDES = [
  { mood: 'scan' as const, title: 'Lapor', text: 'Potret jalan rusak di tempat Anda berdiri. AI mengenali kerusakannya dan meneruskan laporan ke instansi yang berwenang.' },
  { mood: 'found' as const, title: 'Kawal', text: 'Lihat berapa hari laporan menunggu dan alasannya. Bagikan kartu story agar laporan tidak terlupakan.' },
  { mood: 'celebrate' as const, title: 'Audit', text: 'Setelah diperbaiki, beri tahu kami 1, 3 dan 6 bulan kemudian. Dari situ terlihat perbaikan mana yang awet.' }
];

export function shouldOnboard(): boolean {
  try {
    return localStorage.getItem(KEY) !== '1';
  } catch {
    return false;
  }
}

export const Onboarding: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const [i, setI] = useState(0);
  const finish = () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* shown again next time */
    }
    onDone();
  };
  const s = SLIDES[i];
  return (
    <div className="fixed inset-0 z-[4000] flex flex-col items-center justify-between bg-[#0B0D10] px-6 py-10 text-center text-[#FFFFFF]" role="dialog" aria-label="Pengenalan aplikasi">
      <button type="button" onClick={finish} className="self-end min-h-10 cursor-pointer px-3 text-sm text-[#FFFFFF]/60">Lewati</button>
      <div key={i} className="pp-rise flex flex-col items-center gap-5">
        <Pavi size={130} mood={s.mood} />
        <p className="text-3xl font-extrabold text-[#FFD60A]">{s.title}</p>
        <p className="max-w-xs text-base text-[#FFFFFF]/80">{s.text}</p>
      </div>
      <div className="w-full max-w-xs space-y-4">
        <div className="flex justify-center gap-2">{SLIDES.map((_, k) => <span key={k} className={`h-2 rounded-full transition-all ${k === i ? 'w-6 bg-[#FFD60A]' : 'w-2 bg-[#FFFFFF]/25'}`} />)}</div>
        <button type="button" onClick={() => (i < SLIDES.length - 1 ? setI(i + 1) : finish())} className="min-h-12 w-full cursor-pointer rounded-2xl bg-[#FFD60A] text-base font-extrabold text-[#0B0D10]">
          {i < SLIDES.length - 1 ? 'Lanjut' : 'Mulai'}
        </button>
      </div>
    </div>
  );
};
