/**
 * Centralized, typed route table — the single source of truth for every URL.
 *
 * Pure data + pure functions (no React, no browser globals, no model code), so it is
 * shared by the router, the guards, the navigation bindings and the node test suite.
 *
 * Paths are app-relative and canonical with a trailing slash; the deployment base
 * path (e.g. `/PavementPinn/`) is applied by the router, never stored here.
 */
import type { UserRole } from '../types';

export const ALL_ROLES: readonly UserRole[] = ['PUBLIC_REPORTER', 'FIELD_ENGINEER', 'OPERATIONS_MANAGER'];
/** Public pages are open to every identity, including a signed-out visitor (PUBLIC_VIEWER). */
const EVERYONE: readonly UserRole[] = [...ALL_ROLES, 'PUBLIC_VIEWER', 'POLICY_MAKER'];

export type RouteId =
  | 'landing'
  | 'login'
  | 'track'
  | 'evidence'
  | 'map'
  | 'myReports'
  | 'notifications'
  | 'safety'
  | 'tasks'
  | 'queue'
  | 'analysis'
  | 'analysisWorkspace'
  | 'team'
  | 'stats'
  | 'roadDetail'
  | 'escalations'
  | 'reportCard'
  | 'profile';

/** `PUBLIC` = reachable without logging in. Everything else needs a registered account. */
export type RouteAccess = 'PUBLIC' | readonly UserRole[];

export interface RouteDefinition {
  id: RouteId;
  /** Canonical app-relative pattern. `:name` captures one path segment. */
  path: string;
  title: string;
  access: RouteAccess;
  /** `tab` = one of the bottom-bar tabs of the shell; `page` = opened from a tab. */
  kind: 'tab' | 'page';
}

const SIGNED_IN: readonly UserRole[] = [...ALL_ROLES, 'POLICY_MAKER'];
/** Koordinator and Pimpinan Instansi (SPEC M3.2/M3.5). */
const LEADERS: readonly UserRole[] = ['OPERATIONS_MANAGER', 'POLICY_MAKER'];
const CITIZEN: readonly UserRole[] = ['PUBLIC_REPORTER'];
const ENGINEER: readonly UserRole[] = ['FIELD_ENGINEER'];
const COORDINATOR: readonly UserRole[] = ['OPERATIONS_MANAGER'];
const STAFF: readonly UserRole[] = ['FIELD_ENGINEER', 'OPERATIONS_MANAGER'];

export const ROUTES: readonly RouteDefinition[] = [
  { id: 'landing', path: '/beranda/', title: 'PavementPINN', access: 'PUBLIC', kind: 'page' },
  { id: 'login', path: '/login/', title: 'Masuk', access: 'PUBLIC', kind: 'page' },
  { id: 'track', path: '/lacak/:code/', title: 'Lacak Laporan', access: 'PUBLIC', kind: 'page' },
  { id: 'evidence', path: '/bukti/', title: 'Bukti & Transparansi', access: 'PUBLIC', kind: 'page' },
  { id: 'map', path: '/peta/', title: 'Peta', access: SIGNED_IN, kind: 'tab' },
  { id: 'myReports', path: '/laporanku/', title: 'Kawal', access: CITIZEN, kind: 'tab' },
  { id: 'safety', path: '/aman/', title: 'Aman', access: CITIZEN, kind: 'tab' },
  { id: 'notifications', path: '/notifikasi/', title: 'Notifikasi', access: SIGNED_IN, kind: 'tab' },
  { id: 'tasks', path: '/tugas/', title: 'Tugas', access: ENGINEER, kind: 'tab' },
  { id: 'queue', path: '/antrian/', title: 'Antrian', access: COORDINATOR, kind: 'tab' },
  { id: 'analysis', path: '/analisis/', title: 'Analisis PINN', access: STAFF, kind: 'tab' },
  { id: 'analysisWorkspace', path: '/analisis/:reportId/', title: 'Analisis Laporan', access: STAFF, kind: 'page' },
  { id: 'team', path: '/tim/', title: 'Tim', access: COORDINATOR, kind: 'tab' },
  { id: 'stats', path: '/statistik/', title: 'Statistik', access: COORDINATOR, kind: 'tab' },
  { id: 'escalations', path: '/eskalasi/', title: 'Eskalasi', access: LEADERS, kind: 'tab' },
  { id: 'reportCard', path: '/rapor/', title: 'Rapor Instansi', access: LEADERS, kind: 'tab' },
  { id: 'roadDetail', path: '/ruas/:roadId/', title: 'Detail Ruas', access: SIGNED_IN, kind: 'page' },
  { id: 'profile', path: '/profil/', title: 'Profil', access: SIGNED_IN, kind: 'tab' }
];

