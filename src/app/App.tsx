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

/** Opening animation (about 2 s) shown each time the site is opened. */
function Splash() {
  const [phase, setPhase] = useState<'in' | 'out' | 'gone'>('in');
  useEffect(() => {
    const a = window.setTimeout(() => setPhase('out'), 1700);
    const b = window.setTimeout(() => setPhase('gone'), 2100);
    return () => {
      window.clearTimeout(a);
      window.clearTimeout(b);
    };
  }, []);
  if (phase === 'gone') return null;
  return (
    <div
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-gradient-to-br from-[#0E1B2C] via-[#1463FF] to-[#FF7A1A] transition-opacity duration-400 ${phase === 'out' ? 'opacity-0' : 'opacity-100'}`}
      aria-hidden="true"
    >
      <div className="pp-pop">
        <LogoMark size={104} />
      </div>
      <p className="pp-rise mt-5 text-3xl font-extrabold tracking-tight text-[#FFFFFF]" style={{ animationDelay: '250ms' }}>
        Pavement<span className="text-[#FFE14D]">PINN</span>
      </p>
      <p className="pp-rise mt-2 text-sm font-semibold text-[#FFFFFF]/80" style={{ animationDelay: '450ms' }}>Potret jalan rusak. Kami kawal sampai beres.</p>
      <div className="mt-8 h-1 w-40 overflow-hidden rounded-full bg-[#FFFFFF]/25">
        <div className="h-full rounded-full bg-[#FFFFFF]" style={{ animation: 'pp-load 1.7s ease-out forwards' }} />
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
              <div className="pp-light flex h-[100dvh] flex-col overflow-hidden bg-[#F4F7FC]">
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
