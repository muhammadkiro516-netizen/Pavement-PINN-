import { Onboarding, shouldOnboard } from '../features/onboarding/Onboarding';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { UserAccount } from '../features/authentication/demoAccounts';
import { RouterProvider, useRouter } from './router';
import { SessionProvider, useSession } from './providers/SessionProvider';
import { AppStateProvider, useAppState } from './providers/AppStateProvider';
import { GlobalModalsProvider } from './providers/GlobalModalsProvider';
import { PageHostContext, PageHostValue } from './pageContext';
import { LeanShell } from './layouts/LeanShell';
import { PAGE_COMPONENTS, STANDALONE_ROUTES } from './pageRegistry';
import { AppErrorBoundary } from './AppErrorBoundary';
import { NotFoundPage, ForbiddenPage } from '../pages/not-found/NotFoundPage';
import { buildPath, matchRoute } from './routeConfig';
import { ServerVersionBanner } from '../components/ui/ServerVersionBanner';
import { canOpenRoute, homeRouteFor, landingRouteAfterLogin, loginPathFor, resolveRouteAccess } from './guards/routeAccess';
import { CameraLauncherContext } from './cameraLauncher';
import { LogoMark } from '../components/ui/brand';
import { Pavi } from '../components/brand/Pavi';
import { ReportRoadIssueCard } from '../features/community-reports/ReportRoadIssueCard';
import { readDeviceCredential, signInCitizenDevice } from '../features/authentication/deviceAccount';
import { accountFromProfile } from './providers/SessionProvider';

/**
 * Application host: resolves the URL against the signed-in account, sends guests to the
 * login page, and frames every page in the lean shell (docs/LEAN_PLAN.md).
 */
function AppShell() {
  const { location, match, navigate, navigateTo } = useRouter();
  const { currentAccount, establishSession, logout, endedNotice } = useSession();
  const app = useAppState();
  const [cameraOpen, setCameraOpen] = useState(false);

  const isRoot = location.path === '/';
  const decision = match ? resolveRouteAccess(match.route, currentAccount) : null;
  const homeRoute = homeRouteFor(currentAccount);

  useEffect(() => {
    if (isRoot) navigate(`${buildPath(homeRoute)}${location.search}`, { replace: true });
    else if (match && decision === 'LOGIN_REQUIRED') navigate(loginPathFor(`${location.path}${location.search}`), { replace: true });
  }, [isRoot, match, decision, homeRoute, location.path, location.search, navigate]);

  // A staff session that ended goes to the staff login; citizens are signed back in below.
  useEffect(() => {
    if (endedNotice && match?.route.id !== 'login' && !readDeviceCredential()) navigateTo('login');
  }, [endedNotice, match, navigateTo]);

  // Returning citizen on this phone: sign the device account back in, no form.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || currentAccount.role !== 'PUBLIC_VIEWER' || !readDeviceCredential()) return;
    if (match && (match.route.id === 'login' || match.route.id === 'evidence' || match.route.id === 'track')) return;
    resumed.current = true;
    signInCitizenDevice(app.workflow.gateway)
      .then((signed) => {
        if (!signed.account) return;
        establishSession(accountFromProfile(signed.account));
        if (!match || match.route.id === 'landing') navigateTo('map');
      })
      .catch(() => undefined);
  }, [currentAccount.role, match, app.workflow.gateway, establishSession, navigateTo]);

  // "/peta/?lapor=1" (landing page button) opens the camera straight away.
  useEffect(() => {
    if (decision === 'ALLOW' && new URLSearchParams(location.search).get('lapor') === '1') {
      setCameraOpen(true);
      navigate(location.path, { replace: true });
    }
  }, [decision, location.search, location.path, navigate]);

  const host = useMemo<PageHostValue>(
    () => ({
      closePage: () => navigateTo(homeRouteFor(currentAccount)),
      completeLogin: (account: UserAccount, nextPath?: string | null) => {
        establishSession(account);
        const next = nextPath ? matchRoute(nextPath.split('?')[0]) : null;
        if (nextPath && next && next.route.id !== 'login' && canOpenRoute(next.route.id, account)) {
          navigate(nextPath);
          return;
        }
        const landing = landingRouteAfterLogin(account, matchRoute(location.path));
        navigateTo(landing.id, landing.params);
      },
      logout: () => {
        logout(app.workflow.gateway.logout());
        navigateTo('login');
      }
    }),
    [currentAccount, establishSession, logout, app.workflow.gateway, navigate, navigateTo, location.path]
  );

  let page: React.ReactNode = null;
  if (!isRoot) {
    if (!match) page = <NotFoundPage />;
    else if (decision === 'FORBIDDEN') page = <ForbiddenPage route={match.route} />;
    else if (decision === 'ALLOW') {
      const Page = PAGE_COMPONENTS[match.route.id];
      page = <Page params={match.params} />;
    }
  }

  const [onboarding, setOnboarding] = useState(shouldOnboard);
  const standalone = !match || STANDALONE_ROUTES.includes(match.route.id) || decision !== 'ALLOW';
  const canReport = currentAccount.role === 'PUBLIC_REPORTER' || currentAccount.role === 'FIELD_ENGINEER';
  const tasksDue = Object.values(app.workflow.views).filter((v) => v.audience === 'STAFF' && v.availableActions.length > 0).length;

  return (
    <PageHostContext.Provider value={host}>
      <CameraLauncherContext.Provider value={() => setCameraOpen(true)}>
        {standalone ? (
          <div className="h-full w-full overflow-auto">{page}</div>
        ) : (
          <LeanShell
            role={currentAccount.role}
            activeRoute={match!.route.id}
            badges={{ queue: tasksDue, tasks: tasksDue }}
            onNavigate={(id) => navigateTo(id)}
            onOpenCamera={() => setCameraOpen(true)}
          >
            {page}
          </LeanShell>
        )}
        {currentAccount.role === 'PUBLIC_REPORTER' && onboarding && <Onboarding onDone={() => setOnboarding(false)} />}
        {canReport && (
          <ReportRoadIssueCard
            isOpen={cameraOpen}
            onClose={() => setCameraOpen(false)}
            currentAccount={currentAccount}
            roadSegments={app.roadSegments}
            selectedSegment={app.selectedSegment}
            onAddReport={app.addCommunityReport}
          />
        )}
      </CameraLauncherContext.Provider>
    </PageHostContext.Provider>
  );
}

