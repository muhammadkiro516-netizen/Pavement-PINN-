/**
 * Route /beranda/ — first page for visitors. Plain-language story with visuals that explain
 * the product: a phone running the real AI scan (detector output recorded on the hero photo,
 * src/data/landingDetections.json), a moving strip of real Indonesian road photos (Wikimedia
 * Commons, credited), the report-to-repair flow, and an interactive road cross-section that
 * shows why overloaded trucks break roads (AASHTO fourth-power law, cited on screen).
 */
import React, { useEffect, useState } from 'react';
import { Glyph, LogoMark, Wordmark } from '../../components/ui/brand';
import { useRouter } from '../../app/router';
import { useAppState } from '../../app/providers/AppStateProvider';
import { usePageHost } from '../../app/pageContext';
import { accountFromProfile } from '../../app/providers/SessionProvider';
import { signInCitizenDevice } from '../../features/authentication/deviceAccount';
import { requestDeviceLocation } from '../../features/location/deviceLocation';
import credits from '../../data/photoCredits.json';
import detections from '../../data/landingDetections.json';

const BASE = import.meta.env.BASE_URL;
const photo = (slug: string) => `${BASE}photos/${slug}.jpg`;
const hero = detections.photos['jalan-berlubang'].detections[0];
const STRIP = ['surabaya', 'jalan-berlubang', 'ubud-bali', 'rambu-kebumen', 'perbaikan-kebumen'];
/** AASHTO fourth-power law: damage per pass grows with (axle / standard axle)^4. */
const ODOL_FACTOR = Math.round((13 / 8.16) ** 4);

// ---------------------------------------------------------------------------------------
const ScanScreen: React.FC = () => {
  const [found, setFound] = useState(false);
  useEffect(() => {
    const t = window.setInterval(() => setFound((f) => !f), 3400);
    return () => window.clearInterval(t);
  }, []);
  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0E1B2C]">
      <img src={photo('jalan-berlubang')} alt="Jalan berlubang di Indonesia" className="h-full w-full object-cover" />
      {!found && <div className="pp-scanline" />}
      {found && hero && (
        <div
          className="pp-box absolute rounded-2xl border-[3px] border-[#FF7A1A] bg-[#FF7A1A]/15"
          style={{ left: `${hero.box[0] * 100}%`, top: `${hero.box[1] * 100}%`, width: `${(hero.box[2] - hero.box[0]) * 100}%`, height: `${(hero.box[3] - hero.box[1]) * 100}%` }}
        />
      )}
      <div className="absolute inset-x-3 top-10 flex items-center justify-between rounded-2xl bg-[#FFFFFF]/90 px-3 py-2 text-[11px] font-extrabold text-[#0E1B2C] backdrop-blur">
        <span className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${found ? 'bg-[#12A150]' : 'pp-dot bg-[#1463FF]'}`} />
          {found ? 'Lubang terdeteksi' : 'AI memeriksa…'}
        </span>
        <span className="text-[#7A8899]">{found && hero ? `${Math.round(hero.confidence * 100)}% yakin` : 'OpenVINO'}</span>
      </div>
      <div className="absolute inset-x-3 bottom-3 rounded-2xl bg-[#FF7A1A] py-3 text-center text-sm font-extrabold text-[#FFFFFF]">Kirim laporan</div>
    </div>
  );
};

const FloatCard: React.FC<{ className: string; delay?: string; tone: string; title: string; text: string }> = ({ className, delay = '0s', tone, title, text }) => (
  <div className={`pp-float absolute z-20 w-[210px] rounded-2xl border border-[#E3E8EF] bg-[#FFFFFF]/95 p-3 shadow-[0_18px_40px_-18px_rgba(14,27,44,0.45)] backdrop-blur ${className}`} style={{ animationDelay: delay }}>
    <div className="flex items-center gap-2">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: tone }} />
      <p className="text-xs font-extrabold text-[#0E1B2C]">{title}</p>
    </div>
    <p className="mt-1 text-xs leading-snug text-[#5B6B7F]">{text}</p>
  </div>
);

