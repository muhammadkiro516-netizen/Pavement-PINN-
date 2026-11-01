import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, FlaskConical, Home, Map as MapIcon, Plus } from 'lucide-react';
import type { V5Role } from '../domain/v5/model';
import { V5_ROLE_NAMES } from '../domain/v5/model';
import { setSessionToken, sessionToken, v5 } from './api';
import { V5Context, type DemoAccount } from './context';
import { MyReportsCard, ReportPage, TrackPage } from './CitizenPages';
import { CaseScreen, StaffHome } from './StaffPages';
import { MapPage, MeasurementsPage, TourPage, VerifyPage, WhyPage } from './PublicPages';
import { Card, RolePavi } from './ui';
import './v5.css';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
const DEVICE_KEY = 'v5.device';
const ACCOUNT_KEY = 'v5.account';
const DEMO_KEY = 'v5.demoToggle';

const readStore = (store: 'local' | 'session', key: string) => { try { return (store === 'local' ? localStorage : sessionStorage).getItem(key); } catch { return null; } };
const writeStore = (store: 'local' | 'session', key: string, value: string | null) => { try { const s = store === 'local' ? localStorage : sessionStorage; if (value === null) s.removeItem(key); else s.setItem(key, value); } catch { /* storage may be blocked: the session lasts for this page. */ } };

const currentPath = () => window.location.pathname.slice(BASE.length) || '/';

async function citizenSession(): Promise<void> {
  const saved = readStore('local', DEVICE_KEY);
  if (saved) {
    setSessionToken(saved);
    try { await v5('/me'); return; } catch { /* expired: make a new device identity. */ }
  }
  setSessionToken(null);
  const session = await v5<{ token: string }>('/session/device', {});
  writeStore('local', DEVICE_KEY, session.token);
  setSessionToken(session.token);
}

