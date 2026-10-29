/**
 * Shared workspace components. Colour meaning is fixed (spec/02 §1): green valid, amber
 * review/assumed, red failed/missing, grey n/a, violet simulated/sample, blue running.
 */
import React, { useState } from 'react';
import { Info, CircleSlash } from 'lucide-react';
import type { InputSource, Measured, ResultProvenance, ScaleStatus, StageStatus, ValidationVerdict } from '../../../domain/workspace/types';
import { displayState } from '../../../domain/workspace/measured';
import { useWsT } from '../i18n';

export type Tone = 'green' | 'amber' | 'red' | 'grey' | 'violet' | 'blue';

const TONE: Record<Tone, string> = {
  green: 'bg-[#123524] text-[#6EE7A8] border-[#1F5C3D]',
  amber: 'bg-[#3A2C0B] text-[#F5C451] border-[#5C4512]',
  red: 'bg-[#3B1418] text-[#F59AA3] border-[#5E1F26]',
  grey: 'bg-[#1A2230] text-[#9AA8BC] border-[#273244]',
  violet: 'bg-[#2A1C46] text-[#C7B3FF] border-[#41306B]',
  blue: 'bg-[#0F2A4A] text-[#8CC4FF] border-[#1D4573]'
};

export const STAGE_TONE: Record<StageStatus | 'not_started', Tone> = {
  completed: 'green',
  needs_review: 'amber',
  failed: 'red',
  blocked: 'grey',
  stale: 'amber',
  queued: 'blue',
  running: 'blue',
  not_started: 'grey'
};

export const PROVENANCE_TONE: Record<ResultProvenance, Tone> = {
  validated: 'green',
  manually_measured: 'green',
  corrected: 'amber',
  provisional: 'amber',
  simulated: 'violet',
  not_available: 'grey'
};

export const SOURCE_TONE: Record<InputSource, Tone> = { MEASURED: 'green', DOCUMENT: 'green', DEFAULT: 'amber', ASSUMED: 'amber', MISSING: 'red' };
export const VERDICT_TONE: Record<ValidationVerdict, Tone> = { PASS: 'green', REVIEW: 'amber', FAIL: 'red', NOT_VALIDATED: 'grey' };

