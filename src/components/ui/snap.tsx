/**
 * Small UI kit for the lean app (docs/LEAN_PLAN.md "UI"): Snapchat-like layout language —
 * black canvas, one bright yellow accent, big rounded cards, bold short text.
 * Our own colours and logo; nothing of Snapchat's brand is used.
 */
import React from 'react';

export const BRAND_YELLOW = '#FFE14D';

export const SnapPage: React.FC<{ title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }> = ({
  title,
  subtitle,
  action,
  children
}) => (
  <div className="h-full w-full overflow-y-auto bg-[#0B0B0C] text-white">
    <div className="mx-auto w-full max-w-2xl px-4 pb-32 pt-5">
      <div className="mb-5 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[28px] font-extrabold leading-tight tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-white/60">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  </div>
);

export const SnapCard: React.FC<{ children: React.ReactNode; onClick?: () => void; className?: string }> = ({ children, onClick, className = '' }) => {
  const base = `w-full rounded-3xl bg-[#1A1A1C] p-4 text-left ${className}`;
  return onClick ? (
    <button type="button" onClick={onClick} className={`${base} cursor-pointer transition active:scale-[0.98] hover:bg-[#222225]`}>
      {children}
    </button>
  ) : (
    <div className={base}>{children}</div>
  );
};

const PILL_TONES = {
  yellow: 'bg-[#FFE14D] text-black',
  green: 'bg-emerald-400/15 text-emerald-300',
  red: 'bg-rose-500/15 text-rose-300',
  blue: 'bg-sky-400/15 text-sky-300',
  grey: 'bg-white/10 text-white/70'
} as const;

export const Pill: React.FC<{ tone?: keyof typeof PILL_TONES; children: React.ReactNode }> = ({ tone = 'grey', children }) => (
  <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${PILL_TONES[tone]}`}>{children}</span>
);

export const SnapButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' }> = ({
  variant = 'primary',
  className = '',
  ...props
}) => (
  <button
    {...props}
    className={`inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-full px-5 text-sm font-extrabold transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 ${
      variant === 'primary' ? 'bg-[#FFE14D] text-black hover:brightness-95' : 'bg-white/10 text-white hover:bg-white/15'
    } ${className}`}
  />
);

export const SnapInput: React.FC<React.InputHTMLAttributes<HTMLInputElement> & { label: string }> = ({ label, id, ...props }) => (
  <label className="block" htmlFor={id}>
    <span className="mb-1.5 block text-xs font-bold text-white/70">{label}</span>
    <input
      id={id}
      {...props}
      className="h-12 w-full rounded-2xl border border-white/10 bg-[#1A1A1C] px-4 text-[15px] text-white placeholder:text-white/30 focus:border-[#FFE14D] focus:outline-none"
    />
  </label>
);

export const Empty: React.FC<{ icon: React.ReactNode; title: string; text: string; action?: React.ReactNode }> = ({ icon, title, text, action }) => (
  <div className="flex flex-col items-center rounded-3xl bg-[#1A1A1C] px-6 py-10 text-center">
    <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[#FFE14D] text-black">{icon}</div>
    <p className="text-lg font-extrabold">{title}</p>
    <p className="mt-1 max-w-sm text-sm text-white/60">{text}</p>
    {action && <div className="mt-4">{action}</div>}
  </div>
);

/** A number with a one-line plain-language label (statistics, evidence). */
export const Stat: React.FC<{ value: React.ReactNode; label: string; hint?: string }> = ({ value, label, hint }) => (
  <div className="rounded-3xl bg-[#1A1A1C] p-4">
    <p className="text-3xl font-extrabold tracking-tight">{value}</p>
    <p className="mt-1 text-sm font-bold text-white/80">{label}</p>
    {hint && <p className="mt-0.5 text-xs text-white/50">{hint}</p>}
  </div>
);
