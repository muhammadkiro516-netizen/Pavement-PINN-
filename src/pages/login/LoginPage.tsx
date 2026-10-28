import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import logoImg from '../../assets/pavement-pinn-logo.jpg';
import { usePageHost } from '../../app/pageContext';
import { useRouter } from '../../app/router';
import { sanitizeNextPath } from '../../app/guards/routeAccess';
import { useAppState } from '../../app/providers/AppStateProvider';
import { accountFromProfile, useSession } from '../../app/providers/SessionProvider';
import { WorkflowApiError, type SignedIn } from '../../services/api/workflowClient';
import { SnapInput } from '../../components/ui/snap';

/**
 * Route /login/ — sign in or create a citizen account (real accounts, docs/LEAN_PLAN.md).
 * Staff accounts are created by a Koordinator, so staff only sign in here.
 */
export const LoginPage: React.FC = () => {
  const { completeLogin } = usePageHost();
  const { endedNotice } = useSession();
  const { query, navigateTo } = useRouter();
  const { workflow } = useAppState();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const signed: SignedIn =
        mode === 'login'
          ? await workflow.gateway.login({ username: form.email.trim(), password: form.password })
          : await workflow.gateway.register({ email: form.email.trim(), name: form.name.trim(), password: form.password });
      if (!signed.account) throw new WorkflowApiError('UNKNOWN_ACCOUNT', 'Akun tidak dikenal.', 0);
      completeLogin(accountFromProfile(signed.account), sanitizeNextPath(query.get('next')));
    } catch (e) {
      const err = e instanceof WorkflowApiError ? e : null;
      setError(
        err?.status === 401
          ? 'Email atau kata sandi salah.'
          : err?.status === 429
            ? 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.'
            : err?.message && err.status && err.status < 500
              ? err.message
              : 'Server tidak dapat dihubungi. Periksa koneksi lalu coba lagi.'
      );
      setForm((f) => ({ ...f, password: '' }));
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full w-full items-center justify-center bg-[#FFE14D] px-4 py-10 text-black">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src={logoImg} alt="" className="h-20 w-20 rounded-[28px] object-cover shadow-lg" />
          <h1 className="mt-4 text-3xl font-extrabold tracking-tight">PAVEMENT-PINN</h1>
          <p className="mt-1 text-sm font-semibold text-black/70">Potret jalan rusak. AI dan petugas menanganinya sampai tuntas.</p>
        </div>
        <div className="rounded-[32px] bg-[#0B0B0C] p-5 text-white shadow-2xl">
          <div className="mb-4 grid grid-cols-2 gap-1 rounded-full bg-white/10 p-1">
            {(['login', 'register'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => { setMode(m); setError(null); }}
                className={`cursor-pointer rounded-full py-2.5 text-sm font-extrabold ${mode === m ? 'bg-[#FFE14D] text-black' : 'text-white/70'}`}
              >
                {m === 'login' ? 'Masuk' : 'Daftar'}
              </button>
            ))}
          </div>
          {endedNotice && mode === 'login' && <p className="mb-3 rounded-2xl bg-white/10 p-3 text-sm">{endedNotice}</p>}
          <form onSubmit={submit} className="space-y-3">
            {mode === 'register' && (
              <SnapInput id="r-name" label="Nama" autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} />
            )}
            <SnapInput id="l-email" label="Email" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            <SnapInput
              id="l-pass"
              label={mode === 'register' ? 'Kata sandi (min. 8 karakter)' : 'Kata sandi'}
              type="password"
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              minLength={mode === 'register' ? 8 : undefined}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
            />
            {error && <p role="alert" className="rounded-2xl bg-rose-500/15 p-3 text-sm text-rose-200">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-[#FFE14D] text-[15px] font-extrabold text-black disabled:opacity-60"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === 'login' ? 'Masuk' : 'Buat akun warga'}
            </button>
          </form>
          {mode === 'register' && (
            <p className="mt-3 text-center text-xs text-white/50">Akun petugas dan koordinator dibuat oleh koordinator instansi.</p>
          )}
        </div>
        <button type="button" onClick={() => navigateTo('evidence')} className="mt-5 w-full cursor-pointer text-center text-sm font-bold underline">
          Bagaimana AI kami bekerja
        </button>
      </div>
    </div>
  );
};
