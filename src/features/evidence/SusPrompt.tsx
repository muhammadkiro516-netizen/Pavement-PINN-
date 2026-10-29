/**
 * SPEC M10: System Usability Scale (10 items, Indonesian), optional, offered from the third use.
 * Answers go to the server (one per account) for measurements/sus.json.
 */
import React, { useEffect, useState } from 'react';
import { apiUrl } from '../../services/api/client';

const ITEMS = [
  'Saya ingin sering menggunakan aplikasi ini.',
  'Aplikasi ini terasa rumit tanpa alasan.',
  'Aplikasi ini mudah digunakan.',
  'Saya butuh bantuan orang teknis untuk bisa memakainya.',
  'Fitur-fitur di aplikasi ini terhubung dengan baik.',
  'Ada terlalu banyak hal yang tidak konsisten.',
  'Kebanyakan orang akan cepat belajar memakainya.',
  'Aplikasi ini terasa merepotkan.',
  'Saya merasa yakin saat memakainya.',
  'Saya perlu belajar banyak hal sebelum bisa memakainya.'
];
const KEY = 'pp-sus';

function read(): { uses: number; done: boolean } {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '') as { uses: number; done: boolean };
  } catch {
    return { uses: 0, done: false };
  }
}
function write(v: { uses: number; done: boolean }) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* private mode: the prompt simply shows again */
  }
}

export const SusPrompt: React.FC = () => {
  const [state, setState] = useState(read);
  const [open, setOpen] = useState(false);
  const [a, setA] = useState<number[]>(Array(10).fill(0));
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    const next = { ...state, uses: state.uses + 1 };
    write(next);
    setState(next);
  }, []);
  if (state.done || state.uses < 3) return null;
  const dismiss = () => { const v = { ...state, done: true }; write(v); setState(v); };
  const send = async () => {
    const r = await fetch(apiUrl('/api/sus'), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers: a }) });
    const j = await r.json().catch(() => null);
    if (j?.success) { setMsg('Terima kasih! Masukan Anda membantu memperbaiki aplikasi.'); setTimeout(dismiss, 1500); } else setMsg(j?.error?.message ?? 'Gagal mengirim.');
  };
  return (
    <div className="rounded-[24px] border border-[#4C8DFF]/30 bg-[#4C8DFF]/[0.06] p-4 text-[#FFFFFF]">
      <p className="font-extrabold">Bantu kami: 10 pertanyaan singkat (±1 menit)</p>
      <p className="text-xs text-[#FFFFFF]/60">Opsional dan anonim. Dipakai untuk mengukur kemudahan aplikasi (skala SUS).</p>
      {!open ? (
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => setOpen(true)} className="min-h-10 flex-1 cursor-pointer rounded-xl bg-[#4C8DFF] text-sm font-bold text-[#0B0D10]">Isi sekarang</button>
          <button type="button" onClick={dismiss} className="min-h-10 flex-1 cursor-pointer rounded-xl bg-[#FFFFFF]/8 text-sm">Lewati</button>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {ITEMS.map((q, i) => (
            <div key={q}>
              <p className="text-sm">{i + 1}. {q}</p>
              <div className="mt-1 flex items-center gap-1 text-[10px] text-[#FFFFFF]/50">
                <span>Sangat tidak setuju</span>
                {[1, 2, 3, 4, 5].map((v) => (
                  <button key={v} type="button" aria-label={`${v}`} onClick={() => setA((x) => x.map((y, j) => (j === i ? v : y)))} className={`h-10 w-10 cursor-pointer rounded-full text-sm font-bold ${a[i] === v ? 'bg-[#4C8DFF] text-[#0B0D10]' : 'bg-[#FFFFFF]/8 text-[#FFFFFF]'}`}>{v}</button>
                ))}
                <span>Sangat setuju</span>
              </div>
            </div>
          ))}
          <button type="button" disabled={a.some((v) => v === 0)} onClick={() => void send()} className="min-h-11 w-full cursor-pointer rounded-xl bg-[#4C8DFF] font-bold text-[#0B0D10] disabled:opacity-40">Kirim</button>
          {msg && <p className="text-xs text-[#2BD67B]">{msg}</p>}
        </div>
      )}
    </div>
  );
};
