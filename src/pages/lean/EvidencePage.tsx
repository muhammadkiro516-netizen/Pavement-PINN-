/**
 * Route /bukti/ — public transparency page: what the AI is, how fast and how accurate it is
 * (numbers only from src/data/measurements/summary.json, written by
 * inference/scripts/benchmark.py and evaluate.py), what the live service reports, how privacy
 * is handled, the limits, and which GenAI tools built this app.
 */
import React, { useEffect, useState } from 'react';
import { Glyph } from '../../components/ui/brand';
import { Pill, SnapCard, SnapPage, Stat } from '../../components/ui/snap';
import { useRouter } from '../../app/router';
import { apiUrl } from '../../services/api/client';
import { WORKFLOW_API_PATHS } from '../../types';
import summary from '../../data/measurements/summary.json';

interface LatencyRow { model: string; precision: string; device: string; p50Ms: number; p90Ms: number; fps: number }
interface Accuracy { dataset: string; images: number; map50: number; precision: number; recall: number; f1: number; note: string }
interface Agreement { photos: number; fp32Objects: number; int8Matched: number; agreement: number | null }
interface Summary { generatedAt: string | null; machine: { cpu: string; devices: string[]; openvino: string } | null; latency: LatencyRow[]; accuracy: Accuracy | null; int8Agreement?: Agreement }

const S = summary as Summary;

const ENGINES = [
  { name: 'Deteksi kerusakan', what: 'YOLOv8n (RDD) di OpenVINO: lubang, retak memanjang/melintang/buaya/tepi/blok', why: 'Mengenali jenis kerusakan dari foto warga dalam hitungan detik.' },
  { name: 'Segmentasi retak', what: 'YOLOv8s-seg di OpenVINO: peta piksel retak, panjang dan lebar retak', why: 'Mengukur luas dan pola retak untuk menilai tingkat keparahan.' },
  { name: 'PINN (Physics-Informed Neural Network surrogate)', what: 'Jaringan saraf yang dilatih dari 19.894 solusi fisika perkerasan berlapis (MLET/PyMastic) dengan batasan hukum fisika; INT8 lewat NNCF', why: 'Menjawab: rusak di permukaan atau di struktur? Berapa dampak truk kelebihan muatan dan musim hujan? Penanganan mana yang tidak sia-sia?' },
  { name: 'Solver MLET (rujukan fisika)', what: 'Teori elastis berlapis (PyMastic) untuk memeriksa PINN dan menghitung peta regangan', why: 'Angka PINN selalu bisa dicek dengan fisika aslinya.' }
];

