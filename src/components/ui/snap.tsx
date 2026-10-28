/**
 * Small UI kit for the lean app (docs/LEAN_PLAN.md "UI"): Snapchat-like layout language —
 * full-bleed screens, big rounded cards, bold short text — in our own bright palette
 * (components/ui/brand.tsx). No icon library: glyphs are drawn in brand.tsx.
 */
import React from 'react';

export const SnapPage: React.FC<{ title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }> = ({
  title,
  subtitle,
  action,
  children
}) => (
  <div className="h-full w-full overflow-y-auto bg-[#F4F7FC] text-[#0E1B2C]">
    <div className="mx-auto w-full max-w-2xl px-4 pb-32 pt-6">
      <div className="mb-5 flex items-end justify-between gap-3 pp-rise">
        <div className="min-w-0">
          <h1 className="text-[28px] font-extrabold leading-tight tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-[15px] text-[#5B6B7F]">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  </div>
);

export const SnapCard: React.FC<{ children: React.ReactNode; onClick?: () => void; className?: string }> = ({ children, onClick, className = '' }) => {
  const base = `pp-rise w-full rounded-3xl border border-[#E3E8EF] bg-[#FFFFFF] p-4 text-left shadow-[0_1px_2px_rgba(14,27,44,0.04),0_8px_24px_-12px_rgba(14,27,44,0.12)] ${className}`;
  return onClick ? (
    <button type="button" onClick={onClick} className={`${base} cursor-pointer transition hover:-translate-y-0.5 hover:shadow-[0_12px_32px_-12px_rgba(20,99,255,0.25)] active:scale-[0.99]`}>
      {children}
    </button>
  ) : (
    <div className={base}>{children}</div>
  );
};

const PILL_TONES = {
  blue: 'bg-[#E8F0FF] text-[#1463FF]',
  orange: 'bg-[#FFF1E6] text-[#D9600C]',
  green: 'bg-[#E6F7EE] text-[#0E8A43]',
  red: 'bg-[#FDECEC] text-[#C53035]',
  grey: 'bg-[#EEF2F7] text-[#5B6B7F]'
} as const;

export const Pill: React.FC<{ tone?: keyof typeof PILL_TONES; children: React.ReactNode }> = ({ tone = 'grey', children }) => (
  <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${PILL_TONES[tone]}`}>{children}</span>
);

export const SnapButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'accent' | 'ghost' }> = ({
  variant = 'primary',
  className = '',
  ...props
}) => (
  <button
    {...props}
    className={`inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-full px-5 text-sm font-extrabold transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 ${
      variant === 'primary'
        ? 'bg-[#1463FF] text-[#FFFFFF] shadow-[0_8px_20px_-8px_rgba(20,99,255,0.6)] hover:bg-[#0F55E0]'
        : variant === 'accent'
          ? 'bg-[#FF7A1A] text-[#FFFFFF] shadow-[0_8px_20px_-8px_rgba(255,122,26,0.6)] hover:bg-[#F06A0A]'
          : 'bg-[#EEF2F7] text-[#0E1B2C] hover:bg-[#E3E8EF]'
    } ${className}`}
  />
);

export const SnapInput: React.FC<React.InputHTMLAttributes<HTMLInputElement> & { label: string }> = ({ label, id, ...props }) => (
  <label className="block" htmlFor={id}>
    <span className="mb-1.5 block text-xs font-bold text-[#5B6B7F]">{label}</span>
    <input
      id={id}
      {...props}
      className="h-12 w-full rounded-2xl border border-[#E3E8EF] bg-[#F4F7FC] px-4 text-[15px] text-[#0E1B2C] placeholder:text-[#9AA7B8] focus:border-[#1463FF] focus:bg-[#FFFFFF] focus:outline-none"
    />
  </label>
);

export const Empty: React.FC<{ icon: React.ReactNode; title: string; text: string; action?: React.ReactNode }> = ({ icon, title, text, action }) => (
  <div className="pp-rise flex flex-col items-center rounded-3xl border border-dashed border-[#CFD8E3] bg-[#FFFFFF] px-6 py-10 text-center">
    <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#E8F0FF] text-[#1463FF]">{icon}</div>
    <p className="text-lg font-extrabold">{title}</p>
    <p className="mt-1 max-w-sm text-[15px] text-[#5B6B7F]">{text}</p>
    {action && <div className="mt-4">{action}</div>}
  </div>
);

/** A number with a one-line plain-language label (statistics, evidence). */
export const Stat: React.FC<{ value: React.ReactNode; label: string; hint?: string }> = ({ value, label, hint }) => (
  <div className="pp-rise rounded-3xl border border-[#E3E8EF] bg-[#FFFFFF] p-4">
    <p className="text-3xl font-extrabold tracking-tight text-[#1463FF]">{value}</p>
    <p className="mt-1 text-sm font-bold">{label}</p>
    {hint && <p className="mt-0.5 text-xs text-[#5B6B7F]">{hint}</p>}
  </div>
);
