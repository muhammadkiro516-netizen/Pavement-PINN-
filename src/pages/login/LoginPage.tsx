import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from '../../app/router';
import { useSession } from '../../app/providers/SessionProvider';
import { Pavi } from '../../components/brand/Pavi';
import { LogoMark, Wordmark } from '../../components/ui/brand';
import { finishSignIn, hasRememberedDevice, signOutStaff, startSignIn, type SignInStep } from '../../features/roles/api';
import { isWeakPin } from '../../domain/v6/roles';

const INPUT = 'h-14 w-full rounded-2xl border border-[#2A2F37] bg-[#0B0D10] px-4 text-center text-xl font-bold tracking-widest text-white outline-none focus:border-[#FFD60A]';
const PRIMARY = 'mt-4 h-14 w-full cursor-pointer rounded-2xl bg-[#FFD60A] text-base font-extrabold text-[#0B0D10] disabled:opacity-50';
const LINK = 'mt-3 w-full cursor-pointer text-sm font-bold text-[#A1A1AA] underline';

/** Letters and digits only, shown as XXX-XXX-XXXX while typing. */
const formatCode = (raw: string) => {
  const c = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  return [c.slice(0, 3), c.slice(3, 6), c.slice(6)].filter(Boolean).join('-');
};

/** A code from a QR badge's link. It stays in the fragment so it never reaches a server log. */
const codeFromText = (text: string) => {
  const hit = text.match(/#kode=([A-Za-z0-9-]+)/);
  return formatCode(hit ? hit[1] : text);
};

interface Detector { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> }

const QrScanner: React.FC<{ onCode: (code: string) => void; onClose: () => void }> = ({ onCode, onClose }) => {
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    const Barcode = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    if (!Barcode) {
      setProblem('Browser ini belum bisa memindai di sini. Buka aplikasi kamera HP, arahkan ke QR, lalu ketuk tautannya.');
      return;
    }
    const detector = new Barcode({ formats: ['qr_code'] });
    let stream: MediaStream | null = null;
    let timer = 0;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then((s) => {
      stream = s;
      if (video.current) { video.current.srcObject = s; void video.current.play(); }
      timer = window.setInterval(() => {
        if (!video.current || video.current.readyState < 2) return;
        detector.detect(video.current).then((found) => { if (found[0]) onCode(codeFromText(found[0].rawValue)); }).catch(() => undefined);
      }, 300);
    }).catch(() => setProblem('Kamera tidak bisa dibuka. Ketik kodenya saja.'));
    return () => { window.clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, [onCode]);
  return (
    <div className="mb-4">
      {problem ? <p className="rounded-2xl bg-[#1E2229] p-3 text-sm text-[#FFD60A]" data-testid="v6-qr-problem">{problem}</p> : <video ref={video} playsInline muted className="aspect-square w-full rounded-2xl bg-black object-cover" />}
      <button type="button" className={LINK} onClick={onClose}>Tutup kamera</button>
    </div>
  );
};

/**
 * Route /login/ — "Masuk Instansi": staff scan their QR badge or type their code, then their PIN.
 * Citizens never need it: their account lives on their phone.
 */
export const LoginPage: React.FC = () => {
  const { endedNotice } = useSession();
  const { navigateTo } = useRouter();
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'CODE' | SignInStep | 'REMEMBERED'>(() => (hasRememberedDevice() ? 'REMEMBERED' : 'CODE'));
  const [agency, setAgency] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [scan, setScan] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const guarded = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Server tidak dapat dihubungi. Periksa koneksi lalu coba lagi.');
      setPin('');
      setPin2('');
    }
    setBusy(false);
  };

  const begin = (typed: string) => guarded(async () => {
    const out = await startSignIn(typed);
    setAgency(out.agencyName);
    if (out.step === 'GUEST') {
      await finishSignIn(typed, null);
      navigateTo('staffHome');
      return;
    }
    setStep(out.step);
  });

  // A QR badge opened with the phone's own camera lands here with the code in the fragment.
  useEffect(() => {
    if (!window.location.hash.startsWith('#kode=')) return;
    const fromLink = codeFromText(window.location.hash);
    window.history.replaceState(null, '', window.location.pathname);
    setCode(fromLink);
    void begin(fromLink);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scanned = (found: string) => {
    setScan(false);
    setCode(found);
    void begin(found);
  };

  const finish = (e: React.FormEvent) => {
    e.preventDefault();
    if (step === 'SET_PIN' && pin !== pin2) { setError('Kedua PIN belum sama.'); return; }
    if (step === 'SET_PIN' && isWeakPin(pin)) { setError('PIN terlalu mudah ditebak. Hindari 123456 atau angka yang sama semua.'); return; }
    void guarded(async () => {
      await finishSignIn(step === 'REMEMBERED' ? null : code, pin);
      navigateTo('staffHome');
    });
  };

  const pinInput = (value: string, set: (v: string) => void, testId: string, label: string) => (
    <label className="mt-3 block text-sm font-bold text-[#A1A1AA]">{label}
      <input className={`${INPUT} mt-1`} type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={value} onChange={(e) => set(e.target.value.replace(/\D/g, ''))} data-testid={testId} />
    </label>
  );

  return (
    <div className="flex min-h-full w-full items-center justify-center bg-gradient-to-b from-[#15181D] to-[#0B0D10] px-4 py-10 text-white">
      <div className="pp-rise w-full max-w-sm">
        <button type="button" onClick={() => navigateTo('landing')} className="mx-auto mb-6 flex cursor-pointer items-center gap-2">
          <LogoMark size={44} />
          <Wordmark />
        </button>
        <div className="rounded-[32px] border border-[#2A2F37] bg-[#15181D] p-6 shadow-[0_24px_60px_-28px_rgba(14,27,44,0.35)]">
          <div className="mb-2 flex justify-center"><Pavi size={56} /></div>
          <h1 className="text-center text-2xl font-extrabold tracking-tight">Masuk Instansi</h1>
          <p className="mt-1 text-center text-sm text-[#A1A1AA]" data-testid="v6-login-agency">{agency || 'Pakai kode atau QR dari Operations Manager Anda.'}</p>
          {endedNotice && <p className="mt-3 rounded-2xl bg-[#1E2229] p-3 text-sm text-[#FFD60A]">{endedNotice}</p>}

          {step === 'CODE' && (
            <form className="mt-4" onSubmit={(e) => { e.preventDefault(); void begin(code); }}>
              {scan ? <QrScanner onCode={scanned} onClose={() => setScan(false)} /> : (
                <button type="button" className="mb-4 h-12 w-full cursor-pointer rounded-2xl border border-[#2A2F37] font-bold" onClick={() => setScan(true)} data-testid="v6-scan-qr">Pindai QR badge</button>
              )}
              <label className="block text-sm font-bold text-[#A1A1AA]">atau ketik kode
                <input className={`${INPUT} mt-1`} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="XXX-XXX-XXXX" value={code} onChange={(e) => setCode(formatCode(e.target.value))} data-testid="v6-code" />
              </label>
              <button type="submit" className={PRIMARY} disabled={busy || code.length < 12} data-testid="v6-code-next">Lanjut</button>
            </form>
          )}

          {(step === 'ENTER_PIN' || step === 'REMEMBERED') && (
            <form onSubmit={finish}>
              {pinInput(pin, setPin, 'v6-pin', 'PIN 6 angka')}
              <button type="submit" className={PRIMARY} disabled={busy || pin.length !== 6} data-testid="v6-pin-ok">Masuk</button>
              {step === 'REMEMBERED' && <button type="button" className={LINK} onClick={() => { signOutStaff(); setStep('CODE'); setError(null); }} data-testid="v6-other-code">Pakai kode lain</button>}
            </form>
          )}

          {step === 'SET_PIN' && (
            <form onSubmit={finish}>
              <p className="mt-3 text-sm text-[#A1A1AA]">Ini pertama kali Anda masuk. Buat PIN yang hanya Anda tahu.</p>
              {pinInput(pin, setPin, 'v6-pin', 'PIN baru, 6 angka')}
              {pinInput(pin2, setPin2, 'v6-pin2', 'Ulangi PIN')}
              <button type="submit" className={PRIMARY} disabled={busy || pin.length !== 6 || pin2.length !== 6} data-testid="v6-pin-ok">Simpan dan masuk</button>
            </form>
          )}

          {error && <p className="mt-3 text-center text-sm font-semibold text-[#FF6B6B]" role="alert" data-testid="v6-login-error">{error}</p>}
        </div>
      </div>
    </div>
  );
};