/**
 * Opening animation: lane markings draw in with perspective, Pavi walks up the lane and scans
 * once, the logo settles, then the app crossfades in. Full (~2.2 s) on the first open of a
 * session, logo-only (~0.6 s) afterwards; a tap skips it; reduced motion shows the logo only.
 */
function Splash() {
  const [phase, setPhase] = useState<'in' | 'out' | 'gone'>('in');
  const short = useMemo(() => {
    try {
      const seen = sessionStorage.getItem('pp-splash') === '1';
      sessionStorage.setItem('pp-splash', '1');
      return seen || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  }, []);
  useEffect(() => {
    const a = window.setTimeout(() => setPhase('out'), short ? 450 : 2050);
    const b = window.setTimeout(() => setPhase('gone'), short ? 800 : 2450);
    return () => {
      window.clearTimeout(a);
      window.clearTimeout(b);
    };
  }, [short]);
  if (phase === 'gone') return null;
  return (
    <div
      onClick={() => setPhase('gone')}
      className={`fixed inset-0 z-[9999] overflow-hidden bg-[#0B0D10] transition-opacity duration-400 ${phase === 'out' ? 'opacity-0' : 'opacity-100'}`}
      aria-hidden="true"
    >
      {!short && (
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 400 800" preserveAspectRatio="xMidYMax slice">
          <defs>
            <linearGradient id="sp-road" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#15181D" stopOpacity="0" />
              <stop offset="1" stopColor="#15181D" />
            </linearGradient>
          </defs>
          <path d="M190 260 L210 260 L380 800 L20 800 Z" fill="url(#sp-road)" />
          <path d="M200 270 L200 800" stroke="#FFD60A" strokeWidth="8" strokeDasharray="38 30" className="sp-lane" />
          <path d="M193 262 L40 800" stroke="#FFFFFF" strokeOpacity="0.5" strokeWidth="3" className="sp-edge" />
          <path d="M207 262 L360 800" stroke="#FFFFFF" strokeOpacity="0.5" strokeWidth="3" className="sp-edge" />
        </svg>
      )}
      {!short && (
        <div className="sp-pavi absolute left-1/2 -translate-x-1/2">
          <Pavi size={92} mood="scan" />
        </div>
      )}
      <div className={`absolute inset-x-0 ${short ? 'top-1/2 -translate-y-1/2' : 'top-[18%]'} flex flex-col items-center`}>
        <div className="pp-pop" style={{ animationDelay: short ? '0ms' : '900ms' }}>
          <LogoMark size={short ? 96 : 84} />
        </div>
        <p className="pp-rise mt-4 text-[30px] font-extrabold tracking-tight text-[#FFFFFF]" style={{ animationDelay: short ? '80ms' : '1100ms' }}>
          Pavement<span className="text-[#FFD60A]">PINN</span>
        </p>
        <p className="pp-rise mt-1 text-sm font-semibold text-[#FFFFFF]/60" style={{ animationDelay: short ? '120ms' : '1250ms' }}>
          Potret jalan rusak. Kami kawal sampai beres.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <RouterProvider>
      <SessionProvider>
        <AppStateProvider>
          <GlobalModalsProvider>
            <AppErrorBoundary>
              <div className="flex h-[100dvh] flex-col overflow-hidden bg-[#0B0D10]">
                <ServerVersionBanner />
                <div className="relative min-h-0 flex-1 overflow-hidden">
                  <AppShell />
                </div>
                <Splash />
              </div>
            </AppErrorBoundary>
          </GlobalModalsProvider>
        </AppStateProvider>
      </SessionProvider>
    </RouterProvider>
  );
}