export default function V5App() {
  const [path, setPath] = useState(currentPath);
  const [ready, setReady] = useState(false);
  const [demoServer, setDemoServer] = useState(false);
  const [demoOn, setDemoOn] = useState(readStore('session', DEMO_KEY) !== 'off');
  const [accounts, setAccounts] = useState<DemoAccount[]>([]);
  const [account, setAccount] = useState<DemoAccount | null>(null);

  const go = useCallback((to: string) => {
    window.history.pushState(null, '', `${BASE}${to}`);
    setPath(to);
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    const onPop = () => setPath(currentPath());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const switchRole = useCallback(async (accountId: string | null) => {
    if (accountId) {
      const session = await v5<{ token: string; account: DemoAccount }>('/session', { accountId });
      setSessionToken(session.token);
      setAccount(session.account);
      writeStore('session', ACCOUNT_KEY, accountId);
    } else {
      await citizenSession();
      setAccount(null);
      writeStore('session', ACCOUNT_KEY, null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const config = await v5<{ demoMode: boolean }>('/config');
      setDemoServer(config.demoMode);
      if (config.demoMode) setAccounts(await v5<DemoAccount[]>('/demo/accounts'));
      const saved = config.demoMode ? readStore('session', ACCOUNT_KEY) : null;
      if (saved && sessionToken()) {
        await switchRole(saved).catch(() => citizenSession());
      } else {
        await citizenSession();
      }
      setReady(true);
    })().catch(() => setReady(true));
  }, [switchRole]);

  const value = useMemo(() => ({
    demoServer,
    demoEnabled: demoServer && demoOn,
    setDemoEnabled: (on: boolean) => { setDemoOn(on); writeStore('session', DEMO_KEY, on ? 'on' : 'off'); },
    role: (account?.role ?? 'CITIZEN') as V5Role,
    account,
    accounts,
    switchRole,
    go
  }), [demoServer, demoOn, account, accounts, switchRole, go]);

  const role = value.role;
  return (
    <V5Context.Provider value={value}>
      <header className="v5-appbar">
        <button type="button" className="v5-brand" onClick={() => go('/v5/')}>PAVEMENT-PINN</button>
        {demoServer && (
          <label className="v5-rolechip">
            <span>Viewing as</span>
            <span className="v5-rolechip-box">
              <select
                value={account?.accountId ?? 'CITIZEN'}
                data-testid="v5-role-switch"
                aria-label="Switch demo role"
                onChange={(e) => { void switchRole(e.target.value === 'CITIZEN' ? null : e.target.value).then(() => { if (!/^\/v5\/t\//.test(window.location.pathname.slice(BASE.length))) go('/v5/'); }); }}
              >
                <option value="CITIZEN">Citizen (no login)</option>
                {accounts.map((a) => <option key={a.accountId} value={a.accountId}>{a.displayName}</option>)}
              </select>
              <ChevronDown size={14} aria-hidden="true" />
            </span>
          </label>
        )}
      </header>
      {demoServer && (
        <div className="v5-demo-banner" role="status" data-testid="v5-demo-banner">
          <FlaskConical size={16} aria-hidden="true" />
          <span>{demoOn ? 'DEMO MODE — sample data. Not a live capture.' : 'Demo server. Sample photos are off: live camera only.'}</span>
          <label className="v5-check"><input type="checkbox" checked={demoOn} onChange={(e) => value.setDemoEnabled(e.target.checked)} data-testid="v5-demo-toggle" /> Demo mode</label>
        </div>
      )}
      <main className="v5-page">
        {!ready ? <Card><p>Loading…</p></Card> : <Page path={path} role={role} />}
      </main>
      <nav className="v5-nav" aria-label="Main">
        <button type="button" onClick={() => go('/v5/')} className={path === '/v5/' || path === '/v5' ? 'is-on' : ''}><Home size={20} aria-hidden="true" />Home</button>
        <button type="button" onClick={() => go('/v5/map')} className={path === '/v5/map' ? 'is-on' : ''}><MapIcon size={20} aria-hidden="true" />Map</button>
        {role === 'CITIZEN' && <button type="button" onClick={() => go('/v5/report')} className="v5-nav-report" data-testid="v5-nav-report"><Plus size={22} aria-hidden="true" />Report</button>}
        <button type="button" onClick={() => go('/why')} className={path === '/why' ? 'is-on' : ''}>Why</button>
        <button type="button" onClick={() => go('/verify')} className={path.startsWith('/v') && !path.startsWith('/v5') ? 'is-on' : ''}>Verify</button>
      </nav>
    </V5Context.Provider>
  );
}

function Page({ path, role }: { path: string; role: V5Role }) {
  const clean = path.replace(/\/+$/, '') || '/';
  let m: RegExpMatchArray | null;
  if ((m = clean.match(/^\/v5\/t\/([^/]+)$/))) return <TrackPage code={decodeURIComponent(m[1])} />;
  if ((m = clean.match(/^\/v5\/case\/([^/]+)$/))) return <CaseScreen id={decodeURIComponent(m[1])} />;
  if ((m = clean.match(/^\/v\/([^/]+)$/))) return <VerifyPage docId={decodeURIComponent(m[1])} />;
  if (clean === '/v5/report') return role === 'CITIZEN' ? <ReportPage /> : <Card><p>Reports come from citizens. Switch to Citizen to try it.</p></Card>;
  if (clean === '/v5/map') return <MapPage />;
  if (clean === '/v5/measurements') return <MeasurementsPage />;
  if (clean === '/tour') return <TourPage />;
  if (clean === '/why') return <WhyPage />;
  if (clean === '/verify') return <VerifyPage />;
  if (clean === '/v5') return role === 'CITIZEN' ? <CitizenHome /> : <StaffHome />;
  return <Card title="Page not found"><p>This page does not exist.</p></Card>;
}

function CitizenHome() {
  const [code, setCode] = useState('');
  return (
    <V5Context.Consumer>
      {({ go, demoServer }) => (
        <>
          <Card testId="v5-home">
            <div className="v5-hero">
              <RolePavi role="CITIZEN" size={80} />
              <div>
                <h1 className="v5-title">Report · Escort · Audit</h1>
                <p>Send a photo of road damage. We find the agency that owns the road and keep the case visible until it is fixed.</p>
              </div>
            </div>
            <button type="button" className="v5-btn v5-btn-primary v5-btn-wide" onClick={() => go('/v5/report')} data-testid="v5-report-damage">Report damage</button>
            <p className="v5-caption">No login. No name. {V5_ROLE_NAMES.CITIZEN.en} reports are pseudonymous.</p>
          </Card>
          <MyReportsCard />
          <Card title="Track a report">
            <form className="v5-row" onSubmit={(e) => { e.preventDefault(); if (code.trim()) go(`/v5/t/${encodeURIComponent(code.trim().toUpperCase())}`); }}>
              <label className="v5-field"><span>Tracking code</span><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="JKT-XXXXXX" data-testid="v5-track-input" /></label>
              <button type="submit" className="v5-btn" data-testid="v5-track-go">Open</button>
            </form>
          </Card>
          <Card title="Learn more">
            <div className="v5-row">
              {demoServer && <button type="button" className="v5-btn" onClick={() => go('/tour')} data-testid="v5-open-tour">60-second tour</button>}
              <button type="button" className="v5-btn" onClick={() => go('/why')}>Why this matters</button>
              <button type="button" className="v5-btn" onClick={() => go('/v5/measurements')}>Test results</button>
            </div>
          </Card>
        </>
      )}
    </V5Context.Consumer>
  );
}
