import React, { useCallback, useRef, useState } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import logoImg from '../../assets/pavement-pinn-logo.jpg';
import { usePageContext } from '../../app/pageContext';
import { useRouter } from '../../app/router';
import { sanitizeNextPath } from '../../app/guards/routeAccess';
import { useAppState } from '../../app/providers/AppStateProvider';
import { accountFromProfile, isAnonymousAccount, useSession } from '../../app/providers/SessionProvider';
import { USER_ACCOUNTS } from '../../features/authentication/demoAccounts';
import { ROLE_LABELS } from '../../features/authentication/roleLabels';
import { DEMO_ACCESS_ENABLED } from '../../features/authentication/demoAccess';
import { DemoAccessPanel } from '../../features/authentication/DemoAccessPanel';
import { loginErrorMessage, validateLoginFields, type LoginFieldErrors } from '../../features/authentication/loginMessages';
import { WorkflowApiError, type LoginCredentials } from '../../services/api/workflowClient';
import { PinnVideoBackground } from '../../components/ui/PinnVideoBackground';

/**
 * Route: /login/ — sign in with a username (or email) and password.
 *
 * The credentials are checked by the server (or, in the static demo build, by the demo
 * verifier); only the account they open becomes the session. Demo identities are offered
 * on a separate, labelled panel. This is demo authentication, not production
 * authentication: docs/LOGIN_AND_DEMO_AUTH.md.
 */
