/**
 * Staff home and case screens, plus the public case, why, tour and verify pages, on the app's own
 * look. A staff member signs in on the login page and sees only what their role does.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Wordmark } from '../../components/ui/brand';
import { useRouter } from '../../app/router';
import type { V5Role } from '../../domain/v5/model';
import { V6_ROLE_NAMES, type V6Role } from '../../domain/v6/roles';
import { ensureDeviceSession, lockSession, setPinAsker, signOutStaff, staffSessionActive, v5 } from '../../features/roles/api';
import { TeamPanel } from '../../features/roles/TeamPanel';
import { V5Context, useV5, type StaffPerson } from '../../features/roles/context';
import { AdminHome, CaseScreen, HeadHome } from '../../features/roles/StaffPages';
import { AuditModule, FieldModule, InboxModule, MODULES_BY_ROLE, MODULE_ICON, MODULE_LABEL, MonitorModule, ReportModule, SettingsModule, TodayModule, WorkModule, type ModuleId } from '../../features/roles/Modules';
import { CostModule } from '../../features/roles/CostModule';
import { TrackPage } from '../../features/roles/TrackPages';
import { TourPage as Tour, VerifyPage as Verify, WhyPage as Why } from '../../features/roles/PublicPages';
import { Card } from '../../features/roles/ui';
import '../../features/roles/roles.css';

interface Me { role: V5Role; accountId: string; displayName: string | null; v6Role: V6Role | null; agencyName: string | null }

const PinDialog: React.FC<{ onDone: (pin: string | null) => void }> = ({ onDone }) => {
  const [pin, setPin] = useState('');
  return (
    <div className="v5-pin-backdrop" role="dialog" aria-modal="true" aria-label="Masukkan PIN">
      <form className="v5-card v5-pin-card" onSubmit={(e) => { e.preventDefault(); onDone(pin); }}>
        <h2 className="v5-card-title">Masukkan PIN untuk melanjutkan</h2>
        <input className="v5-pin-input" type="password" inputMode="numeric" autoComplete="off" autoFocus maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} data-testid="v6-reauth-pin" />
        <div className="v5-row-between">
          <button type="button" className="v5-btn" onClick={() => onDone(null)}>Batal</button>
          <button type="submit" className="v5-btn v5-btn-primary" disabled={pin.length !== 6} data-testid="v6-reauth-ok">Lanjut</button>
        </div>
      </form>
    </div>
  );
};

const Provider: React.FC<{ staffOnly?: boolean; module?: ModuleId; children: React.ReactNode }> = ({ staffOnly = false, module, children }) => {
  const { navigate } = useRouter();
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [staff, setStaff] = useState<StaffPerson[]>([]);
  const [more, setMore] = useState(false);
  const [pinRequest, setPinRequest] = useState<((pin: string | null) => void) | null>(null);

  useEffect(() => {
    setPinAsker(() => new Promise((resolve) => setPinRequest(() => resolve)));
    return () => setPinAsker(null);
  }, []);

  useEffect(() => {
    (async () => {
      if (staffSessionActive()) {
        try {
          const who = await v5<Me>('/me');
          setMe(who);
          if (who.v6Role === 'OM' || who.v6Role === 'FE') setStaff(await v5<StaffPerson[]>('/staff'));
          setReady(true);
          return;
        } catch {
          await lockSession();
        }
      }
      if (staffOnly) {
        navigate('/login/');
        return;
      }
      await ensureDeviceSession();
      setReady(true);
    })().catch(() => setReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffOnly]);

  const signOut = useCallback(() => { signOutStaff(); navigate('/login/'); }, [navigate]);
  const lock = useCallback(() => { void lockSession().then(() => navigate('/login/')); }, [navigate]);
  const modules = me?.v6Role ? MODULES_BY_ROLE[me.v6Role] : [];
  const value = useMemo(() => ({
    role: (me?.role ?? 'CITIZEN') as V5Role,
    v6Role: me?.v6Role ?? null,
    accountId: me?.accountId ?? null,
    staff,
    signOut,
    go: (to: string) => navigate(to)
  }), [me, staff, signOut, navigate]);
  const open = (m: ModuleId) => { setMore(false); navigate(m === 'today' ? '/kerja/' : `/kerja/m/${m}/`); };
  const NavButton = (m: ModuleId, place: string) => (
    <button key={`${place}-${m}`} type="button" className={`v6-nav-item${m === module ? ' v6-nav-on' : ''}`} onClick={() => open(m)} aria-current={m === module ? 'page' : undefined} data-testid={`v6-${place}-${m}`}>
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.800" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={MODULE_ICON[m]} /></svg>
      <span>{MODULE_LABEL[m]}</span>
    </button>
  );

  return (
    <V5Context.Provider value={value}>
      <div className="v5-shell">
        <Top me={me} lock={lock} />
        <div className={modules.length > 1 ? 'v6-layout' : undefined}>
          {modules.length > 1 && <nav className="v6-side" aria-label="Menu workspace">{modules.map((m) => NavButton(m, 'side'))}</nav>}
          <main className="v5-page">{ready ? children : <Card><p>Memuat…</p></Card>}</main>
        </div>
        {modules.length > 1 && (
          <nav className="v6-bottom" aria-label="Menu workspace">
            {modules.slice(0, modules.length > 5 ? 4 : 5).map((m) => NavButton(m, 'tab'))}
            {modules.length > 5 && <button type="button" className={`v6-nav-item${modules.indexOf(module ?? 'today') >= 4 ? ' v6-nav-on' : ''}`} onClick={() => setMore(!more)} data-testid="v6-tab-more"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.800" /><circle cx="12" cy="12" r="1.800" /><circle cx="19" cy="12" r="1.800" /></svg><span>Lainnya</span></button>}
          </nav>
        )}
        {more && <div className="v6-more" data-testid="v6-more-sheet">{modules.slice(4).map((m) => NavButton(m, 'more'))}</div>}
      </div>
      {pinRequest && <PinDialog onDone={(pin) => { pinRequest(pin); setPinRequest(null); }} />}
    </V5Context.Provider>
  );
};

const Top: React.FC<{ me: Me | null; lock: () => void }> = ({ me, lock }) => {
  const { accountId, signOut, go } = useV5();
  const badge = me?.v6Role ? V6_ROLE_NAMES[me.v6Role] : null;
  return (
    <header className="v5-top">
      <button type="button" onClick={() => go(accountId ? '/kerja/' : '/beranda/')} aria-label="Beranda" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }}><Wordmark /></button>
      {accountId && badge && (
        <span className="v5-top-who">
          <span className="v5-agency" data-testid="v6-agency-name">{me?.agencyName}</span>
          <span className="v5-role-badge" style={{ color: badge.color, borderColor: badge.color }} data-testid="v5-role-name" title={badge.id}>{badge.short}</span>
          {me?.v6Role !== 'CONTRACTOR' && <button type="button" className="v5-link" onClick={lock} data-testid="v6-lock">Kunci</button>}
          <button type="button" className="v5-link" onClick={signOut} data-testid="v5-sign-out">Keluar</button>
        </span>
      )}
    </header>
  );
};

type Params = { params: Record<string, string> };
const ModuleView: React.FC<{ module: ModuleId }> = ({ module }) => {
  const { v6Role } = useV5();
  // A module outside this person's role is not there at all (§2.4).
  if (!v6Role || !MODULES_BY_ROLE[v6Role].includes(module)) return <TodayModule />;
  switch (module) {
    case 'inbox': return <InboxModule />;
    case 'field': return <FieldModule />;
    case 'work': return <WorkModule />;
    case 'cost': return <CostModule />;
    case 'monitor': return <MonitorModule />;
    case 'report': return <ReportModule head={v6Role === 'FE' ? null : <HeadHome />} />;
    case 'audit': return <AuditModule />;
    case 'team': return <TeamPanel />;
    case 'settings': return <SettingsModule admin={<AdminHome />} />;
    default: return <TodayModule />;
  }
};

export const StaffHomePage: React.FC<Params> = ({ params }) => {
  const module = (params.module ?? 'today') as ModuleId;
  return <Provider staffOnly module={module}><ModuleView module={module} /></Provider>;
};
export const CasePage: React.FC<Params> = ({ params }) => <Provider staffOnly module="inbox"><CaseScreen id={params.id} /></Provider>;
export const PublicTrackPage: React.FC<Params> = ({ params }) => <Provider><TrackPage code={params.code} /></Provider>;
export const WhyPage: React.FC<Params> = () => <Provider><Why /></Provider>;
export const TourPage: React.FC<Params> = () => <Provider><Tour /></Provider>;
export const VerifyPage: React.FC<Params> = () => <Provider><Verify /></Provider>;
export const VerifyDocPage: React.FC<Params> = ({ params }) => <Provider><Verify docId={params.docId} /></Provider>;
