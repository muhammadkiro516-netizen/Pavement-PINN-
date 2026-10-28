/**
 * Route /beranda/ — first page for visitors. Plain-language story of the product, real road
 * photos from Indonesia (Wikimedia Commons, credited below), and an AI scan animation that
 * shows the detector's real output on the hero photo (src/data/landingDetections.json).
 * Asks for location on open, so the map can fly straight to the visitor.
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
const hero = detections.photos['jalan-berlubang'];

/** The real detector result, revealed after a short scan. */
const AiScan: React.FC = () => {
  const [phase, setPhase] = useState<'scan' | 'found'>('scan');
  useEffect(() => {
    const t = window.setInterval(() => setPhase((p) => (p === 'scan' ? 'found' : 'scan')), 3600);
    return () => window.clearInterval(t);
  }, []);
  const d = hero.detections[0];
  return (
    <div className="relative overflow-hidden rounded-[28px] shadow-[0_30px_80px_-30px_rgba(14,27,44,0.55)]">
      <img src={photo('jalan-berlubang')} alt="Jalan berlubang di Indonesia" className="block aspect-[4/3] w-full object-cover" />
      {phase === 'scan' && <div className="pp-scanline" />}
      {phase === 'found' && d && (
        <div
          className="pp-box absolute rounded-2xl border-[3px] border-[#FF7A1A] bg-[#FF7A1A]/10"
          style={{ left: `${d.box[0] * 100}%`, top: `${d.box[1] * 100}%`, width: `${(d.box[2] - d.box[0]) * 100}%`, height: `${(d.box[3] - d.box[1]) * 100}%` }}
        >
          <span className="pp-pop absolute -top-9 left-0 whitespace-nowrap rounded-full bg-[#FF7A1A] px-3 py-1.5 text-xs font-extrabold text-[#FFFFFF] shadow-lg">
            Lubang terdeteksi · {Math.round(d.confidence * 100)}% yakin
          </span>
        </div>
      )}
      <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-2 rounded-2xl bg-[#FFFFFF]/90 px-3 py-2 text-xs font-bold text-[#0E1B2C] backdrop-blur">
        <span className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${phase === 'scan' ? 'pp-dot bg-[#1463FF]' : 'bg-[#12A150]'}`} />
          {phase === 'scan' ? 'AI sedang memeriksa foto…' : 'Selesai. Petugas akan memastikan.'}
        </span>
        <span className="text-[#7A8899]">hasil asli AI kami</span>
      </div>
    </div>
  );
};

const Step: React.FC<{ n: number; title: string; text: string }> = ({ n, title, text }) => (
  <div className="pp-rise rounded-3xl border border-[#E3E8EF] bg-[#FFFFFF] p-5" style={{ animationDelay: `${n * 90}ms` }}>
    <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#E8F0FF] text-lg font-extrabold text-[#1463FF]">{n}</span>
    <p className="mt-3 text-lg font-extrabold">{title}</p>
    <p className="mt-1 text-[15px] leading-relaxed text-[#5B6B7F]">{text}</p>
  </div>
);

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

  return (
    <div className="min-h-full w-full bg-[#F4F7FC] text-[#0E1B2C]">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2.5">
          <LogoMark size={36} />
          <Wordmark />
        </div>
        <button type="button" onClick={() => navigateTo('login')} className="cursor-pointer rounded-full px-4 py-2 text-sm font-bold text-[#1463FF] hover:bg-[#E8F0FF]">
          Masuk petugas
        </button>
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-10 px-5 pb-16 pt-6 md:grid-cols-2 md:pt-12">
        <div className="pp-rise">
          <span className="inline-flex items-center gap-2 rounded-full bg-[#FFF1E6] px-3 py-1.5 text-xs font-extrabold text-[#D9600C]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#FF7A1A]" /> Hampir 1 dari 6 km jalan di Indonesia rusak berat
          </span>
          <h1 className="mt-4 text-[40px] font-extrabold leading-[1.05] tracking-tight md:text-[56px]">
            Lihat jalan rusak? <span className="text-[#1463FF]">Potret saja.</span> Kami kawal sampai diperbaiki.
          </h1>
          <p className="mt-4 max-w-xl text-lg leading-relaxed text-[#5B6B7F]">
            AI mengenali kerusakannya dari foto Anda, petugas memastikannya di lokasi, dan Anda bisa memantau prosesnya
            sampai jalan kembali mulus. Tanpa daftar, tanpa isi email.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void start()}
              disabled={busy}
              className="inline-flex h-14 cursor-pointer items-center gap-2.5 rounded-full bg-[#FF7A1A] px-7 text-base font-extrabold text-[#FFFFFF] shadow-[0_14px_30px_-12px_rgba(255,122,26,0.8)] transition hover:-translate-y-0.5 hover:bg-[#F06A0A] disabled:opacity-60"
            >
              <Glyph name="camera" size={22} /> {busy ? 'Menyiapkan…' : 'Laporkan jalan rusak'}
            </button>
            <a href="#cara-kerja" className="inline-flex h-14 items-center gap-2 rounded-full px-5 text-base font-bold text-[#0E1B2C] hover:bg-[#FFFFFF]">
              Cara kerjanya <Glyph name="arrow" size={18} />
            </a>
          </div>
          {error && <p className="mt-3 text-sm font-semibold text-[#C53035]">{error}</p>}
          <p className="mt-4 text-sm text-[#7A8899]">Laporan Anda tersimpan di HP ini. Buka lagi kapan saja untuk melihat perkembangannya.</p>
        </div>
        <div className="pp-rise md:pl-6" style={{ animationDelay: '120ms' }}>
          <AiScan />
        </div>
      </section>

      <section id="cara-kerja" className="mx-auto max-w-6xl px-5 pb-16">
        <h2 className="text-3xl font-extrabold tracking-tight">Tiga langkah, selesai.</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <Step n={1} title="Potret di tempat" text="Laporan hanya bisa dikirim dari lokasi kerusakan. Titiknya diambil otomatis dari GPS HP Anda." />
          <Step n={2} title="AI memeriksa, petugas memastikan" text="Dalam hitungan detik AI mengenali lubang atau retak. Petugas lapangan lalu mengecek langsung dan membetulkan bila AI keliru." />
          <Step n={3} title="Pantau sampai beres" text="Setiap perubahan status muncul di Laporanku: diterima, diperiksa, dikerjakan, sampai selesai diperbaiki." />
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl items-center gap-8 px-5 pb-16 md:grid-cols-2">
        <img src={photo('perbaikan-kebumen')} alt="Perbaikan jalan berlubang di Kebumen" className="pp-rise aspect-[4/3] w-full rounded-[28px] object-cover" />
        <div className="pp-rise">
          <span className="text-sm font-extrabold uppercase tracking-wider text-[#1463FF]">Yang membuat beda</span>
          <h2 className="mt-2 text-3xl font-extrabold tracking-tight">Perbaikan yang tidak sia-sia.</h2>
          <p className="mt-3 text-lg leading-relaxed text-[#5B6B7F]">
            Banyak jalan ditambal lalu berlubang lagi, karena kerusakannya ada di bawah permukaan. Mesin PINN kami
            menghitung kekuatan lapisan jalan dengan rumus fisika, lalu memberi tahu petugas: cukup ditambal, perlu
            dilapis ulang, atau harus dibangun ulang. Termasuk berapa besar dampak truk kelebihan muatan dan musim hujan.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-16">
        <div className="grid gap-4 md:grid-cols-3">
          {[
            ['surabaya', 'Retak memanjang di Surabaya'],
            ['ubud-bali', 'Jalan berlubang di Ubud, Bali'],
            ['rambu-kebumen', 'Rambu peringatan di Ambal, Kebumen']
          ].map(([slug, caption], i) => (
            <figure key={slug} className="pp-rise overflow-hidden rounded-3xl bg-[#FFFFFF]" style={{ animationDelay: `${i * 90}ms` }}>
              <img src={photo(slug)} alt={caption} className="aspect-[4/3] w-full object-cover" loading="lazy" />
              <figcaption className="px-4 py-3 text-sm font-bold">{caption}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-16">
        <div className="grid gap-6 rounded-[32px] bg-[#0E1B2C] p-8 text-[#FFFFFF] md:grid-cols-3">
          <div>
            <p className="text-2xl font-extrabold">Foto Anda aman.</p>
            <p className="mt-2 text-[#FFFFFF]/70">Data tersembunyi di foto, seperti lokasi kamera dan jenis HP, dihapus sebelum disimpan.</p>
          </div>
          <div>
            <p className="text-2xl font-extrabold">AI di server sendiri.</p>
            <p className="mt-2 text-[#FFFFFF]/70">Foto tidak dikirim ke layanan AI pihak lain. Semua model berjalan di server kami dengan Intel OpenVINO.</p>
          </div>
          <div>
            <p className="text-2xl font-extrabold">Manusia yang memutuskan.</p>
            <p className="mt-2 text-[#FFFFFF]/70">AI hanya memberi usulan. Petugas dan koordinator yang memutuskan, dan setiap keputusan tercatat.</p>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button type="button" onClick={() => void start()} disabled={busy} className="inline-flex h-14 cursor-pointer items-center gap-2.5 rounded-full bg-[#FF7A1A] px-7 text-base font-extrabold text-[#FFFFFF] disabled:opacity-60">
            <Glyph name="camera" size={22} /> Laporkan jalan rusak
          </button>
          <button type="button" onClick={() => navigateTo('evidence')} className="inline-flex h-14 cursor-pointer items-center rounded-full px-6 text-base font-bold text-[#1463FF] hover:bg-[#E8F0FF]">
            Lihat bukti kerja AI
          </button>
        </div>
      </section>

      <footer className="border-t border-[#E3E8EF] bg-[#FFFFFF] px-5 py-6 text-xs text-[#7A8899]">
        <div className="mx-auto max-w-6xl space-y-1">
          <p>Foto: Wikimedia Commons.</p>
          {credits.map((c) => (
            <p key={c.file}>
              {c.title} oleh {c.author || 'tidak diketahui'} ({c.license}) ·{' '}
              <a href={c.source} target="_blank" rel="noopener noreferrer" className="underline">sumber</a>
            </p>
          ))}
          <p>Data jalan rusak berat: BPS, Statistik Transportasi Darat 2021.</p>
        </div>
      </footer>
    </div>
  );
};
