/**
 * Role workspaces on the original app's look: Peran (choose a role), Kerja (a case), Pantau (public
 * timeline), Kenapa, Tur, and Verifikasi. They use the v5 API; see UI_FIXTURES.md for what joins the
 * original report store in Prompt 3.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Wordmark } from '../../components/ui/brand';
import { useRouter } from '../../app/router';
import { V5_ROLE_NAMES, type V5Role } from '../../domain/v5/model';
import { setSessionToken, sessionToken, v5 } from '../../features/roles/api';
import { V5Context, useV5, type DemoAccount } from '../../features/roles/context';
import { CaseScreen, StaffHome } from '../../features/roles/StaffPages';
import { TrackPage } from '../../features/roles/TrackPages';
import { TourPage as Tour, VerifyPage as Verify, WhyPage as Why } from '../../features/roles/PublicPages';
import { Card, RolePavi } from '../../features/roles/ui';
import '../../features/roles/roles.css';

const DEVICE_KEY = 'pp-v5-device';
const ACCOUNT_KEY = 'pp-v5-account';

const read = (s: 'local' | 'session', k: string) => { try { return (s === 'local' ? localStorage : sessionStorage).getItem(k); } catch { return null; } };
const write = (s: 'local' | 'session', k: string, v: string | null) => { try { const st = s === 'local' ? localStorage : sessionStorage; if (v === null) st.removeItem(k); else st.setItem(k, v); } catch { /* Storage may be blocked: the session lasts for this page. */ } };

async function deviceSession() {
  const saved = read('local', DEVICE_KEY);
  if (saved) {
    setSessionToken(saved);
    try { await v5('/me'); return; } catch { /* Expired: a new device identity below. */ }
  }
  setSessionToken(null);
  const s = await v5<{ token: string }>('/session/device', {});
  write('local', DEVICE_KEY, s.token);
  setSessionToken(s.token);
}

const ROLE_ROLE_TEXT: Record<V5Role, string> = {
  CITIZEN: 'Lapor jalan rusak dan kawal sampai selesai.',
  FIELD_INSPECTOR: 'Ukur di lokasi, hitung umur dan biaya, usulkan perbaikan.',
  COORDINATOR: 'Pilah laporan, tugaskan petugas, terbitkan perintah kerja.',
  APPROVER: 'Setujui rencana perbaikan dan terima hasilnya.',
  REPAIR_CREW: 'Kirim foto bukti sebelum, selama, dan sesudah perbaikan.',
  SUPERVISOR: 'Periksa bukti perbaikan dan foto sendiri di lokasi.',
  AUDITOR: 'Baca semua catatan dan buat laporan audit.',
  AGENCY_HEAD: 'Pantau kasus yang terlambat dan eskalasi.',
  ADMIN: 'Lihat data wilayah, harga, dan sumbernya.'
};

const SHORT_NAME: Record<string, string> = { 'ACC-COORD': 'Koordinator', 'ACC-COORD-2': 'Koordinator tujuan', 'ACC-INSPECT': 'Petugas', 'ACC-APPROVE': 'Penyetuju', 'ACC-INSPECT-AS-APPROVER': 'Petugas rangkap penyetuju', 'ACC-CREW': 'Regu perbaikan', 'ACC-SUPERVISE': 'Pengawas', 'ACC-AUDIT': 'Auditor', 'ACC-HEAD': 'Pimpinan', 'ACC-ADMIN': 'Admin' };