const HeroVisual: React.FC = () => (
  <div className="relative mx-auto h-[560px] w-full max-w-[460px]">
    <div className="absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-[#1463FF]/25 to-[#FF7A1A]/20 blur-3xl" />
    <div className="absolute left-1/2 top-4 z-10 h-[520px] w-[260px] -translate-x-1/2 rounded-[44px] border-[10px] border-[#0E1B2C] bg-[#0E1B2C] shadow-[0_40px_80px_-30px_rgba(14,27,44,0.7)]">
      <div className="absolute left-1/2 top-2 z-30 h-5 w-24 -translate-x-1/2 rounded-full bg-[#0E1B2C]" />
      <div className="h-full w-full overflow-hidden rounded-[34px]">
        <ScanScreen />
      </div>
    </div>
    <FloatCard className="-left-2 top-20 md:-left-10" tone="#FF7A1A" title="AI: Lubang" text={`Terdeteksi dengan keyakinan ${Math.round((hero?.confidence ?? 0) * 100)}%. Petugas akan memastikan.`} />
    <FloatCard className="-right-2 top-[230px] md:-right-12" delay="1.2s" tone="#1463FF" title="PINN: cek struktur" text="Kerusakan sampai lapisan bawah? Tambal saja tidak cukup." />
    <FloatCard className="bottom-8 left-0 md:-left-6" delay="2.1s" tone="#12A150" title="Petugas menuju lokasi" text="Status langsung muncul di Laporanku." />
  </div>
);

// ---------------------------------------------------------------------------------------
const PhotoStrip: React.FC = () => (
  <div className="relative overflow-hidden py-2 [mask-image:linear-gradient(90deg,transparent,black_8%,black_92%,transparent)]">
    <div className="pp-marquee flex w-max gap-4">
      {[...STRIP, ...STRIP].map((slug, i) => (
        <img key={i} src={photo(slug)} alt="" className="h-44 w-72 shrink-0 rounded-3xl object-cover shadow-[0_14px_30px_-18px_rgba(14,27,44,0.6)]" loading="lazy" />
      ))}
    </div>
  </div>
);

// ---------------------------------------------------------------------------------------
const FLOW = [
  { x: 60, title: 'Foto', text: 'Warga memotret di lokasi' },
  { x: 260, title: 'AI', text: 'Mengenali jenis kerusakan' },
  { x: 460, title: 'Petugas', text: 'Memastikan & mengukur' },
  { x: 660, title: 'Mulus', text: 'Perbaikan diverifikasi' }
];
const FLOW_PATH = 'M60 60 C 160 0, 160 120, 260 60 S 360 0, 460 60 S 560 120, 660 60';

const Flow: React.FC = () => (
  <div className="overflow-x-auto">
    <svg viewBox="-40 0 800 150" className="mx-auto block w-full min-w-[640px] max-w-4xl">
      <defs>
        <linearGradient id="pp-flow" x1="0" x2="1">
          <stop offset="0" stopColor="#1463FF" />
          <stop offset="1" stopColor="#FF7A1A" />
        </linearGradient>
      </defs>
      <path d={FLOW_PATH} fill="none" stroke="#E3E8EF" strokeWidth="10" strokeLinecap="round" />
      <path d={FLOW_PATH} fill="none" stroke="url(#pp-flow)" strokeWidth="4" strokeLinecap="round" className="pp-dash" />
      <circle r="9" fill="#FF7A1A">
        <animateMotion dur="5s" repeatCount="indefinite" path={FLOW_PATH} />
      </circle>
      {FLOW.map((n, i) => (
        <g key={n.title}>
          <circle cx={n.x} cy="60" r="24" fill="#FFFFFF" stroke={i === 3 ? '#12A150' : '#1463FF'} strokeWidth="4" />
          <text x={n.x} y="66" textAnchor="middle" fontSize="16" fontWeight="800" fill="#0E1B2C">{i + 1}</text>
          <text x={n.x} y="112" textAnchor="middle" fontSize="15" fontWeight="800" fill="#0E1B2C">{n.title}</text>
          <text x={n.x} y="132" textAnchor="middle" fontSize="12" fill="#5B6B7F">{n.text}</text>
        </g>
      ))}
    </svg>
  </div>
);

