/**
 * "Pavi", the PavementPINN mascot: a small traffic-cone robot with a scanner visor. Drawn in-house
 * as one SVG rig; states are CSS animations (styles/index.css, `pavi-*`). Pavi stands in for the
 * user on the map (Snap-Map-style), and shows up in onboarding, AI analysis, success and errors.
 */
import React from 'react';

export type PaviMood = 'idle' | 'scan' | 'found' | 'celebrate' | 'worried' | 'sleep' | 'walk';
export const PAVI_HELMETS = ['#FF6B2C', '#FFD60A', '#4C8DFF', '#2BD67B', '#E5E7EB'] as const;
/** Reflective vest band colours (avatar builder, SPEC M8). */
export const PAVI_VESTS = ['#FFFFFF', '#FFD60A', '#2BD67B', '#38BDF8', '#FF4D5E'] as const;

export const Pavi: React.FC<{ size?: number; mood?: PaviMood; helmet?: string; vest?: string; badge?: boolean; className?: string; title?: string }> = ({
  size = 72,
  mood = 'idle',
  helmet = PAVI_HELMETS[0],
  vest = PAVI_VESTS[0],
  badge = false,
  className = '',
  title
}) => {
  const eyes =
    mood === 'sleep' ? (
      <path d="M27 33 q3 2 6 0 M39 33 q3 2 6 0" stroke="#7DD3FC" strokeWidth="2" fill="none" strokeLinecap="round" />
    ) : mood === 'worried' ? (
      <>
        <path d="M27 31 l6 2 M45 31 l-6 2" stroke="#7DD3FC" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="30" cy="35" r="2.2" fill="#7DD3FC" />
        <circle cx="42" cy="35" r="2.2" fill="#7DD3FC" />
      </>
    ) : mood === 'celebrate' || mood === 'found' ? (
      <path d="M26 35 q4 -5 8 0 M38 35 q4 -5 8 0" stroke="#7DD3FC" strokeWidth="2.6" fill="none" strokeLinecap="round" />
    ) : (
      <>
        <rect x="27" y="31" width="6" height="6" rx="3" fill="#7DD3FC" className="pavi-blink" />
        <rect x="39" y="31" width="6" height="6" rx="3" fill="#7DD3FC" className="pavi-blink" />
      </>
    );
  return (
    <svg width={size} height={size * 1.15} viewBox="0 0 72 83" className={`pavi pavi-${mood} ${className}`} role={title ? 'img' : 'presentation'} aria-label={title}>
      {title && <title>{title}</title>}
      <ellipse cx="36" cy="80" rx="18" ry="3" fill="#000" opacity="0.25" className="pavi-shadow" />
      <g className="pavi-body">
        {/* antenna */}
        <line x1="36" y1="9" x2="36" y2="2" stroke="#2A2F37" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="36" cy="2.5" r="2.5" fill={mood === 'found' ? '#FF4D5E' : '#FFD60A'} className="pavi-antenna" />
        {/* cone body */}
        <path d="M30 9 h12 l15 55 a4 4 0 0 1 -4 5 H19 a4 4 0 0 1 -4 -5 Z" fill={helmet} />
        <path d="M24 40 h24 l3 10 H21 Z" fill={vest} opacity="0.92" />
        {badge && <path d="M36 54 l2.4 4.8 5.3 .8 -3.8 3.7 .9 5.3 -4.8-2.5 -4.8 2.5 .9-5.3 -3.8-3.7 5.3-.8 Z" fill="#FFD60A" stroke="#0B0D10" strokeWidth="1" />}
        <path d="M27 26 h18 l1.6 6 H25.4 Z" fill="#FFFFFF" opacity="0.35" />
        {/* visor */}
        <rect x="22" y="27" width="28" height="15" rx="7.5" fill="#0B0D10" />
        <rect x="22" y="27" width="28" height="15" rx="7.5" fill="url(#pavi-glass)" opacity="0.5" />
        {eyes}
        {mood === 'scan' && <rect x="23" y="28" width="4" height="13" rx="2" fill="#7DD3FC" opacity="0.8" className="pavi-sweep" />}
        {/* base + feet */}
        <rect x="10" y="66" width="52" height="8" rx="4" fill="#2A2F37" />
        <rect x="18" y="73" width="10" height="5" rx="2.5" fill="#15181D" className="pavi-foot-l" />
        <rect x="44" y="73" width="10" height="5" rx="2.5" fill="#15181D" className="pavi-foot-r" />
      </g>
      <defs>
        <linearGradient id="pavi-glass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7DD3FC" stopOpacity="0.6" />
          <stop offset="1" stopColor="#7DD3FC" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
};

/** HTML for a MapLibre marker element (no React inside the map canvas). */
export function paviMarkerHtml(helmet: string = PAVI_HELMETS[0], vest: string = PAVI_VESTS[0]): string {
  return `<div class="pavi-marker"><span class="pavi-halo"></span><svg width="44" height="51" viewBox="0 0 72 83" class="pavi pavi-idle">
<ellipse cx="36" cy="80" rx="18" ry="3" fill="#000" opacity="0.35" class="pavi-shadow"/>
<g class="pavi-body"><line x1="36" y1="9" x2="36" y2="2" stroke="#2A2F37" stroke-width="2.5" stroke-linecap="round"/><circle cx="36" cy="2.5" r="2.5" fill="#FFD60A" class="pavi-antenna"/>
<path d="M30 9 h12 l15 55 a4 4 0 0 1 -4 5 H19 a4 4 0 0 1 -4 -5 Z" fill="${helmet}"/><path d="M24 40 h24 l3 10 H21 Z" fill="${vest}" opacity="0.92"/>
<rect x="22" y="27" width="28" height="15" rx="7.5" fill="#0B0D10"/><rect x="27" y="31" width="6" height="6" rx="3" fill="#7DD3FC" class="pavi-blink"/><rect x="39" y="31" width="6" height="6" rx="3" fill="#7DD3FC" class="pavi-blink"/>
<rect x="10" y="66" width="52" height="8" rx="4" fill="#2A2F37"/></g></svg></div>`;
}
