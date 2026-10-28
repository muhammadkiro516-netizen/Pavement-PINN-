/**
 * Real comments on a report (GET/POST /api/workflow/reports/:id/comments). Nothing is generated:
 * an empty thread says so. Staff can leave staff-only notes that citizens do not see.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { apiUrl } from '../../services/api/client';
import { relativeTime } from '../workflow/notifications';

interface CommentItem {
  id: string;
  at: string;
  authorName: string;
  authorRole: string;
  text: string;
  visibility: 'PUBLIC' | 'STAFF';
}

const ROLE_TONE: Record<string, string> = { PUBLIC_REPORTER: '#4C8DFF', FIELD_ENGINEER: '#FFD60A', OPERATIONS_MANAGER: '#FF6B2C' };

export const CommentThread: React.FC<{ reportId: string; canWrite: boolean; isStaff: boolean }> = ({ reportId, canWrite, isStaff }) => {
  const [items, setItems] = useState<CommentItem[]>([]);
  const [text, setText] = useState('');
  const [staffOnly, setStaffOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const path = apiUrl(`/api/workflow/reports/${encodeURIComponent(reportId)}/comments`);

  const load = useCallback(async () => {
    const res = await fetch(path, { credentials: 'same-origin', cache: 'no-store' }).catch(() => null);
    const json = res ? await res.json().catch(() => null) : null;
    if (json?.success) setItems(json.items as CommentItem[]);
  }, [path]);
  useEffect(() => void load(), [load]);

  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.trim(), visibility: staffOnly ? 'STAFF' : 'PUBLIC' })
    }).catch(() => null);
    const json = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    if (!res || !json?.success) {
      setError(json?.error?.message ?? (res?.status === 429 ? 'Terlalu banyak komentar. Coba lagi nanti.' : 'Komentar belum terkirim.'));
      return;
    }
    setText('');
    setItems((prev) => [...prev, json.comment as CommentItem]);
  };

  return (
    <div className="space-y-3 border-t border-white/10 pt-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-200">Komentar</span>
        <span className="text-xs text-slate-400">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-slate-400">Belum ada komentar. Jadilah yang pertama memberi kabar terbaru tentang lokasi ini.</p>
      ) : (
        <ul className="max-h-64 space-y-3 overflow-y-auto pr-1">
          {items.map((c) => (
            <li key={c.id} className="flex gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-extrabold text-[#0B0D10]" style={{ background: ROLE_TONE[c.authorRole] ?? '#A1A1AA' }}>
                {c.authorName.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="text-xs">
                  <span className="font-bold text-slate-100">{c.authorName}</span>
                  <span className="text-slate-400"> · {relativeTime(c.at)}</span>
                  {c.visibility === 'STAFF' && <span className="ml-1.5 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-bold text-slate-300">internal</span>}
                </p>
                <p className="whitespace-pre-wrap break-words text-sm text-slate-200">{c.text}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <div className="space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 500))}
            rows={2}
            placeholder="Tulis kabar terbaru, misalnya: lubang makin lebar setelah hujan"
            className="w-full resize-none rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
          />
          <div className="flex items-center gap-3">
            {isStaff && (
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-300">
                <input type="checkbox" checked={staffOnly} onChange={(e) => setStaffOnly(e.target.checked)} /> Catatan internal
              </label>
            )}
            <span className="text-[11px] text-slate-500">{text.length}/500</span>
            <button type="button" onClick={() => void send()} disabled={busy || !text.trim()}
              className="ml-auto cursor-pointer rounded-full bg-amber-400 px-4 py-1.5 text-xs font-bold text-slate-950 disabled:opacity-40">
              {busy ? 'Mengirim…' : 'Kirim'}
            </button>
          </div>
          {error && <p className="text-xs text-rose-300">{error}</p>}
        </div>
      )}
    </div>
  );
};