export const EvidencePage: React.FC = () => {
  const { navigateTo } = useRouter();
  const [health, setHealth] = useState<{ computerVision?: { status: string }; structural?: { status: string } } | null>(null);
  useEffect(() => {
    fetch(apiUrl(WORKFLOW_API_PATHS.systemHealth))
      .then((r) => r.json())
      .then((j) => setHealth(j.ai ?? null))
      .catch(() => setHealth(null));
  }, []);
  const ok = (s?: string) => (s === 'OK' ? <Pill tone="green">Aktif</Pill> : <Pill tone="red">{s ?? 'Tidak terjangkau'}</Pill>);

  return (
    <SnapPage
      title="Bukti & Transparansi"
      subtitle="Semua angka di halaman ini diukur, bukan diperkirakan."
      action={<button type="button" onClick={() => history.length > 1 ? history.back() : navigateTo('login')} className="cursor-pointer rounded-full bg-[#1E2229] p-2.5" aria-label="Kembali"><span className="block rotate-180"><Glyph name="arrow" size={20} /></span></button>}
    >
      <SnapCard>
        <p className="mb-2 font-extrabold">Status layanan AI saat ini</p>
        <div className="flex items-center justify-between py-1 text-sm"><span>Computer vision</span>{ok(health?.computerVision?.status)}</div>
        <div className="flex items-center justify-between py-1 text-sm"><span>PINN + MLET</span>{ok(health?.structural?.status)}</div>
      </SnapCard>

      <h2 className="pt-2 text-lg font-extrabold">Mesin AI</h2>
      {ENGINES.map((e) => (
        <SnapCard key={e.name}>
          <p className="font-extrabold">{e.name}</p>
          <p className="mt-1 text-sm text-[#D1D1D6]">{e.what}</p>
          <p className="mt-1 text-sm text-[#FFD60A]">{e.why}</p>
        </SnapCard>
      ))}

      <h2 className="pt-2 text-lg font-extrabold">Kecepatan inferensi (Intel OpenVINO)</h2>
      {S.latency.length === 0 ? (
        <SnapCard><p className="text-sm text-[#A1A1AA]">Belum diukur.</p></SnapCard>
      ) : (
        <SnapCard>
          {S.machine && <p className="mb-2 text-xs text-[#8E8E93]">{S.machine.cpu} · OpenVINO {S.machine.openvino} · perangkat: {S.machine.devices.join(', ')}</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-[#8E8E93]">
                <tr><th className="py-1 pr-2">Model</th><th className="pr-2">Presisi</th><th className="pr-2">Perangkat</th><th className="pr-2 text-right">p50 (ms)</th><th className="text-right">FPS</th></tr>
              </thead>
              <tbody>
                {S.latency.map((r) => (
                  <tr key={`${r.model}-${r.precision}-${r.device}`} className="border-t border-[#2A2F37]">
                    <td className="py-1.5 pr-2">{r.model}</td><td className="pr-2">{r.precision}</td><td className="pr-2">{r.device}</td>
                    <td className="pr-2 text-right font-bold">{r.p50Ms.toFixed(1)}</td><td className="text-right">{r.fps.toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {S.int8Agreement?.agreement != null && (
            <p className="mt-2 text-sm text-[#D1D1D6]">
              Kuantisasi INT8 (NNCF) menemukan {S.int8Agreement.int8Matched} dari {S.int8Agreement.fp32Objects} objek yang ditemukan versi FP32
              ({Math.round(S.int8Agreement.agreement * 100)}%, {S.int8Agreement.photos} foto). Karena belum setara, aplikasi tetap memakai FP32.
            </p>
          )}
          {S.generatedAt && <p className="mt-2 text-xs text-[#6E6E73]">Diukur {new Date(S.generatedAt).toLocaleString('id-ID')} pada mesin di atas; median dari 40 kali jalan.</p>}
        </SnapCard>
      )}

      <h2 className="pt-2 text-lg font-extrabold">Akurasi deteksi</h2>
      {S.accuracy ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Stat value={S.accuracy.map50.toFixed(3)} label="mAP@50" />
            <Stat value={S.accuracy.f1.toFixed(3)} label="F1" hint={`presisi ${S.accuracy.precision.toFixed(2)} · recall ${S.accuracy.recall.toFixed(2)}`} />
          </div>
          <SnapCard><p className="text-sm text-[#D1D1D6]">{S.accuracy.dataset} · {S.accuracy.images} foto. {S.accuracy.note}</p></SnapCard>
        </>
      ) : (
        <SnapCard><p className="text-sm text-[#A1A1AA]">Belum diukur.</p></SnapCard>
      )}
      <SnapCard>
        <p className="text-sm text-[#D1D1D6]">
          Akurasi lapangan dihitung terus dari koreksi petugas pada setiap inspeksi (human-in-the-loop) dan tampil di Statistik Koordinator.
        </p>
      </SnapCard>

      <h2 className="pt-2 text-lg font-extrabold">Privasi & etika</h2>
      <SnapCard>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-[#E5E5EA]">
          <li>Semua AI berjalan di server kami sendiri (OpenVINO). Foto tidak dikirim ke layanan AI pihak ketiga.</li>
          <li>Metadata foto (EXIF, termasuk GPS kamera) dibuang saat foto dianalisis; lokasi laporan hanya titik yang Anda pilih.</li>
          <li>AI hanya mengusulkan. Setiap keputusan (terima laporan, tugaskan, setujui perbaikan) diambil manusia dan tercatat di jejak audit.</li>
          <li>Hasil AI di bawah ambang keyakinan selalu ditinjau petugas. Koreksi petugas dipakai mengukur dan memperbaiki model.</li>
          <li>Setiap angka diberi sumbernya: diukur, diisi petugas, atau asumsi desain.</li>
        </ul>
      </SnapCard>

      <h2 className="pt-2 text-lg font-extrabold">Batasan yang kami akui</h2>
      <SnapCard>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-[#E5E5EA]">
          <li>Kedalaman lubang tidak bisa diukur dari satu foto; petugas mengukurnya di lokasi.</li>
          <li>Model deteksi dilatih dengan dataset kerusakan jalan internasional; akurasi pada jalan Indonesia diukur dari koreksi petugas.</li>
          <li>Perkiraan umur jalan dari PINN bergantung pada tebal lapisan dan jumlah truk yang diisi petugas; hasilnya indikatif, bukan desain.</li>
        </ul>
      </SnapCard>

      <h2 className="pt-2 text-lg font-extrabold">Pengungkapan penggunaan GenAI</h2>
      <SnapCard>
        <p className="text-sm text-[#E5E5EA]">
          Aplikasi ini dikembangkan dengan bantuan asisten coding AI, termasuk Claude (Anthropic) melalui Claude Code, untuk
          penulisan dan refactor kode, tes, dan dokumentasi. Daftar lengkap tool ada di docs/GENAI_DISCLOSURE.md. Ide, konsep human-in-the-loop, keputusan produk, dan pengujian dilakukan oleh tim.
          Aplikasi yang berjalan
          tidak memanggil layanan GenAI apa pun.
        </p>
      </SnapCard>
    </SnapPage>
  );
};
