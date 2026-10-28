/**
 * Route guard logic — pure functions deciding what an identity may open and where it
 * lands. Kept free of React so the full role x route matrix is unit-tested in node.
 *
 * Frontend guard only: it hides screens. Data is protected by the server (roles,
 * ownership and transitions are checked on every API call).
 */
import type { UserRole } from '../../types';
import { evaluateAccess, AccessDecision } from '../../features/rbac/accessPolicy';
import { allowedRolesFor, buildPath, getRoute, RouteDefinition, RouteId, RouteMatch } from '../routeConfig';

/** The slice of a demo account the guards need. */
export interface GuardIdentity {
  role: UserRole;
  layoutStyle?: 'MODERN_APP' | 'CLASSIC_PORTAL';
}

export function resolveRouteAccess(route: RouteDefinition, identity: GuardIdentity): AccessDecision {
  return evaluateAccess(allowedRolesFor(route), identity.role);
}

export function canOpenRoute(routeId: RouteId, identity: GuardIdentity): boolean {
  return resolveRouteAccess(getRoute(routeId), identity) === 'ALLOW';
}

/** Landing route: guests see the landing page; each role opens on its own main tab. */
export function homeRouteFor(identity: GuardIdentity): RouteId {
  switch (identity.role) {
    case 'FIELD_ENGINEER':
      return 'tasks';
    case 'OPERATIONS_MANAGER':
      return 'queue';
    case 'PUBLIC_REPORTER':
      return 'map';
    default:
      return 'landing';
  }
}

/** After login: stay on the page that asked for it when the account may open it, else go home. */
export function landingRouteAfterLogin(identity: GuardIdentity, current: RouteMatch | null): { id: RouteId; params: Record<string, string> } {
  if (current && current.route.id !== 'login' && current.route.id !== 'landing' && canOpenRoute(current.route.id, identity)) {
    return { id: current.route.id, params: current.params };
  }
  return { id: homeRouteFor(identity), params: {} };
}

/** `/login/?next=<path>` for a protected deep link hit by a public identity. */
export function loginPathFor(nextPath: string): string {
  return `${buildPath('login')}?next=${encodeURIComponent(nextPath)}`;
}

/** Only same-app, canonical-looking paths are accepted as a post-login target. */
export function sanitizeNextPath(next: string | null): string | null {
  if (!next) return null;
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\') || next.includes('://')) return null;
  return next;
}
