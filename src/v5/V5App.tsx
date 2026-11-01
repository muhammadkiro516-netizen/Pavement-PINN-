import { useEffect, useState } from 'react';
import { V5_ROLE_NAMES } from '../domain/v5/model';
import { setSessionToken, v5 } from './api';
import './v5.css';

interface DemoAccount {
  accountId: string;
  role: keyof typeof V5_ROLE_NAMES;
  displayName: string;
  note?: string;
}

interface VerifyReport {
  ok: boolean;
  checked: number;
  headHash: string;
  truncated: boolean;
  firstFailure: { seq: number; status: string } | null;
}

/** Phase A checkpoint: role switcher and live chain status. The role screens follow in B to E. */
export default function V5App() {
  const [accounts, setAccounts] = useState<DemoAccount[] | null>(null);
  const [demoOff, setDemoOff] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [verify, setVerify] = useState<VerifyReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    v5<DemoAccount[]>('/demo/accounts').then(setAccounts).catch(() => setDemoOff(true));
    v5<VerifyReport>('/public/chain/demo/verify').then(setVerify).catch((e: Error) => setError(e.message));
  }, []);

  async function switchTo(accountId: string | null) {
    setError(null);
    try {
      const session = accountId
        ? await v5<{ token: string; account: DemoAccount }>('/session', { accountId })
        : await v5<{ token: string; pseudonym: string }>('/session/device', {});
      setSessionToken(session.token);
      const me = await v5<{ role: string; displayName: string | null }>('/me');
      setActive(me.displayName ?? 'Citizen (no login)');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <main className="v5-page">
      {!demoOff && <div className="v5-demo-banner" role="status">DEMO MODE. Sample data for judges, not real records.</div>}
      <h1>PAVEMENT-PINN</h1>
      <p className="v5-lead">Report · Escort · Audit</p>

      <section aria-labelledby="v5-roles">
        <h2 id="v5-roles">Switch role</h2>
        {demoOff && <p>Demo roles are off on this server.</p>}
        {active && <p data-testid="v5-active-role">You are: <strong>{active}</strong></p>}
        <div className="v5-roles">
          {!demoOff && <button type="button" onClick={() => switchTo(null)}><strong>Citizen</strong><span>Warga. No login.</span></button>}
          {accounts?.map((a) => (
            <button type="button" key={a.accountId} onClick={() => switchTo(a.accountId)}>
              <strong>{a.displayName}</strong>
              <span>{V5_ROLE_NAMES[a.role].id}{a.note ? `. ${a.note}` : ''}</span>
            </button>
          ))}
        </div>
      </section>

      <section aria-labelledby="v5-chain">
        <h2 id="v5-chain">Event log check</h2>
        {verify ? (
          <p className={verify.ok ? 'v5-ok' : 'v5-bad'} data-testid="v5-chain-status">
            {verify.ok ? `Intact. ${verify.checked} events checked.` : `Failed at event ${verify.firstFailure?.seq ?? 'end of log'}: ${verify.firstFailure?.status ?? 'newest events are missing'}.`}
          </p>
        ) : (
          <p>Checking…</p>
        )}
      </section>

      {error && <p className="v5-bad" role="alert">{error}</p>}
    </main>
  );
}
