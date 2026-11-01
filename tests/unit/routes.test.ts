/**
 * Route table tests: every required URL resolves, paths are canonical and unambiguous,
 * and the route <-> shell-view bindings are consistent.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROUTES,
  LEGACY_REDIRECTS,
  buildPath,
  getRoute,
  matchRoute,
  normalizePath,
  stripBasePath,
  withBasePath,
  allowedRolesFor,
  RouteId
} from '../../src/app/routeConfig';
import { DEFAULT_BASE_PATH, normalizeBasePath } from '../../src/constants/deployment';

/** The URL contract requested for the restructure. */
const REQUIRED_URLS: Array<[string, RouteId]> = [
  ['/beranda/', 'landing'],
  ['/login/', 'login'],
  ['/lacak/ABC123/', 'track'],
  ['/bukti/', 'evidence'],
  ['/peta/', 'map'],
  ['/laporanku/', 'myReports'],
  ['/notifikasi/', 'notifications'],
  ['/tugas/', 'tasks'],
  ['/antrian/', 'queue'],
  ['/analisis/', 'analysis'],
  ['/analisis/REP-1/', 'analysisWorkspace'],
  ['/tim/', 'team'],
  ['/statistik/', 'stats'],
  ['/ruas/JLN-KRW-KIIC-1/', 'roadDetail'],
  ['/profil/', 'profile']
];

test('every required URL resolves to its route', () => {
  for (const [url, id] of REQUIRED_URLS) {
    assert.equal(matchRoute(url)?.route.id, id, url);
  }
});

test('unknown URLs resolve to null (not-found), including near-misses', () => {
  for (const url of ['/nope/', '/engine/pinn/', '/ruas/', '/ruas/a/b/', '/peta/x/', '/operations/monitoring/', '/api/health/']) {
    assert.equal(matchRoute(url), null, url);
  }
});

test('paths are matched with or without a trailing slash and with duplicate slashes', () => {
  assert.equal(matchRoute('/analisis')?.route.id, 'analysis');
  assert.equal(matchRoute('ruas//X/')?.route.id, 'roadDetail');
  assert.equal(normalizePath('/analisis'), '/analisis/');
  assert.equal(normalizePath(''), '/');
  assert.equal(normalizePath('///'), '/');
});

test('route params are captured and percent-decoded; buildPath is the inverse', () => {
  const match = matchRoute('/ruas/JLN%20A%2FB/');
  assert.equal(match?.route.id, 'roadDetail');
  assert.deepEqual(match?.params, { roadId: 'JLN A/B' });
  assert.equal(buildPath('roadDetail', { roadId: 'JLN A/B' }), '/ruas/JLN%20A%2FB/');
  assert.throws(() => buildPath('roadDetail'));
});

test('route table is canonical: unique ids, unique paths, leading and trailing slash', () => {
  assert.equal(new Set(ROUTES.map((r) => r.id)).size, ROUTES.length);
  assert.equal(new Set(ROUTES.map((r) => r.path)).size, ROUTES.length);
  for (const route of ROUTES) {
    assert.equal(route.path, normalizePath(route.path), route.id);
    assert.ok(allowedRolesFor(route).length > 0, `${route.id} has no allowed role`);
  }
});

test('no route shadows another: each concrete path matches exactly its own route', () => {
  for (const route of ROUTES) {
    const concrete = route.path.replace(/:[^/]+/g, 'sample');
    const matching = ROUTES.filter((candidate) => {
      const a = candidate.path.split('/').filter(Boolean);
      const b = concrete.split('/').filter(Boolean);
      return a.length === b.length && a.every((seg, i) => seg.startsWith(':') || seg === b[i]);
    });
    assert.deepEqual(matching.map((r) => r.id), [route.id], route.path);
    assert.equal(matchRoute(concrete)?.route.id, route.id);
  }
});

test('legacy aliases redirect to existing canonical routes and never collide with one', () => {
  for (const [from, to] of Object.entries(LEGACY_REDIRECTS)) {
    assert.equal(matchRoute(from), null, `${from} must not be a real route`);
    assert.ok(matchRoute(to), `${from} redirects to unknown ${to}`);
  }
});

test('base path: strip and re-apply are inverse for the GitHub Pages base and for root hosting', () => {
  assert.equal(DEFAULT_BASE_PATH, '/PavementPinn/');
  assert.equal(stripBasePath('/PavementPinn/', '/PavementPinn/'), '/');
  assert.equal(stripBasePath('/PavementPinn', '/PavementPinn/'), '/');
  assert.equal(stripBasePath('/PavementPinn/engine/pinn', '/PavementPinn/'), '/engine/pinn/');
  assert.equal(stripBasePath('/engine/pinn/', '/'), '/engine/pinn/');
  // A path outside the base (e.g. the dev server root) is treated as app-relative.
  assert.equal(stripBasePath('/', '/PavementPinn/'), '/');
  assert.equal(stripBasePath('/reports/', '/PavementPinn/'), '/reports/');
  for (const route of ROUTES) {
    const concrete = route.path.replace(/:[^/]+/g, 'sample');
    for (const base of ['/PavementPinn/', '/']) {
      assert.equal(stripBasePath(withBasePath(concrete, base), base), concrete);
    }
  }
  assert.equal(withBasePath('/dashboard/', '/PavementPinn/'), '/PavementPinn/dashboard/');
  assert.equal(normalizeBasePath(undefined), '/PavementPinn/');
  assert.equal(normalizeBasePath('/'), '/');
  assert.equal(normalizeBasePath('PavementPinn'), '/PavementPinn/');
});

// The added pages hold no case data of their own: staff data is refused by the v5 API without a session.
test('only the landing, login, public tracking, evidence and public v5 pages are reachable without an account', () => {
  assert.deepEqual(ROUTES.filter((r) => r.access === 'PUBLIC').map((r) => r.id).sort(), ['evidence', 'landing', 'login', 'publicCase', 'staffHome', 'tour', 'track', 'uiCheck', 'verify', 'verifyDoc', 'why', 'workCase']);
});
