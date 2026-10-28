import React, { useState } from 'react';
import { usePageHost } from '../../app/pageContext';
import { useRouter } from '../../app/router';
import { sanitizeNextPath } from '../../app/guards/routeAccess';
import { useAppState } from '../../app/providers/AppStateProvider';
import { accountFromProfile, useSession } from '../../app/providers/SessionProvider';
import { WorkflowApiError } from '../../services/api/workflowClient';
import { SnapInput } from '../../components/ui/snap';
import { LogoMark, Wordmark } from '../../components/ui/brand';

/**
 * Route /login/ — staff sign-in (Petugas Lapangan, Koordinator). Citizens never need it:
 * their account lives on their phone (features/authentication/deviceAccount.ts).
 */
export const LoginPage: React.FC = () => {
  const { completeLogin } = usePageHost();
  const { endedNotice } = useSession();
  const { query, navigateTo } = useRouter();
  const { workflow } = useAppState();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const signed = await workflow.gateway.login({ username: form.email.trim(), password: form.password });
      if (!signed.account) throw new WorkflowApiError('UNKNOWN_ACCOUNT', 'Akun tidak dikenal.', 0);
      completeLogin(accountFromProfile(signed.account), sanitizeNextPath(query.get('next')));
    } catch (e) {
      const err = e instanceof WorkflowApiError ? e : null;
      setError(
        err?.status === 401
          ? 'Email atau kata sandi salah.'
          : err?.status === 429
            ? 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.'
            : 'Server tidak dapat dihubungi. Periksa koneksi lalu coba lagi.'
      );
      setForm((f) => ({ ...f, password: '' }));
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full w-full items-center justify-center bg-gradient-to-b from-[#111113] to-[#000000] px-4 py-10 text-[#FFFFFF]">
      <div className="pp-rise w-full max-w-sm">
        <button type="button" onClick={() => navigateTo('landing')} className="mx-auto mb-6 flex cursor-pointer items-center gap-2.5">
          <LogoMark size={44} />
          <Wordmark />
        </button>
        <div className="rounded-[32px] border border-[#2C2C2E] bg-[#1C1C1E] p-6 shadow-[0_24px_60px_-28px_rgba(14,27,44,0.35)]">
          <h1 className="text-2xl font-extrabold tracking-tight">Masuk petugas</h1>
          <p className="mt-1 text-sm text-[#A1A1AA]">Untuk petugas lapangan dan koordinator instansi.</p>
          {endedNotice && <p className="mt-3 rounded-2xl bg-[#2C2C2E] p-3 text-sm text-[#FFE14D]">{endedNotice}</p>}
          <form onSubmit={submit} className="mt-5 space-y-3">
            <SnapInput id="l-email" label="Email" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            <SnapInput id="l-pass" label="Kata sandi" type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
            {error && <p role="alert" className="rounded-2xl bg-[#3A1416] p-3 text-sm text-[#FF6B6B]">{error}</p>}
            <button type="submit" disabled={busy} className="flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-[#FFE14D] text-[15px] font-extrabold text-[#000000] shadow-[0_10px_24px_-10px_rgba(20,99,255,0.7)] disabled:opacity-60">
              {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
              Masuk
            </button>
          </form>
          <p className="mt-4 text-center text-xs text-[#8E8E93]">Akun petugas dibuat oleh koordinator instansi.</p>
        </div>
        <button type="button" onClick={() => navigateTo('landing')} className="mt-5 w-full cursor-pointer text-center text-sm font-bold text-[#FF7A1A]">
          Warga? Lapor tanpa daftar
        </button>
      </div>
    </div>
  );
};
