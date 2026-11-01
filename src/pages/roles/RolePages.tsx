/**
 * Staff home and case screens, plus the public case, why, tour and verify pages, on the app's own
 * look. A staff member signs in on the login page and sees only what their role does.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Wordmark } from '../../components/ui/brand';
import { useRouter } from '../../app/router';
import { V5_ROLE_NAMES, type V5Role } from '../../domain/v5/model';
import { ensureDeviceSession, signOutStaff, staffSessionActive, v5 } from '../../features/roles/api';
import { V5Context, useV5, type StaffPerson } from '../../features/roles/context';
import { CaseScreen, StaffHome } from '../../features/roles/StaffPages';
import { TrackPage } from '../../features/roles/TrackPages';
import { TourPage as Tour, VerifyPage as Verify, WhyPage as Why } from '../../features/roles/PublicPages';
import { Card } from '../../features/roles/ui';
import '../../features/roles/roles.css';

interface Me { role: V5Role; accountId: string; displayName: string | null }

const Provider: React.FC<{ staffOnly?: boolean; children: React.ReactNode }> = ({ staffOnly = false, children }) => {
  const { navigate } = useRouter();
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [staff, setStaff] = useState<StaffPerson[]>([]);

  useEffect(() => {
    (async () => {
      if (staffSessionActive()) {
        try {
          const who = await v5<Me>('/me');
          setMe(who);
          setStaff(await v5<StaffPerson[]>('/staff'));
          setReady(true);
          return;
        } catch {
          signOutStaff();
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
  const value = useMemo(() => ({ role: (me?.role ?? 'CITIZEN') as V5Role, accountId: me?.accountId ?? null, staff, signOut, go: (to: string) => navigate(to) }), [me, staff, signOut, navigate]);

  return (
    <V5Context.Provider value={value}>
      <div className="v5-shell">
        <Top />
        <main className="v5-page">{ready ? children : <Card><p>Memuat…</p></Card>}</main>
      </div>
    </V5Context.Provider>
  );
};

const Top: React.FC = () => {
  const { role, accountId, signOut, go } = useV5();
  return (
    <header className="v5-top">
      <button type="button" onClick={() => go(accountId ? '/kerja/' : '/beranda/')} aria-label="Beranda" style={{ background: 'none', border: 0, cursor: 'pointer', color: 'inherit' }}><Wordmark /></button>
      {accountId && (
        <span className="v5-top-who">
          <span data-testid="v5-role-name">{V5_ROLE_NAMES[role].id}</span>
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