const Provider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { navigate } = useRouter();
  const [ready, setReady] = useState(false);
  const [demoServer, setDemoServer] = useState(false);
  const [accounts, setAccounts] = useState<DemoAccount[]>([]);
  const [account, setAccount] = useState<DemoAccount | null>(null);

  const switchRole = useCallback(async (accountId: string | null) => {
    if (accountId) {
      const s = await v5<{ token: string; account: DemoAccount }>('/session', { accountId });
      setSessionToken(s.token);
      setAccount(s.account);
      write('session', ACCOUNT_KEY, accountId);
    } else {
      await deviceSession();
      setAccount(null);
      write('session', ACCOUNT_KEY, null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const config = await v5<{ demoMode: boolean }>('/config');
      setDemoServer(config.demoMode);
      if (config.demoMode) setAccounts(await v5<DemoAccount[]>('/demo/accounts'));
      const saved = config.demoMode ? read('session', ACCOUNT_KEY) : null;
      if (saved && sessionToken()) await switchRole(saved).catch(() => deviceSession());
      else await deviceSession();
      setReady(true);
    })().catch(() => setReady(true));
  }, [switchRole]);

  const value = useMemo(() => ({ demoServer, demoEnabled: demoServer, setDemoEnabled: () => undefined, role: (account?.role ?? 'CITIZEN') as V5Role, account, accounts, switchRole, go: (to: string) => navigate(to) }), [demoServer, account, accounts, switchRole, navigate]);

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
  const { accounts, account, switchRole, go, demoServer } = useV5();
  return (
    <header className="v5-top">
      <button type="button" onClick={() => go('/peran/')} aria-label="Semua peran" style={{ background: 'none', border: 0, cursor: 'pointer', color: 'inherit' }}><Wordmark /></button>
      {demoServer && (
        <select value={account?.accountId ?? 'CITIZEN'} data-testid="v5-role-switch" aria-label="Ganti peran" onChange={(e) => { void switchRole(e.target.value === 'CITIZEN' ? null : e.target.value).then(() => { if (!window.location.pathname.includes('/pantau/')) go('/peran/'); }); }}>
          <option value="CITIZEN">Warga</option>
          {accounts.map((a) => <option key={a.accountId} value={a.accountId}>{SHORT_NAME[a.accountId] ?? V5_ROLE_NAMES[a.role].id}</option>)}
        </select>
      )}
    </header>
  );
};

const RoleChooser: React.FC = () => {
  const { accounts, switchRole, go } = useV5();
  const pick = (a: DemoAccount | null) => void switchRole(a?.accountId ?? null).then(() => { if (!a) go('/beranda/'); });
  const main = accounts.filter((a) => a.accountId !== 'ACC-COORD-2' && a.accountId !== 'ACC-INSPECT-AS-APPROVER');
  return (
    <>
      <h1 className="v5-title" style={{ fontSize: 28 }}>Pilih peran</h1>
      <p className="v5-muted">Setiap peran hanya melihat tugasnya sendiri.</p>
      <div className="v5-role-grid" data-testid="v5-roles">
        <button type="button" className="v5-role-card pp-rise" onClick={() => pick(null)}><RolePavi role="CITIZEN" size={52} /><span><strong>{V5_ROLE_NAMES.CITIZEN.id}</strong><span>{ROLE_ROLE_TEXT.CITIZEN}</span></span></button>
        {main.map((a, i) => (
          <button key={a.accountId} type="button" className="v5-role-card pp-rise" style={{ animationDelay: `${(i + 1) * 50}ms` }} onClick={() => pick(a)} data-testid={`v5-role-${a.accountId}`}>
            <RolePavi role={a.role} size={52} />
            <span><strong>{V5_ROLE_NAMES[a.role].id}</strong><span>{ROLE_ROLE_TEXT[a.role]}</span></span>
          </button>
        ))}
      </div>
      <div className="v5-row" style={{ marginTop: 16 }}>
        <button type="button" className="v5-btn" onClick={() => go('/tour/')} data-testid="v5-open-tour">Tur 60 detik</button>
        <button type="button" className="v5-btn" onClick={() => go('/why/')}>Kenapa penting</button>
        <button type="button" className="v5-btn" onClick={() => go('/verify/')}>Periksa laporan</button>
        <button type="button" className="v5-btn" onClick={() => go('/bukti/')}>Hasil uji</button>
      </div>
    </>
  );
};

const RoleHome: React.FC = () => {
  const { role } = useV5();
  return role === 'CITIZEN' ? <RoleChooser /> : <StaffHome />;
};

type Params = { params: Record<string, string> };
export const RolesPage: React.FC<Params> = () => <Provider><RoleHome /></Provider>;
export const CasePage: React.FC<Params> = ({ params }) => <Provider><CaseScreen id={params.id} /></Provider>;
export const PublicTrackPage: React.FC<Params> = ({ params }) => <Provider><TrackPage code={params.code} /></Provider>;
export const WhyPage: React.FC<Params> = () => <Provider><Why /></Provider>;
export const TourPage: React.FC<Params> = () => <Provider><Tour /></Provider>;
export const VerifyPage: React.FC<Params> = () => <Provider><Verify /></Provider>;
export const VerifyDocPage: React.FC<Params> = ({ params }) => <Provider><Verify docId={params.docId} /></Provider>;
