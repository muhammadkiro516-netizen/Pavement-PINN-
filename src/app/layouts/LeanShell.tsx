/**
 * The one application shell (docs/LEAN_PLAN.md): content fills the screen, a floating bottom
 * bar holds the role's five tabs, and the yellow camera button in the middle opens the
 * photo report for citizens and field officers.
 */
import React from 'react';
import { Glyph } from '../../components/ui/brand';
import type { UserRole } from '../../types';
import type { RouteId } from '../routeConfig';

interface Tab {
  id: RouteId | 'camera';
  label: string;
  icon: React.ReactNode;
}

const CAMERA: Tab = { id: 'camera', label: 'Lapor', icon: <Glyph name="camera" size={28} strokeWidth={2.1} /> };

export const TABS_BY_ROLE: Partial<Record<UserRole, Tab[]>> = {
  PUBLIC_REPORTER: [
    { id: 'map', label: 'Peta', icon: <Glyph name="map" /> },
    { id: 'myReports', label: 'Laporanku', icon: <Glyph name="list" /> },
    CAMERA,
    { id: 'notifications', label: 'Notifikasi', icon: <Glyph name="bell" /> },
    { id: 'profile', label: 'Profil', icon: <Glyph name="user" /> }
  ],
  FIELD_ENGINEER: [
    { id: 'map', label: 'Peta', icon: <Glyph name="map" /> },
    { id: 'tasks', label: 'Tugas', icon: <Glyph name="list" /> },
    CAMERA,
    { id: 'analysis', label: 'Analisis', icon: <Glyph name="layers" /> },
    { id: 'profile', label: 'Profil', icon: <Glyph name="user" /> }
  ],
  OPERATIONS_MANAGER: [
    { id: 'map', label: 'Peta', icon: <Glyph name="map" /> },
    { id: 'queue', label: 'Antrian', icon: <Glyph name="inbox" /> },
    { id: 'stats', label: 'Statistik', icon: <Glyph name="chart" /> },
    { id: 'team', label: 'Tim', icon: <Glyph name="team" /> },
    { id: 'profile', label: 'Profil', icon: <Glyph name="user" /> }
  ]
};

/** Which tab is lit for a route (pages opened from a tab keep that tab lit). */
function tabOf(route: RouteId): RouteId {
  if (route === 'analysisWorkspace') return 'analysis';
  if (route === 'roadDetail') return 'map';
  return route;
}

export const LeanShell: React.FC<{
  role: UserRole;
  activeRoute: RouteId;
  badges?: Partial<Record<RouteId, number>>;
  onNavigate: (route: RouteId) => void;
  onOpenCamera: () => void;
  children: React.ReactNode;
}> = ({ role, activeRoute, badges = {}, onNavigate, onOpenCamera, children }) => {
  const tabs = TABS_BY_ROLE[role] ?? [];
  const lit = tabOf(activeRoute);
  return (
    <div className="relative h-full w-full overflow-hidden bg-[#000000] text-[#FFFFFF]">
      <main className="absolute inset-0">{children}</main>
      <nav
        aria-label="Navigasi utama"
        className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-[max(12px,env(safe-area-inset-bottom))]"
      >
        <div className="pointer-events-auto flex w-full max-w-md items-end justify-between rounded-[28px] bg-[#000000]/90 px-2 py-1.5 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.6)] backdrop-blur-xl">
          {tabs.map((tab) =>
            tab.id === 'camera' ? (
              <button
                key="camera"
                type="button"
                onClick={onOpenCamera}
                aria-label="Laporkan kerusakan dengan kamera"
                className="pp-pulse -mt-6 flex h-[64px] w-[64px] cursor-pointer items-center justify-center rounded-full border-4 border-[#000000] bg-[#FF7A1A] text-[#FFFFFF] shadow-lg transition hover:scale-105 active:scale-95"
              >
                {tab.icon}
              </button>
            ) : (
              <button
                key={tab.id}
                type="button"
                onClick={() => onNavigate(tab.id as RouteId)}
                aria-current={lit === tab.id ? 'page' : undefined}
                className={`relative flex min-w-[56px] cursor-pointer flex-col items-center gap-0.5 rounded-2xl px-2 py-1.5 text-[11px] font-bold transition ${
                  lit === tab.id ? 'text-[#FFE14D]' : 'text-[#FFFFFF]/70 hover:text-[#FFFFFF]'
                }`}
              >
                {tab.icon}
                {tab.label}
                {(badges[tab.id as RouteId] ?? 0) > 0 && (
                  <span className="absolute right-2 top-0.5 min-w-[18px] rounded-full bg-rose-500 px-1 text-center text-[10px] leading-[18px] text-[#FFFFFF]">
                    {badges[tab.id as RouteId]}
                  </span>
                )}
              </button>
            )
          )}
        </div>
      </nav>
    </div>
  );
};
