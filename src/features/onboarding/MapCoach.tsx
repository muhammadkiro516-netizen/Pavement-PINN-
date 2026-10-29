/** First-run coach marks on the map (SPEC 5f): three short tips, shown once per device, skippable. */
import React, { useState } from 'react';
import { Pavi } from '../../components/brand/Pavi';
import { readPavi } from '../../components/brand/paviPrefs';

const KEY = 'pp-map-coach';
const TIPS = [
  { pos: 'top-[150px] left-4', title: 'Filter kerusakan', text: 'Tampilkan hanya lubang, retak, genangan, atau yang sudah ada rambu.' },
  { pos: 'bottom-[250px] left-4', title: 'Radar Bahaya', text: 'Nyalakan saat berkendara: HP bergetar ±150 m sebelum bahaya yang sudah diverifikasi.' },
  { pos: 'bottom-[110px] left-1/2 -translate-x-1/2', title: 'Lapor di sini', text: 'Tombol kamera oranye: potret kerusakan di tempat Anda berdiri, AI langsung mengenalinya.' }
];

function seen(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return true;
  }
}

export const MapCoach: React.FC = () => {
  const [i, setI] = useState(() => (seen() ? -1 : 0));
  if (i < 0) return null;
  const done = () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* shown again next time */
    }
    setI(-1);
  };
  const t = TIPS[i];
  const pv = readPavi();
  return (
    <div className="absolute inset-0 z-[60] bg-black/55" onClick={done} role="dialog" aria-label="Panduan peta">
      <div className={`pp-rise absolute ${t.pos} flex max-w-[300px] items-end gap-2`} onClick={(e) => e.stopPropagation()}>
        <Pavi size={54} mood="found" helmet={pv.helmet} vest={pv.vest} />
        <div className="rounded-3xl rounded-bl-md bg-[#FFD60A] p-3 text-[#0B0D10] shadow-xl">
          <p className="text-sm font-extrabold">{t.title}</p>
          <p className="text-xs">{t.text}</p>
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-[10px] font-bold">{i + 1}/{TIPS.length}</span>
            <div className="flex gap-2">
              <button type="button" onClick={done} className="min-h-9 cursor-pointer px-2 text-xs font-bold">Lewati</button>
              <button type="button" onClick={() => (i < TIPS.length - 1 ? setI(i + 1) : done())} className="min-h-9 cursor-pointer rounded-full bg-[#0B0D10] px-3 text-xs font-extrabold text-[#FFD60A]">
                {i < TIPS.length - 1 ? 'Lanjut' : 'Mengerti'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
