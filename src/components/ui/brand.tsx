/**
 * Brand mark and the app's own line glyphs (drawn for PAVEMENT-PINN; no icon library).
 * Palette (docs/LEAN_PLAN.md "UI"): sky-blue primary, traffic-cone orange for reporting,
 * fresh green for "done", deep navy ink on a light blue-white canvas.
 */
import React from 'react';

export const COLORS = {
  canvas: '#F4F7FC',
  surface: '#FFFFFF',
  ink: '#0E1B2C',
  muted: '#5B6B7F',
  line: '#E3E8EF',
  primary: '#1463FF',
  primarySoft: '#E8F0FF',
  accent: '#FF7A1A',
  accentSoft: '#FFF1E6',
  success: '#12A150',
  danger: '#E5484D'
} as const;

/** The mark: a road narrowing to the horizon, with an orange scan dot on the damage. */
export const LogoMark: React.FC<{ size?: number; className?: string }> = ({ size = 40, className }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true">
    <defs>
      <linearGradient id="pp-sky" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#3B82FF" />
        <stop offset="1" stopColor="#1463FF" />
      </linearGradient>
    </defs>
    <rect width="64" height="64" rx="18" fill="url(#pp-sky)" />
    <path d="M27 14 L37 14 L50 52 L14 52 Z" fill="#0E1B2C" opacity="0.9" />
    <path d="M32 18 L32 23 M32 28 L32 34 M32 40 L32 47" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" />
    <circle cx="40" cy="40" r="7.5" fill="none" stroke="#FF7A1A" strokeWidth="2.6" />
    <circle cx="40" cy="40" r="2.6" fill="#FF7A1A" />
  </svg>
);

export const Wordmark: React.FC<{ light?: boolean }> = ({ light }) => (
  <span className={`text-[17px] font-extrabold tracking-tight ${light ? 'text-[#FFFFFF]' : 'text-[#0E1B2C]'}`}>
    Pavement<span className="text-[#1463FF]">PINN</span>
  </span>
);

type GlyphName = 'map' | 'list' | 'camera' | 'bell' | 'user' | 'inbox' | 'chart' | 'team' | 'layers' | 'arrow' | 'check' | 'pin' | 'shield' | 'logout' | 'plus' | 'spark';

const PATHS: Record<GlyphName, React.ReactNode> = {
  map: <><path d="M4 7l5-2 6 2 5-2v12l-5 2-6-2-5 2z" /><path d="M9 5v12M15 7v12" /></>,
  list: <><rect x="4" y="4" width="16" height="16" rx="4" /><path d="M8 9h8M8 13h8M8 17h5" /></>,
  camera: <><path d="M4 8.5A2.5 2.5 0 016.5 6H8l1.5-2h5L16 6h1.5A2.5 2.5 0 0120 8.5V17a2 2 0 01-2 2H6a2 2 0 01-2-2z" /><circle cx="12" cy="12.5" r="3.5" /></>,
  bell: <><path d="M6 16V11a6 6 0 1112 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 004 0" /></>,
  user: <><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c1-3.5 3.8-5.5 7-5.5s6 2 7 5.5" /></>,
  inbox: <><path d="M4 13l2.5-8h11L20 13v6H4z" /><path d="M4 13h5l1 2.5h4l1-2.5h5" /></>,
  chart: <><path d="M5 19V11M12 19V5M19 19v-6" /><path d="M3 20h18" /></>,
  team: <><circle cx="9" cy="9" r="3" /><circle cx="17" cy="10" r="2.4" /><path d="M3.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5M15 15c2.3 0 4.2 1.3 5 4" /></>,
  layers: <><path d="M12 4l8 4-8 4-8-4z" /><path d="M4 12l8 4 8-4M4 16l8 4 8-4" /></>,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  pin: <><path d="M12 21s7-6.2 7-11.5a7 7 0 10-14 0C5 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></>,
  shield: <><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" /></>,
  logout: <><path d="M10 5H6a2 2 0 00-2 2v10a2 2 0 002 2h4" /><path d="M14 8l4 4-4 4M18 12H9" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  spark: <><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /><circle cx="12" cy="12" r="3" /></>
};

export const Glyph: React.FC<{ name: GlyphName; size?: number; className?: string; strokeWidth?: number }> = ({ name, size = 22, className, strokeWidth = 1.9 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    {PATHS[name]}
  </svg>
);