export const LoginPage: React.FC = () => {
  const { currentAccount, completeLogin, logout } = usePageContext();
  // Why the previous session ended (2-hour limit), shown until the next sign-in.
  const { endedNotice } = useSession();
  const { query, navigateTo } = useRouter();
  const { workflow } = useAppState();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const demoButtonRef = useRef<HTMLButtonElement>(null);

  const signIn = useCallback(
    async (credentials: LoginCredentials) => {
      setSubmitting(true);
      setFormError(null);
      try {
        const signed = await workflow.gateway.login(credentials);
        const account = signed.account ? accountFromProfile(signed.account) : USER_ACCOUNTS.find((a) => a.id === signed.actor.id);
        if (!account) throw new WorkflowApiError('UNKNOWN_ACCOUNT', 'Account not in catalogue', 0);
        completeLogin(account, sanitizeNextPath(query.get('next')));
      } catch (error) {
        const e = error instanceof WorkflowApiError ? error : null;
        setFormError(loginErrorMessage(e?.code, e?.status));
        setSubmitting(false);
        setPassword('');
        // The inputs are re-enabled on the next render; focus the password field after it.
        setTimeout(() => passwordRef.current?.focus(), 0);
      }
    },
    [workflow.gateway, completeLogin, query]
  );

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const errors = validateLoginFields(username, password);
    setFieldErrors(errors);
    if (errors.username) {
      usernameRef.current?.focus();
      return;
    }
    if (errors.password) {
      passwordRef.current?.focus();
      return;
    }
    void signIn({ username: username.trim(), password });
  };

  const closeDemo = useCallback(() => {
    setDemoOpen(false);
    demoButtonRef.current?.focus();
  }, []);

  const signedIn = !isAnonymousAccount(currentAccount);
  const inputClass = (invalid: boolean) =>
    `block w-full h-12 rounded-[12px] border bg-[#111318] px-3.5 text-sm text-[#F5F5F7] placeholder:text-[#6F7380] transition-colors focus:outline-none disabled:bg-[#111318]/50 disabled:text-[#6F7380] disabled:cursor-not-allowed ${
      invalid
        ? 'border-red-500/80 focus:border-red-500 focus:ring-1 focus:ring-red-500/40'
        : 'border-[#30333A] hover:border-[#424652] focus:border-[#F5BC24] focus:ring-1 focus:ring-[#F5BC24]/40'
    }`;

  return (
    <div className="fixed inset-0 z-[2000] overflow-y-auto bg-[#101114] text-[#F5F5F7] font-sans antialiased selection:bg-[#F5BC24]/30 selection:text-[#F5F5F7]">
      <div className="min-h-full lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,540px)]">
        {/* Brand panel (wide screens) with Editorial Overlay & Typography */}
        <aside className="hero-banner hidden lg:block">
          {/* Layer 0: Globe background */}
          <div className="hero-banner__image">
            <PinnVideoBackground hideOverlay={true} objectPosition="50% 35%" />
          </div>

          {/* Layer 1: Smooth Black to Transparent Gradient Overlay */}
          <div className="hero-copy-overlay" aria-hidden="true" />

          {/* Layer 2: Editorial Branding (Top-Left) */}
          <div className="absolute top-10 left-[5.5%] z-[2] flex items-center gap-3">
            <img src={logoImg} alt="PAVEMENT-PINN Logo" className="h-10 w-10 rounded-md object-cover ring-1 ring-[#F5BC24]/40 shadow-md" />
            <div>
              <p className="text-base font-bold tracking-wider text-[#F5F5F7] uppercase">PAVEMENT-PINN</p>
              <p className="text-xs text-[#F5BC24] font-medium tracking-wide">Road Infrastructure Intelligence Platform</p>
            </div>
          </div>

          {/* Layer 2: Editorial Copy Group (Anchored at Bottom-Left) */}
          <div className="hero-copy">
            {/* Minimalist Editorial Eyebrow Label (No dot, pure editorial) */}
            <div className="hero-copy__eyebrow">
              PHYSICS-INFORMED NEURAL NETWORK
            </div>

            {/* Editorial Headline: Assertive weight, measured size, poetic line breaks */}
            <h2 className="hero-copy__headline">
              <span className="block">Pemantauan kondisi jalan.</span>
              <span className="block">Pelaporan kerusakan.</span>
              <span className="block">Analisis perkerasan dalam satu sistem.</span>
            </h2>

            {/* Editorial Description */}
            <p className="hero-copy__description">
              Untuk insinyur lapangan, manajer operasional, pengambil kebijakan, dan masyarakat pelapor.
            </p>
          </div>
        </aside>

        {/* Right Panel: Login Form (Apple-Inspired Dark Mode) */}
        <main className="flex min-h-full items-center justify-center bg-[#101114] px-5 py-10 sm:px-8 lg:px-12">
          <div className="w-full max-w-[480px]">
            {/* Brand header (phones and tablets) with Editorial Gradient Overlay */}
            <div className="hero-banner relative mb-6 overflow-hidden rounded-[20px] border border-[#30333A]/60 bg-black p-5 text-white shadow-lg lg:hidden">
              <div className="hero-banner__image">
                <PinnVideoBackground
                  hideOverlay={true}
                  objectPosition="50% 40%"
                />
              </div>
              <div className="hero-copy-overlay" aria-hidden="true" />
              <div className="relative z-[2]">
                <div className="flex items-center gap-3 mb-3.5">
                  <img src={logoImg} alt="PAVEMENT-PINN Logo" className="h-9 w-9 rounded-md object-cover ring-1 ring-[#F5BC24]/40" />
                  <div>
                    <p className="text-sm font-bold tracking-wide text-white uppercase">PAVEMENT-PINN</p>
                    <p className="text-[11px] text-[#F5BC24] font-medium">Road Infrastructure Intelligence Platform</p>
                  </div>
                </div>
                <div className="mb-2 text-[11px] font-semibold tracking-[0.04em] text-[#F5BC24] uppercase">
                  PHYSICS-INFORMED NEURAL NETWORK
                </div>
                <h2 className="text-[20px] sm:text-[22px] font-medium leading-[1.12] tracking-[-0.025em] text-[#F1F1EE]">
                  <span className="block">Pemantauan kondisi jalan.</span>
                  <span className="block">Pelaporan kerusakan.</span>
                  <span className="block">Analisis perkerasan dalam satu sistem.</span>
                </h2>
                <p className="mt-2 text-[13.5px] font-normal leading-[1.5] text-[#A6A8AE]">
                  Untuk insinyur lapangan, manajer operasional, pengambil kebijakan, dan masyarakat pelapor.
                </p>
              </div>
            </div>

            {/* Login Card */}
            <div className="rounded-[24px] border border-[#30333A] bg-[#191B20] p-7 sm:p-9 shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
              {/* 1. Judul & 2. Deskripsi */}
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-[#F5F5F7]">Masuk</h1>
                <p className="mt-2 text-sm leading-relaxed text-[#A1A1AA]">
                  Gunakan akun yang diberikan untuk peran Anda.
                </p>
              </div>

              {/* Status Session jika sudah login */}
              {signedIn && (
                <div className="mt-5 flex items-center justify-between rounded-[12px] border border-[#30333A] bg-[#111318] px-3.5 py-2.5 text-xs text-[#A1A1AA]">
                  <span>
                    Saat ini masuk sebagai <strong className="text-[#F5F5F7] font-semibold">{currentAccount.name}</strong> ({ROLE_LABELS[currentAccount.role]})
                  </span>
                  <button
                    type="button"
                    onClick={logout}
                    className="ml-2 font-medium text-[#F5BC24] hover:text-[#FFD052] underline underline-offset-2 cursor-pointer transition-colors"
                  >
                    Keluar
                  </button>
                </div>
              )}

              {workflow.mode === 'OFFLINE_DEMO' && (
                <div className="mt-4 rounded-[12px] border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200/90 leading-relaxed">
                  Build statis tanpa server: kredensial diperiksa di browser dan tidak memberikan keamanan.
                </div>
              )}

              {endedNotice && !formError && (
                <div role="status" className="mt-4 rounded-[12px] border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs font-medium text-amber-100 leading-relaxed">
                  {endedNotice}
                </div>
              )}

              {formError && (
                <div role="alert" className="mt-4 rounded-[12px] border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs font-medium text-red-200 leading-relaxed">
                  {formError}
                </div>
              )}

              {/* Form */}
              <form noValidate onSubmit={onSubmit} className="mt-6 space-y-4" aria-busy={submitting}>
                {/* 3. Email atau nama pengguna */}
                <div>
                  <label htmlFor="login-identifier" className="mb-2 block text-xs font-semibold tracking-wide text-[#A1A1AA]">
                    Email atau nama pengguna
                  </label>
                  <input
                    ref={usernameRef}
                    id="login-identifier"
                    name="username"
                    type="text"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    autoFocus
                    value={username}
                    disabled={submitting}
                    onChange={(e) => setUsername(e.target.value)}
                    aria-invalid={!!fieldErrors.username}
                    aria-describedby={fieldErrors.username ? 'login-identifier-error' : undefined}
                    placeholder="nama@instansi.go.id atau username"
                    className={inputClass(!!fieldErrors.username)}
                  />
                  {fieldErrors.username && (
                    <p id="login-identifier-error" className="mt-1.5 text-xs text-red-400 font-medium">
                      {fieldErrors.username}
                    </p>
                  )}
                </div>

                {/* 4. Kata sandi */}
                <div>
                  <label htmlFor="login-password" className="mb-2 block text-xs font-semibold tracking-wide text-[#A1A1AA]">
                    Kata sandi
                  </label>
                  <div className="relative">
                    <input
                      ref={passwordRef}
                      id="login-password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={password}
                      disabled={submitting}
                      onChange={(e) => setPassword(e.target.value)}
                      aria-invalid={!!fieldErrors.password}
                      aria-describedby={fieldErrors.password ? 'login-password-error' : undefined}
                      placeholder="Masukkan kata sandi"
                      className={`${inputClass(!!fieldErrors.password)} pr-11`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                      aria-pressed={showPassword}
                      aria-controls="login-password"
                      className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-[#858995] hover:text-[#F5F5F7] transition-colors cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {fieldErrors.password && (
                    <p id="login-password-error" className="mt-1.5 text-xs text-red-400 font-medium">
                      {fieldErrors.password}
                    </p>
                  )}
                </div>

                {/* 5. Tombol utama: Masuk ke Sistem */}
                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex h-12 w-full items-center justify-center gap-2 rounded-[12px] bg-[#F5BC24] px-4 text-sm font-bold tracking-wide text-[#11110F] transition-all hover:bg-[#FFD052] active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer shadow-sm"
                  >
                    {submitting && <Loader2 className="h-4 w-4 animate-spin text-[#11110F] motion-reduce:animate-none" aria-hidden="true" />}
                    <span>{submitting ? 'Memeriksa…' : 'Masuk ke Sistem'}</span>
                  </button>
                </div>
              </form>

              {/* 6. Divider */}
              <div className="my-6 border-t border-[#30333A]" />

              {/* 7. Tombol sekunder: Akses akun demo & 8. Link publik */}
              <div className="space-y-3.5">
                {DEMO_ACCESS_ENABLED && (
                  <button
                    ref={demoButtonRef}
                    type="button"
                    onClick={() => setDemoOpen(true)}
                    className="flex h-11 w-full items-center justify-center gap-2 rounded-[12px] border border-[#30333A] bg-[#111318] px-4 text-sm font-medium text-[#F5F5F7] transition-all hover:border-[#424652] hover:bg-[#15171D] cursor-pointer"
                  >
                    <span>Akses akun demo</span>
                    <span className="rounded-full border border-[#F5BC24]/40 bg-[#F5BC24]/10 px-2 py-0.5 text-[10px] font-bold tracking-wider text-[#F5BC24]">
                      DEMO
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => navigateTo('dashboard')}
                  className="w-full text-center text-xs font-medium text-[#A1A1AA] hover:text-[#F5BC24] transition-colors cursor-pointer"
                >
                  Lihat peta publik tanpa masuk
                </button>
              </div>
            </div>

            <p className="mt-5 text-center text-xs leading-relaxed text-[#858995]">
              Autentikasi di lingkungan ini adalah mode demo, bukan autentikasi produksi.
            </p>
          </div>
        </main>
      </div>

      {demoOpen && (
        <DemoAccessPanel
          busy={submitting}
          onClose={closeDemo}
          onUseAccount={(credentials) => {
            setDemoOpen(false);
            setUsername(credentials.username);
            setPassword('');
            void signIn(credentials);
          }}
        />
      )}
    </div>
  );
};
