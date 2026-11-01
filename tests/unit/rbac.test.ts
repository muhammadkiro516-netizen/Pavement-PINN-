/**
 * Lean RBAC (docs/LEAN_PLAN.md): three roles, every screen behind login except login,
 * public tracking and the evidence page. Frontend guard only; the API enforces the same rules.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { UserRole } from '../../src/types';
import { ROUTES, getRoute, matchRoute, RouteId } from '../../src/app/routeConfig';
import { canOpenRoute, homeRouteFor, landingRouteAfterLogin, resolveRouteAccess, sanitizeNextPath } from '../../src/app/guards/routeAccess';
import { ACTION_RULES, can, ActionId } from '../../src/features/rbac/accessPolicy';

const ROLES: UserRole[] = ['FIELD_ENGINEER', 'OPERATIONS_MANAGER', 'POLICY_MAKER', 'PUBLIC_REPORTER', 'PUBLIC_VIEWER'];
const A = 'ALLOW';
const F = 'FORBIDDEN';
const L = 'LOGIN_REQUIRED';
type Row = [fe: string, ko: string, warga: string, guest: string];
const MATRIX_ROLES: UserRole[] = ['FIELD_ENGINEER', 'OPERATIONS_MANAGER', 'PUBLIC_REPORTER', 'PUBLIC_VIEWER'];

const EXPECTED: Record<RouteId, Row> = {
  landing: [A, A, A, A],
  login: [A, A, A, A],
  track: [A, A, A, A],
  evidence: [A, A, A, A],
  roles: [A, A, A, A],
  workCase: [A, A, A, A],
  publicCase: [A, A, A, A],
  why: [A, A, A, A],
  tour: [A, A, A, A],
  verify: [A, A, A, A],
  verifyDoc: [A, A, A, A],
  map: [A, A, A, L],
  myReports: [F, F, A, L],
  notifications: [A, A, A, L],
  safety: [F, F, A, L],
  tasks: [A, F, L, L],
  queue: [F, A, L, L],
  analysis: [A, A, L, L],
  analysisWorkspace: [A, A, L, L],
  team: [F, A, L, L],
  stats: [F, A, L, L],
  roadDetail: [A, A, A, L],
  escalations: [F, A, L, L],
  reportCard: [F, A, L, L],
  profile: [A, A, A, L]
};

test('role x route matrix (18 routes x 3 roles + guest)', () => {
  assert.deepEqual(ROUTES.map((r) => r.id).sort(), Object.keys(EXPECTED).sort());
  for (const route of ROUTES) {
    MATRIX_ROLES.forEach((role, i) => assert.equal(resolveRouteAccess(route, { role }), EXPECTED[route.id][i], `${route.id} as ${role}`));
  }
});

test('the Pimpinan Instansi (POLICY_MAKER) reads escalations and the report card, nothing operational', () => {
  const as = (id: RouteId) => resolveRouteAccess(ROUTES.find((r) => r.id === id)!, { role: 'POLICY_MAKER' });
  assert.deepEqual([as('escalations'), as('reportCard'), as('map'), as('profile')], [A, A, A, A]);
  assert.deepEqual([as('queue'), as('tasks'), as('team')], [F, F, F]);
});

test('each role lands on its own main tab; guests on the landing page', () => {
  assert.equal(homeRouteFor({ role: 'PUBLIC_REPORTER' }), 'map');
  assert.equal(homeRouteFor({ role: 'FIELD_ENGINEER' }), 'tasks');
  assert.equal(homeRouteFor({ role: 'OPERATIONS_MANAGER' }), 'queue');
  assert.equal(homeRouteFor({ role: 'PUBLIC_VIEWER' }), 'landing');
});

test('after login: stay on the page that asked for it when allowed, else go home', () => {
  const engineer = { role: 'FIELD_ENGINEER' as UserRole };
  assert.deepEqual(landingRouteAfterLogin(engineer, matchRoute('/ruas/X/')), { id: 'roadDetail', params: { roadId: 'X' } });
  assert.deepEqual(landingRouteAfterLogin(engineer, matchRoute('/tim/')), { id: 'tasks', params: {} });
  assert.deepEqual(landingRouteAfterLogin(engineer, matchRoute('/login/')), { id: 'tasks', params: {} });
  for (const role of MATRIX_ROLES.slice(0, 3)) {
    for (const route of ROUTES) {
      const landing = landingRouteAfterLogin({ role }, matchRoute(route.path.replace(/:[a-zA-Z]+/g, 'X')));
      assert.ok(canOpenRoute(landing.id, { role }), `${role} from ${route.id}`);
    }
  }
  assert.equal(getRoute('team').access.includes('OPERATIONS_MANAGER' as never), true);
});

test('role x action matrix', () => {
  const expected: Record<ActionId, UserRole[]> = {
    VIEW_PUBLIC_ROAD_HEALTH: ROLES,
    CREATE_DAMAGE_REPORT: ROLES,
    EDIT_OWN_DAMAGE_REPORT: ['PUBLIC_REPORTER'],
    UPVOTE_DAMAGE_REPORT: ROLES,
    RUN_PINN_SIMULATION: ROLES,
    EXPORT_SIMULATION_PDF: ROLES,
    USE_FWD_OVERLAY_TOOLS: ['FIELD_ENGINEER', 'OPERATIONS_MANAGER'],
    // Verification is the workflow inspection, done by the assigned engineer only.
    VERIFY_DAMAGE_REPORT: ['FIELD_ENGINEER'],
    MANAGE_WORK_ORDERS: ['FIELD_ENGINEER', 'OPERATIONS_MANAGER'],
    VIEW_PCI_TREND_HISTORY: ['FIELD_ENGINEER', 'OPERATIONS_MANAGER'],
    MONITOR_WIM_OPERATIONS: ['OPERATIONS_MANAGER'],
    ISSUE_ODOL_ENFORCEMENT: ['OPERATIONS_MANAGER'],
    VIEW_POLICY_ANALYSIS: ['POLICY_MAKER'],
    TRIAGE_REPORTS: ['OPERATIONS_MANAGER'],
    APPROVE_MAINTENANCE: ['OPERATIONS_MANAGER'],
    VIEW_AUDIT_TRAIL: ['FIELD_ENGINEER', 'OPERATIONS_MANAGER', 'POLICY_MAKER'],
    // Analysis workspace (handoff addendum §1/§4): F.E corrects, M.O approves, never the same person.
    VIEW_PINN_WORKSPACE: ['OPERATIONS_MANAGER', 'FIELD_ENGINEER'],
    CORRECT_ANALYSIS: ['FIELD_ENGINEER'],
    APPROVE_REPORT_VERSION: ['OPERATIONS_MANAGER']
  };
  assert.deepEqual(Object.keys(ACTION_RULES).sort(), Object.keys(expected).sort());
  for (const [action, roles] of Object.entries(expected) as Array<[ActionId, UserRole[]]>) {
    for (const role of ROLES) {
      assert.equal(can(role, action), roles.includes(role), `${action} as ${role}`);
    }
  }
});

test('post-login "next" target only accepts same-app paths', () => {
  assert.equal(sanitizeNextPath('/policy/'), '/policy/');
  assert.equal(sanitizeNextPath('/roads/A/?tab=1'), '/roads/A/?tab=1');
  for (const hostile of [null, '', 'policy', '//evil.example/x', 'https://evil.example/', '/\\evil', '/x?u=http://evil.example']) {
    assert.equal(sanitizeNextPath(hostile), null, String(hostile));
  }
});


