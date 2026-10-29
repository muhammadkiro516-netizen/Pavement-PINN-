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
  <div className="h-full w-full overflow-y-auto bg-[#0B0D10] text-[#FFFFFF]">
    <div className="mx-auto w-full max-w-2xl px-4 pb-32 pt-6 lg:max-w-6xl lg:px-8">
      <div className="mb-5 flex items-end justify-between gap-3 pp-rise">
        <div className="min-w-0">
          <h1 className="text-[28px] font-extrabold leading-tight tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-[15px] text-[#A1A1AA]">{subtitle}</p>}
        </div>
        {action}
      </div>
      {/* Phone: one column. Desktop: cards flow into two balanced columns. */}
      <div className="space-y-3 lg:columns-2 lg:gap-4 lg:space-y-0 lg:[&>*]:mb-4 lg:[&>*]:break-inside-avoid">{children}</div>
    </div>
  </div>
);

export const SnapCard: React.FC<{ children: React.ReactNode; onClick?: () => void; className?: string }> = ({ children, onClick, className = '' }) => {
  const base = `pp-rise w-full rounded-3xl border border-[#2A2F37] bg-[#15181D] p-4 text-left shadow-[0_1px_2px_rgba(0,0,0,0.3),0_8px_24px_-12px_rgba(0,0,0,0.5)] ${className}`;
  return onClick ? (
    <button type="button" onClick={onClick} className={`${base} cursor-pointer transition hover:-translate-y-0.5 hover:shadow-[0_12px_32px_-12px_rgba(20,99,255,0.25)] active:scale-[0.99]`}>
      {children}
    </button>
  ) : (
    <div className={base}>{children}</div>
  );
};

const PILL_TONES = {
  blue: 'bg-[#1E2229] text-[#FFD60A]',
  orange: 'bg-[#3A2414] text-[#D9600C]',
  green: 'bg-[#0F2A1B] text-[#4ADE80]',
  red: 'bg-[#3A1416] text-[#FF6B6B]',
  grey: 'bg-[#1E2229] text-[#A1A1AA]'
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
        ? 'bg-[#FFD60A] text-[#000000] shadow-[0_8px_20px_-8px_rgba(255,225,77,0.45)] hover:bg-[#FFD60A]'
        : variant === 'accent'
          ? 'bg-[#FF6B2C] text-[#FFFFFF] shadow-[0_8px_20px_-8px_rgba(255,122,26,0.6)] hover:bg-[#F06A0A]'
          : 'bg-[#1E2229] text-[#FFFFFF] hover:bg-[#3A3A3C]'
    } ${className}`}
  />
);

export const SnapInput: React.FC<React.InputHTMLAttributes<HTMLInputElement> & { label: string }> = ({ label, id, ...props }) => (
  <label className="block" htmlFor={id}>
    <span className="mb-1.5 block text-xs font-bold text-[#A1A1AA]">{label}</span>
    <input
      id={id}
      {...props}
      className="h-12 w-full rounded-2xl border border-[#2A2F37] bg-[#0B0D10] px-4 text-[15px] text-[#FFFFFF] placeholder:text-[#6E6E73] focus:border-[#FFD60A] focus:bg-[#1E2229] focus:outline-none"
    />
  </label>
);

export const Empty: React.FC<{ icon: React.ReactNode; title: string; text: string; action?: React.ReactNode }> = ({ icon, title, text, action }) => (
  <div className="pp-rise flex flex-col items-center rounded-3xl border border-dashed border-[#3A3A3C] bg-[#15181D] px-6 py-10 text-center">
    <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#1E2229] text-[#FFD60A]">{icon}</div>
    <p className="text-lg font-extrabold">{title}</p>
    <p className="mt-1 max-w-sm text-[15px] text-[#A1A1AA]">{text}</p>
    {action && <div className="mt-4">{action}</div>}
  </div>
);

/** A number with a one-line plain-language label (statistics, evidence). */
export const Stat: React.FC<{ value: React.ReactNode; label: string; hint?: string }> = ({ value, label, hint }) => (
  <div className="pp-rise rounded-3xl border border-[#2A2F37] bg-[#15181D] p-4">
    <p className="text-3xl font-extrabold tracking-tight text-[#FFD60A]">{value}</p>
    <p className="mt-1 text-sm font-bold">{label}</p>
    {hint && <p className="mt-0.5 text-xs text-[#A1A1AA]">{hint}</p>}
  </div>
);
