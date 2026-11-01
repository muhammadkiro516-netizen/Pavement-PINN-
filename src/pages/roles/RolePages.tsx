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
import { CaseScreen, StaffHome } from '../../features/roles/StaffPages';
import { TrackPage } from '../../features/roles/TrackPages';
import { TourPage as Tour, VerifyPage as Verify, WhyPage as Why } from '../../features/roles/PublicPages';
import { Card } from '../../features/roles/ui';
import '../../features/roles/roles.css';

interface Me { role: V5Role; accountId: string; displayName: string | null; v6Role: V6Role | null; agencyName: string | null }

const DUTY_TABS: Partial<Record<V6Role, { id: string; duty: V5Role | null; label: string }[]>> = {
  OM: [
    { id: 'COORDINATOR', duty: 'COORDINATOR', label: 'Antrian' },
    { id: 'APPROVER', duty: 'APPROVER', label: 'Setujui' },
    { id: 'AGENCY_HEAD', duty: 'AGENCY_HEAD', label: 'Ringkasan' },
    { id: 'ADMIN', duty: 'ADMIN', label: 'Data' },
    { id: 'TEAM', duty: null, label: 'Tim & Kode' }
  ],
  FE: [
    { id: 'FIELD_INSPECTOR', duty: 'FIELD_INSPECTOR', label: 'Tugasku' },
    { id: 'SUPERVISOR', duty: 'SUPERVISOR', label: 'Periksa hasil' }
  ],
  AUDITOR: [
    { id: 'AUDITOR', duty: 'AUDITOR', label: 'Temuan' },
    { id: 'TEAM', duty: null, label: 'Log masuk' }
  ]
};

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

const Provider: React.FC<{ staffOnly?: boolean; children: React.ReactNode }> = ({ staffOnly = false, children }) => {
  const { navigate } = useRouter();
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [staff, setStaff] = useState<StaffPerson[]>([]);
  const [tab, setTab] = useState<string | null>(null);
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
  const tabs = me?.v6Role ? DUTY_TABS[me.v6Role] ?? [] : [];
  const current = tabs.find((t) => t.id === tab) ?? tabs[0];
  const value = useMemo(() => ({
    role: (current?.duty ?? me?.role ?? 'CITIZEN') as V5Role,
    v6Role: me?.v6Role ?? null,
    accountId: me?.accountId ?? null,
    staff,
    signOut,
    go: (to: string) => navigate(to)
  }), [current, me, staff, signOut, navigate]);

  return (
    <V5Context.Provider value={value}>
      <div className="v5-shell">
        <Top me={me} lock={lock} />
        {tabs.length > 1 && (
          <nav className="v5-tabs" aria-label="Bagian kerja">
            {tabs.map((t) => (
              <button key={t.id} type="button" className={`v5-tab${t.id === current?.id ? ' v5-tab-on' : ''}`} onClick={() => { setTab(t.id); navigate('/kerja/'); }} data-testid={`v6-tab-${t.id}`}>{t.label}</button>
            ))}
          </nav>
        )}
        <main className="v5-page">{!ready ? <Card><p>Memuat…</p></Card> : current && current.duty === null ? <TeamPanel /> : children}</main>
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
export const StaffHomePage: React.FC<Params> = () => <Provider staffOnly><StaffHome /></Provider>;
export const CasePage: React.FC<Params> = ({ params }) => <Provider staffOnly><CaseScreen id={params.id} /></Provider>;
export const PublicTrackPage: React.FC<Params> = ({ params }) => <Provider><TrackPage code={params.code} /></Provider>;
export const WhyPage: React.FC<Params> = () => <Provider><Why /></Provider>;
export const TourPage: React.FC<Params> = () => <Provider><Tour /></Provider>;
export const VerifyPage: React.FC<Params> = () => <Provider><Verify /></Provider>;
export const VerifyDocPage: React.FC<Params> = ({ params }) => <Provider><Verify docId={params.docId} /></Provider>;
