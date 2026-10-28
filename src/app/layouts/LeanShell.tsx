/**
 * The one application shell (docs/LEAN_PLAN.md): content fills the screen, a floating bottom
 * bar holds the role's five tabs, and the yellow camera button in the middle opens the
 * photo report for citizens and field officers.
 */
import React from 'react';
import { BarChart3, Bell, Camera, ClipboardList, FileText, Inbox, Map as MapIcon, Microscope, User, Users } from 'lucide-react';
import type { UserRole } from '../../types';
import type { RouteId } from '../routeConfig';

interface Tab {
  id: RouteId | 'camera';
  label: string;
  icon: React.ReactNode;
}

const icon = 'h-[22px] w-[22px]';
const CAMERA: Tab = { id: 'camera', label: 'Lapor', icon: <Camera className="h-7 w-7" /> };

export const TABS_BY_ROLE: Partial<Record<UserRole, Tab[]>> = {
  PUBLIC_REPORTER: [
    { id: 'map', label: 'Peta', icon: <MapIcon className={icon} /> },
    { id: 'myReports', label: 'Laporanku', icon: <FileText className={icon} /> },
    CAMERA,
    { id: 'notifications', label: 'Notifikasi', icon: <Bell className={icon} /> },
    { id: 'profile', label: 'Profil', icon: <User className={icon} /> }
  ],
  FIELD_ENGINEER: [
    { id: 'map', label: 'Peta', icon: <MapIcon className={icon} /> },
    { id: 'tasks', label: 'Tugas', icon: <ClipboardList className={icon} /> },
    CAMERA,
    { id: 'analysis', label: 'Analisis', icon: <Microscope className={icon} /> },
    { id: 'profile', label: 'Profil', icon: <User className={icon} /> }
  ],
  OPERATIONS_MANAGER: [
    { id: 'map', label: 'Peta', icon: <MapIcon className={icon} /> },
    { id: 'queue', label: 'Antrian', icon: <Inbox className={icon} /> },
    { id: 'stats', label: 'Statistik', icon: <BarChart3 className={icon} /> },
    { id: 'team', label: 'Tim', icon: <Users className={icon} /> },
    { id: 'profile', label: 'Profil', icon: <User className={icon} /> }
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
    <div className="relative h-full w-full overflow-hidden bg-[#0B0B0C] text-white">
      <main className="absolute inset-0">{children}</main>
      <nav
        aria-label="Navigasi utama"
        className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-[max(12px,env(safe-area-inset-bottom))]"
      >
        <div className="pointer-events-auto flex w-full max-w-md items-end justify-between rounded-[28px] border border-white/10 bg-black/85 px-2 py-1.5 shadow-2xl backdrop-blur-xl">
          {tabs.map((tab) =>
            tab.id === 'camera' ? (
              <button
                key="camera"
                type="button"
                onClick={onOpenCamera}
                aria-label="Laporkan kerusakan dengan kamera"
                className="-mt-6 flex h-[64px] w-[64px] cursor-pointer items-center justify-center rounded-full border-4 border-[#0B0B0C] bg-[#FFE14D] text-black shadow-lg transition active:scale-95"
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
                  lit === tab.id ? 'text-[#FFE14D]' : 'text-white/55 hover:text-white'
                }`}
              >
                {tab.icon}
                {tab.label}
                {(badges[tab.id as RouteId] ?? 0) > 0 && (
                  <span className="absolute right-2 top-0.5 min-w-[18px] rounded-full bg-rose-500 px-1 text-center text-[10px] leading-[18px] text-white">
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
