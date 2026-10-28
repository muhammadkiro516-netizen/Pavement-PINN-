/**
 * Koordinator "Pusat Kendali": the few numbers that decide what to do next (who is waiting,
 * what is overdue, where a warning sign is missing) and the agency's own response score.
 * Everything comes from controlSummary() over recorded history; nothing is sample data.
 */
import React, { useMemo } from 'react';
import { controlSummary, FIRST_RESPONSE_TARGET_H } from '../../domain/workflow/control';
import type { ReportCase } from '../../domain/workflow/model';

const Tile: React.FC<{ value: React.ReactNode; label: string; tone?: string; hint?: string }> = ({ value, label, tone = '#FFFFFF', hint }) => (
  <div className="rounded-2xl bg-[#FFFFFF]/[0.04] px-3 py-2.5" title={hint}>
    <p className="tabular text-2xl font-extrabold leading-none" style={{ color: tone }}>{value}</p>
    <p className="mt-1 text-[11px] font-semibold leading-tight text-[#FFFFFF]/55">{label}</p>
  </div>
);

/** Ring that drains as the on-time share falls. */
const ScoreRing: React.FC<{ pct: number | null }> = ({ pct }) => {
  const r = 26;
  const c = 2 * Math.PI * r;
  const v = pct ?? 0;
  const tone = pct === null ? '#5B6270' : v >= 80 ? '#2BD67B' : v >= 50 ? '#FFD60A' : '#FF4D5E';
  return (
    <svg width="68" height="68" viewBox="0 0 68 68" aria-hidden>
      <circle cx="34" cy="34" r={r} fill="none" stroke="#FFFFFF" strokeOpacity="0.08" strokeWidth="7" />
      <circle cx="34" cy="34" r={r} fill="none" stroke={tone} strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} transform="rotate(-90 34 34)" style={{ transition: 'stroke-dashoffset 1s ease' }} />
      <text x="34" y="39" textAnchor="middle" fontSize="15" fontWeight="800" fill="#FFFFFF">{pct === null ? '–' : `${pct}%`}</text>
    </svg>
  );
};

export const ControlCenter: React.FC<{ cases: ReportCase[] }> = ({ cases }) => {
  const s = useMemo(() => controlSummary(cases), [cases]);
  const hours = s.medianFirstResponseH;
  const overdue = s.overdueInspections + s.overdueWork;
  return (
    <section className="pp-rise mx-4 mt-4 rounded-[28px] border border-[#FFFFFF]/8 bg-gradient-to-br from-[#1E2229] to-[#15181D] p-4 text-[#FFFFFF]" aria-label="Pusat Kendali">
      <div className="flex items-center gap-4">
        <ScoreRing pct={s.onTimePct} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-wider text-[#FFFFFF]/50">Skor Respons</p>
          <p className="text-[15px] font-extrabold leading-snug">
            {s.onTimePct === null ? 'Belum ada laporan yang ditanggapi' : `${s.onTimePct}% laporan ditanggapi ≤ ${FIRST_RESPONSE_TARGET_H / 24}×24 jam`}
          </p>
          <p className="mt-0.5 text-[11px] text-[#FFFFFF]/50">
            Median tanggapan {hours === null ? '–' : hours < 24 ? `${hours.toFixed(1)} jam` : `${(hours / 24).toFixed(1)} hari`} · median perbaikan{' '}
            {s.medianResolveDays === null ? '–' : `${s.medianResolveDays.toFixed(1)} hari`}. Target internal, bukan batas hukum.
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Tile value={s.awaitingFirstResponse} label={`belum ditanggapi${s.pastResponseTarget ? ` · ${s.pastResponseTarget} lewat target` : ''}`} tone={s.pastResponseTarget ? '#FF4D5E' : '#FFFFFF'} />
        <Tile value={overdue} label="inspeksi / pekerjaan lewat tenggat" tone={overdue ? '#FF4D5E' : '#FFFFFF'} />
        <Tile value={s.needsSign} label="rusak berat tanpa rambu" tone={s.needsSign ? '#FF6B2C' : '#FFFFFF'} hint="UU 22/2009 Ps. 24 ayat 2: kerusakan yang belum diperbaiki wajib diberi tanda" />
      </div>
      {s.byAgency.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-[#FFFFFF]/45">Laporan terbuka per instansi</p>
          <div className="space-y-1.5">
            {s.byAgency.slice(0, 5).map((a) => (
              <div key={a.name} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate text-[#FFFFFF]/80">{a.name}</span>
                {a.lowConfidence > 0 && (
                  <span className="rounded-full bg-[#FFD60A]/12 px-2 py-0.5 text-[10px] font-bold text-[#FFD60A]" title="Penentuan instansi berkeyakinan rendah: cek status jalan, alihkan bila perlu">
                    {a.lowConfidence} perlu dicek
                  </span>
                )}
                <span className="tabular w-6 text-right font-extrabold">{a.open}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};