export const StatusBadge: React.FC<{ tone: Tone; children: React.ReactNode; title?: string; className?: string }> = ({ tone, children, title, className = '' }) => (
  <span title={title} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap ${TONE[tone]} ${className}`}>
    {children}
  </span>
);

const PROVENANCE_LABEL: Record<ResultProvenance, string> = {
  provisional: 'provisional',
  simulated: 'simulated',
  manually_measured: 'manual',
  corrected: 'corrected',
  validated: 'validated',
  not_available: 'n/a'
};

/**
 * A measured value: number ± uncertainty + unit + provenance badge + ⓘ source. A null value
 * shows its reason ("belum diukur", "Relative geometry", …) — never a stand-in 0.
 */
export const MeasuredValue: React.FC<{ m: Measured | null | undefined; scale?: ScaleStatus; digits?: number; compact?: boolean }> = ({ m, scale = 'valid', digits = 1, compact }) => {
  const [open, setOpen] = useState(false);
  const s = displayState(m, scale);
  const unit = s.kind === 'value' ? (s.unit === 'm2' ? 'm²' : s.unit) : '';
  return (
    <span className="relative inline-flex items-center gap-1.5 justify-end text-right" data-testid="measured-value">
      {s.kind === 'value' ? (
        <span className="tabular-nums text-[#E6EDF3]">
          {s.value.toLocaleString('id-ID', { maximumFractionDigits: digits, minimumFractionDigits: digits > 0 && Math.abs(s.value) < 10 ? Math.min(digits, 2) : 0 })}
          {s.uncertainty !== null && <span className="text-[#8B9BB0]"> ± {s.uncertainty.toLocaleString('id-ID', { maximumFractionDigits: digits })}</span>}
          {unit && <span className="text-[#8B9BB0]"> {unit}</span>}
        </span>
      ) : (
        <span className="text-[#8B9BB0] italic" data-unavailable="true">{s.reason}</span>
      )}
      {!compact && m && m.value !== null && <StatusBadge tone={PROVENANCE_TONE[m.provenance]}>{PROVENANCE_LABEL[m.provenance]}</StatusBadge>}
      {m && (
        <button type="button" aria-label="Sumber nilai" onClick={() => setOpen((v) => !v)} className="text-[#6B7A90] hover:text-[#E6EDF3]">
          <Info className="h-3.5 w-3.5" />
        </button>
      )}
      {open && m && (
        <span className="absolute right-0 top-6 z-30 w-64 rounded-md border border-[#273244] bg-[#0B121A] p-2 text-left text-[11px] text-[#C9D4E3] shadow-xl">
          <span className="block">Tahap: {m.source.stage}</span>
          <span className="block">Metode: {m.source.method}</span>
          {m.source.modelVersion && <span className="block">Versi: {m.source.modelVersion}</span>}
          {m.source.runId && <span className="block">Run: {m.source.runId}</span>}
          <span className="block">Provenance: {m.provenance}</span>
        </span>
      )}
    </span>
  );
};

export const UnavailableCard: React.FC<{ title?: string; reason: string; action?: { label: string; onClick?: () => void; disabled?: boolean; title?: string } }> = ({ title, reason, action }) => (
  <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[#273244] bg-[#0B121A] p-8 text-center" data-testid="unavailable-card">
    <CircleSlash className="h-6 w-6 text-[#6B7A90]" />
    {title && <div className="text-sm font-semibold text-[#E6EDF3]">{title}</div>}
    <div className="max-w-md text-[13px] text-[#9AA8BC]">{reason}</div>
    {action && (
      <button type="button" onClick={action.onClick} disabled={action.disabled} title={action.title} className="rounded-lg border border-[#5C4512] bg-[#FFD60A] px-3 py-1.5 text-[12px] font-semibold text-[#0A0F14] disabled:cursor-not-allowed disabled:opacity-40">
        {action.label}
      </button>
    )}
  </div>
);

// ---- Colour scales -----------------------------------------------------------------------

/** Turbo colormap (Google, Apache-2.0) polynomial approximation; t in [0, 1]. */
export function turbo(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  const r = 34.61 + x * (1172.33 - x * (10793.56 - x * (33300.12 - x * (38394.49 - x * 14825.05))));
  const g = 23.31 + x * (557.33 + x * (1225.33 - x * (3574.96 - x * (1073.77 + x * 707.56))));
  const b = 27.2 + x * (3211.1 - x * (15327.97 - x * (27814 - x * (22569.18 - x * 6838.66))));
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `rgb(${c(r)},${c(g)},${c(b)})`;
}

/** Diverging RdYlBu centred on 0: v in [-1, 1] (negative blue, positive red). */
export function rdylbu(v: number): string {
  const stops: Array<[number, [number, number, number]]> = [
    [-1, [49, 54, 149]],
    [-0.5, [116, 173, 209]],
    [0, [255, 255, 191]],
    [0.5, [244, 109, 67]],
    [1, [165, 0, 38]]
  ];
  const x = Math.max(-1, Math.min(1, v));
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i];
    const [b, cb] = stops[i + 1];
    if (x <= b) {
      const f = (x - a) / (b - a);
      return `rgb(${ca.map((c, k) => Math.round(c + f * (cb[k] - c))).join(',')})`;
    }
  }
  return 'rgb(165,0,38)';
}

export const ColorLegend: React.FC<{ unit: string; min: number; max: number; scale: 'turbo' | 'diverging'; label?: string; reversed?: boolean }> = ({ unit, min, max, scale, label, reversed }) => {
  const steps = Array.from({ length: 24 }, (_, i) => i / 23);
  const color = (t: number) => (scale === 'turbo' ? turbo(reversed ? 1 - t : t) : rdylbu(t * 2 - 1));
  const fmt = (v: number) => v.toLocaleString('id-ID', { maximumFractionDigits: Math.abs(max - min) < 5 ? 2 : 0 });
  return (
    <div className="flex items-center gap-2 text-[11px] text-[#9AA8BC]" data-testid="color-legend">
      <span className="tabular-nums">{fmt(min)}</span>
      <span className="flex h-2.5 w-32 overflow-hidden rounded">
        {steps.map((t) => (
          <span key={t} className="h-full flex-1" style={{ background: color(t) }} />
        ))}
      </span>
      <span className="tabular-nums">{fmt(max)}</span>
      <span>{unit}</span>
      {label && <span className="text-[#6B7A90]">· {label}</span>}
    </div>
  );
};

export const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="mt-4 mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8B9BB0]">{children}</div>
);

export const Row: React.FC<{ label: React.ReactNode; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-start justify-between gap-3 border-b border-[#1A2430] py-1.5 text-[13px]">
    <span className="text-[#C9D4E3]">{label}</span>
    <span className="min-w-0 text-right">{children}</span>
  </div>
);

/** Action button. `locked` = the role may not do this (shown disabled with the reason). */
export const ActionButton: React.FC<{ children: React.ReactNode; onClick?: () => void; primary?: boolean; locked?: string | null; testId?: string }> = ({ children, onClick, primary, locked, testId }) => {
  const t = useWsT();
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={locked ? undefined : onClick}
      disabled={!!locked}
      title={locked ?? undefined}
      aria-disabled={!!locked}
      className={`rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        primary ? 'border-[#5C4512] bg-[#FFD60A] text-[#0A0F14] hover:bg-[#F5C451]' : 'border-[#273244] bg-[#0F1720] text-[#C9D4E3] hover:border-[#FFD60A]/60'
      }`}
    >
      {children}
      {locked && <span className="sr-only"> ({t('feOnly')})</span>}
    </button>
  );
};