const ROUTE_BY_ID = new Map<RouteId, RouteDefinition>(ROUTES.map((route) => [route.id, route]));

export function getRoute(id: RouteId): RouteDefinition {
  const route = ROUTE_BY_ID.get(id);
  if (!route) throw new Error(`Unknown route id: ${id}`);
  return route;
}

export function allowedRolesFor(route: RouteDefinition): readonly UserRole[] {
  return route.access === 'PUBLIC' ? EVERYONE : route.access;
}

export function isPublicRoute(route: RouteDefinition): boolean {
  return route.access === 'PUBLIC';
}

// ---------------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------------

/** `/engine/pinn`, `engine//pinn/`, `` all normalise to a single canonical form. */
export function normalizePath(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  return segments.length === 0 ? '/' : `/${segments.join('/')}/`;
}

const splitSegments = (path: string) => path.split('/').filter(Boolean);

export interface RouteMatch {
  route: RouteDefinition;
  params: Record<string, string>;
}

/** Resolve an app-relative pathname to a route. Returns null for unknown paths (not-found). */
export function matchRoute(pathname: string): RouteMatch | null {
  const target = splitSegments(pathname);
  for (const route of ROUTES) {
    const pattern = splitSegments(route.path);
    if (pattern.length !== target.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i].startsWith(':')) {
        let value = target[i];
        try {
          value = decodeURIComponent(target[i]);
        } catch {
          // keep the raw segment when it is not valid percent-encoding
        }
        params[pattern[i].slice(1)] = value;
      } else if (pattern[i] !== target[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return { route, params };
  }
  return null;
}

/** Build the canonical app-relative path for a route, filling `:params`. */
export function buildPath(id: RouteId, params: Record<string, string> = {}): string {
  const route = getRoute(id);
  const segments = splitSegments(route.path).map((segment) => {
    if (!segment.startsWith(':')) return segment;
    const value = params[segment.slice(1)];
    if (value === undefined) throw new Error(`Missing route param "${segment.slice(1)}" for ${id}`);
    return encodeURIComponent(value);
  });
  return `/${segments.join('/')}/`;
}

/**
 * Paths that existed (or were plausible) before the canonical route table and are kept
 * as compatibility redirects. Keys and values are canonical app-relative paths.
 */
export const LEGACY_REDIRECTS: Readonly<Record<string, string>> = {
  '/dashboard/': '/peta/',
  '/map/': '/peta/',
  '/reports/': '/laporanku/',
  '/settings/': '/profil/',
  '/engineering/': '/tugas/',
  '/engineering/tasks/': '/tugas/',
  '/operations/': '/antrian/',
  '/operations/tasks/': '/antrian/',
  '/operations/pinn/': '/analisis/'
};

// ---------------------------------------------------------------------------------
// Base-path helpers (deployment base, e.g. GitHub Pages serves under /PavementPinn/)
// ---------------------------------------------------------------------------------

/** Convert a browser pathname into an app-relative canonical path. */
export function stripBasePath(pathname: string, basePath: string): string {
  const base = normalizePath(basePath);
  const full = normalizePath(pathname);
  if (base === '/') return full;
  if (full === base) return '/';
  return full.startsWith(base) ? normalizePath(full.slice(base.length - 1)) : full;
}

/** Convert an app-relative path into a browser pathname under the deployment base. */
export function withBasePath(appPath: string, basePath: string): string {
  const base = normalizePath(basePath);
  const path = normalizePath(appPath);
  return base === '/' ? path : `${base.slice(0, -1)}${path}`;
}