// ---------------------------------------------------------------------------------------
const RoadSection: React.FC = () => {
  const [odol, setOdol] = useState(false);
  return (
    <div className="grid items-center gap-8 md:grid-cols-[1.1fr_1fr]">
      <div className="relative overflow-hidden rounded-[32px] bg-[#0E1B2C] p-5 shadow-[0_30px_70px_-35px_rgba(14,27,44,0.8)]">
        <svg viewBox="0 0 560 330" className="block w-full">
          <defs>
            <radialGradient id="pp-stress" cx="50%" cy="0%" r="100%">
              <stop offset="0" stopColor="#FF7A1A" stopOpacity="1" />
              <stop offset="0.3" stopColor="#FF9A45" stopOpacity="0.85" />
              <stop offset="0.65" stopColor="#FFC88F" stopOpacity="0.45" />
              <stop offset="1" stopColor="#FFC88F" stopOpacity="0" />
            </radialGradient>
            <clipPath id="pp-below">
              <rect x="0" y="112" width="560" height="218" />
            </clipPath>
            <pattern id="pp-gravel" width="14" height="14" patternUnits="userSpaceOnUse">
              <circle cx="4" cy="5" r="1.6" fill="#7A8899" />
              <circle cx="11" cy="10" r="1.2" fill="#5B6B7F" />
            </pattern>
          </defs>
          {/* truck */}
          <rect x={odol ? 150 : 175} y="18" width={odol ? 260 : 210} height="62" rx="10" fill={odol ? '#FF7A1A' : '#1463FF'} style={{ transition: 'all 0.6s' }} />
          {odol && <rect x="160" y="0" width="240" height="22" rx="6" fill="#FFB067" />}
          <circle cx="230" cy="92" r="20" fill="#0B1220" stroke="#C9D3E0" strokeWidth="4" />
          <circle cx="330" cy="92" r="20" fill="#0B1220" stroke="#C9D3E0" strokeWidth="4" />
          {/* layers */}
          <rect x="0" y="112" width="560" height="40" fill="#2A3647" />
          <rect x="0" y="152" width="560" height="70" fill="url(#pp-gravel)" />
          <rect x="0" y="152" width="560" height="70" fill="#3E4C5E" opacity="0.55" />
          <rect x="0" y="222" width="560" height="108" fill="#5C4A3A" opacity="0.85" />
          {/* stress bulbs under each wheel */}
          <g clipPath="url(#pp-below)">
            {[230, 330].map((x) => (
              <ellipse key={x} cx={x} cy="112" rx={odol ? 78 : 48} ry={odol ? 190 : 95} fill="url(#pp-stress)" className="pp-bulb" style={{ transition: 'rx 0.9s ease, ry 0.9s ease' }} />
            ))}
          </g>
          <text x="14" y="138" fontSize="13" fontWeight="800" fill="#FFFFFF">Aspal</text>
          <text x="14" y="192" fontSize="13" fontWeight="800" fill="#FFFFFF">Lapis pondasi</text>
          <text x="14" y="280" fontSize="13" fontWeight="800" fill="#FFFFFF">Tanah dasar</text>
        </svg>
        <div className="mt-4 flex w-max rounded-full bg-[#FFFFFF]/10 p-1 text-xs font-extrabold">
          <button type="button" onClick={() => setOdol(false)} className={`cursor-pointer rounded-full px-3 py-1.5 ${!odol ? 'bg-[#1463FF] text-[#FFFFFF]' : 'text-[#FFFFFF]/70'}`}>Truk normal</button>
          <button type="button" onClick={() => setOdol(true)} className={`cursor-pointer rounded-full px-3 py-1.5 ${odol ? 'bg-[#FF7A1A] text-[#FFFFFF]' : 'text-[#FFFFFF]/70'}`}>Truk ODOL</button>
        </div>
      </div>
      <div>
        <span className="text-sm font-extrabold uppercase tracking-wider text-[#1463FF]">Mesin PINN</span>
        <h2 className="mt-2 text-3xl font-extrabold tracking-tight md:text-4xl">Kami melihat sampai ke bawah aspal.</h2>
        <p className="mt-3 text-lg leading-relaxed text-[#5B6B7F]">
          Lubang hanyalah gejala. Mesin PINN menghitung tekanan dari roda kendaraan sampai ke tanah dasar, lalu memberi
          tahu petugas: cukup ditambal, perlu dilapis ulang, atau harus dibangun ulang.
        </p>
        <div className="mt-5 rounded-3xl border border-[#FFE0C7] bg-[#FFF1E6] p-5">
          <p className="text-4xl font-extrabold text-[#D9600C]">{odol ? `±${ODOL_FACTOR}×` : '1×'}</p>
          <p className="mt-1 font-bold text-[#0E1B2C]">{odol ? 'lebih cepat merusak jalan' : 'kerusakan per lintasan, truk sesuai aturan'}</p>
          <p className="mt-1 text-sm text-[#5B6B7F]">
            {odol ? 'Gandar 13 ton dibanding gandar standar 8,2 ton, menurut hukum pangkat empat (AASHTO). Coba tombol di gambar.' : 'Tekan "Truk ODOL" di gambar untuk melihat bedanya.'}
          </p>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------------------
const RadarCard: React.FC = () => (
  <div className="relative h-44 overflow-hidden rounded-2xl bg-[#E8F0FF]">
    <svg viewBox="0 0 300 180" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice">
      <path d="M-10 120 C 60 100, 120 150, 310 90" stroke="#FFFFFF" strokeWidth="14" fill="none" />
      <path d="M90 -10 C 110 60, 80 120, 130 190" stroke="#FFFFFF" strokeWidth="10" fill="none" />
      <path d="M200 -10 L 230 190" stroke="#FFFFFF" strokeWidth="8" fill="none" />
    </svg>
    {[0, 0.8, 1.6].map((d) => (
      <span key={d} className="pp-radar absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#1463FF]" style={{ animationDelay: `${d}s` }} />
    ))}
    <span className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-[#FFFFFF] bg-[#1463FF]" />
    <span className="absolute left-[22%] top-[30%] h-3 w-3 rounded-full bg-[#FF7A1A]" />
    <span className="absolute left-[70%] top-[64%] h-3 w-3 rounded-full bg-[#FF7A1A]" />
  </div>
);

const Bento: React.FC = () => (
  <div className="grid gap-4 md:grid-cols-3">
    <div className="pp-rise rounded-[28px] border border-[#E3E8EF] bg-[#FFFFFF] p-5 md:col-span-2">
      <RadarCard />
      <p className="mt-4 text-xl font-extrabold">Laporan hanya dari lokasi kerusakan</p>
      <p className="mt-1 text-[15px] text-[#5B6B7F]">Titik laporan diambil dari GPS HP saat itu juga. Foto yang diambil di tempat lain ditolak.</p>
    </div>
    <div className="pp-rise rounded-[28px] bg-gradient-to-br from-[#1463FF] to-[#3B82FF] p-5 text-[#FFFFFF]">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#FFFFFF]/15"><Glyph name="user" size={26} /></span>
      <p className="mt-16 text-xl font-extrabold">Tanpa daftar</p>
      <p className="mt-1 text-[15px] text-[#FFFFFF]/80">Akun warga tersimpan di HP Anda. Buka lagi, laporan Anda masih ada.</p>
    </div>
    <div className="pp-rise rounded-[28px] bg-[#0E1B2C] p-5 text-[#FFFFFF]">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#FFFFFF]/10 text-[#FF7A1A]"><Glyph name="shield" size={26} /></span>
      <p className="mt-16 text-xl font-extrabold">Foto Anda aman</p>
      <p className="mt-1 text-[15px] text-[#FFFFFF]/70">Data tersembunyi di foto (lokasi kamera, jenis HP) dihapus sebelum disimpan.</p>
    </div>
    <div className="pp-rise rounded-[28px] border border-[#E3E8EF] bg-[#FFFFFF] p-5 md:col-span-2">
      <div className="flex flex-wrap gap-2">
        {['Warga melapor', 'AI menyaring', 'Petugas memastikan', 'Koordinator memutuskan', 'Warga memantau'].map((t, i) => (
          <span key={t} className={`rounded-full px-3 py-1.5 text-sm font-bold ${i % 2 ? 'bg-[#FFF1E6] text-[#D9600C]' : 'bg-[#E8F0FF] text-[#1463FF]'}`}>{t}</span>
        ))}
      </div>
      <p className="mt-6 text-xl font-extrabold">AI mengusulkan, manusia memutuskan</p>
      <p className="mt-1 text-[15px] text-[#5B6B7F]">Setiap koreksi petugas tercatat dan dipakai untuk mengukur ketepatan AI. Semua AI berjalan di server kami sendiri dengan Intel OpenVINO.</p>
    </div>
  </div>
);

// ---------------------------------------------------------------------------------------
export const LandingPage: React.FC = () => {
  const { navigateTo } = useRouter();
  const { workflow } = useAppState();
  const { completeLogin } = usePageHost();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ask for location right away, so the map opens on the visitor's own street.
  useEffect(() => void requestDeviceLocation(), []);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const signed = await signInCitizenDevice(workflow.gateway);
      if (signed.account) completeLogin(accountFromProfile(signed.account), '/peta/?lapor=1');
    } catch {
      setError('Server sedang tidak bisa dihubungi. Coba lagi sebentar lagi.');
      setBusy(false);
    }
  };

  const ReportButton: React.FC<{ big?: boolean }> = ({ big }) => (
    <button
      type="button"
      onClick={() => void start()}
      disabled={busy}
      className={`inline-flex cursor-pointer items-center gap-2.5 rounded-full bg-[#FF7A1A] font-extrabold text-[#FFFFFF] shadow-[0_14px_30px_-12px_rgba(255,122,26,0.8)] transition hover:-translate-y-0.5 hover:bg-[#F06A0A] disabled:opacity-60 ${big ? 'h-16 px-8 text-lg' : 'h-14 px-7 text-base'}`}
    >
      <Glyph name="camera" size={22} /> {busy ? 'Menyiapkan…' : 'Laporkan jalan rusak'}
    </button>
  );

  return (
    <div className="min-h-full w-full overflow-x-hidden bg-[#F4F7FC] text-[#0E1B2C]">
      <div className="relative">
        <div className="pp-grid-bg absolute inset-0 [mask-image:linear-gradient(180deg,black,transparent)]" />
        <div className="pp-drift absolute -left-24 -top-24 h-96 w-96 rounded-full bg-[#1463FF]/20 blur-3xl" />
        <div className="pp-drift absolute -right-24 top-40 h-80 w-80 rounded-full bg-[#FF7A1A]/20 blur-3xl" style={{ animationDelay: '3s' }} />

        <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <LogoMark size={38} />
            <Wordmark />
          </div>
          <button type="button" onClick={() => navigateTo('login')} className="cursor-pointer rounded-full border border-[#E3E8EF] bg-[#FFFFFF]/80 px-4 py-2 text-sm font-bold text-[#1463FF] backdrop-blur hover:bg-[#FFFFFF]">
            Masuk petugas
          </button>
        </header>

        <section className="relative z-10 mx-auto grid max-w-6xl items-center gap-6 px-5 pb-10 pt-4 md:grid-cols-[1.05fr_1fr] md:pt-10">
          <div className="pp-rise">
            <span className="inline-flex items-center gap-2 rounded-full border border-[#FFE0C7] bg-[#FFFFFF] px-3 py-1.5 text-xs font-extrabold text-[#D9600C]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#FF7A1A]" /> 86.844 km jalan di Indonesia rusak berat (BPS)
            </span>
            <h1 className="mt-5 text-[42px] font-extrabold leading-[1.02] tracking-tight md:text-[64px]">
              Lihat jalan rusak?{' '}
              <span className="bg-gradient-to-r from-[#1463FF] to-[#FF7A1A] bg-clip-text text-transparent">Potret saja.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-[#5B6B7F] md:text-xl">
              AI mengenali kerusakannya, petugas memastikannya di lokasi, dan Anda memantau prosesnya sampai jalan kembali
              mulus. Tanpa daftar, tanpa isi email.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <ReportButton />
              <a href="#cara-kerja" className="inline-flex h-14 items-center gap-2 rounded-full px-5 text-base font-bold hover:bg-[#FFFFFF]">
                Cara kerjanya <Glyph name="arrow" size={18} />
              </a>
            </div>
            {error && <p className="mt-3 text-sm font-semibold text-[#C53035]">{error}</p>}
            <div className="mt-8 grid max-w-md grid-cols-3 gap-3">
              {[
                ['< 1 dtk', 'AI memeriksa foto'],
                ['3 peran', 'warga, petugas, koordinator'],
                ['Lokal', 'AI di server sendiri, bukan cloud']
              ].map(([v, l]) => (
                <div key={l} className="rounded-2xl border border-[#E3E8EF] bg-[#FFFFFF]/80 p-3 backdrop-blur">
                  <p className="text-xl font-extrabold text-[#1463FF]">{v}</p>
                  <p className="text-xs leading-snug text-[#5B6B7F]">{l}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="pp-rise" style={{ animationDelay: '150ms' }}>
            <HeroVisual />
          </div>
        </section>
      </div>

      <section className="pb-14">
        <p className="mb-4 text-center text-sm font-bold text-[#7A8899]">Foto asli jalan rusak di Indonesia</p>
        <PhotoStrip />
      </section>

      <section id="cara-kerja" className="mx-auto max-w-6xl px-5 pb-16">
        <div className="text-center">
          <span className="text-sm font-extrabold uppercase tracking-wider text-[#1463FF]">Cara kerja</span>
          <h2 className="mt-2 text-3xl font-extrabold tracking-tight md:text-4xl">Dari foto sampai jalan mulus.</h2>
        </div>
        <div className="mt-8 rounded-[32px] border border-[#E3E8EF] bg-[#FFFFFF] p-6">
          <Flow />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-16">
        <RoadSection />
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-16">
        <Bento />
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-16">
        <div className="relative overflow-hidden rounded-[36px] bg-gradient-to-br from-[#1463FF] via-[#2F6BFF] to-[#0E1B2C] px-6 py-14 text-center text-[#FFFFFF]">
          <div className="pp-drift absolute -right-20 -top-20 h-72 w-72 rounded-full bg-[#FF7A1A]/40 blur-3xl" />
          <h2 className="relative text-3xl font-extrabold tracking-tight md:text-5xl">Satu foto Anda bisa mencegah satu kecelakaan.</h2>
          <p className="relative mx-auto mt-3 max-w-xl text-lg text-[#FFFFFF]/80">Butuh kurang dari satu menit. Tidak perlu daftar.</p>
          <div className="relative mt-8 flex flex-wrap justify-center gap-3">
            <ReportButton big />
            <button type="button" onClick={() => navigateTo('evidence')} className="inline-flex h-16 cursor-pointer items-center rounded-full border border-[#FFFFFF]/30 px-7 text-base font-bold text-[#FFFFFF] hover:bg-[#FFFFFF]/10">
              Lihat bukti kerja AI
            </button>
          </div>
        </div>
      </section>

      <footer className="border-t border-[#E3E8EF] bg-[#FFFFFF] px-5 py-6 text-xs text-[#7A8899]">
        <div className="mx-auto max-w-6xl space-y-1">
          <div className="mb-3 flex items-center gap-2"><LogoMark size={24} /><Wordmark /></div>
          <p>Foto: Wikimedia Commons.</p>
          {credits.map((c) => (
            <p key={c.file}>
              {c.title} oleh {c.author || 'tidak diketahui'} ({c.license}) ·{' '}
              <a href={c.source} target="_blank" rel="noopener noreferrer" className="underline">sumber</a>
            </p>
          ))}
          <p>Data jalan rusak berat: BPS, Statistik Transportasi Darat 2021. Faktor truk ODOL: hukum pangkat empat AASHTO.</p>
        </div>
      </footer>
    </div>
  );
};
