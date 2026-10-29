/**
 * SPEC M8: "Relawan Pengawal Jalan" e-certificate, drawn on a canvas (A4 landscape, 150 dpi) and
 * saved as PDF. Only verified-outcome numbers from the server; the name is typed by the person and
 * never stored. A QR points to the public verification endpoint.
 */
import QRCode from 'qrcode';

const W = 1754;
const H = 1240;

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, fail) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = fail;
    i.src = src;
  });
}

export async function downloadCertificatePdf(c: { name: string; code: string; level: string; verified: number; repaired: number; areaM2: number; verifyUrl: string; paviSvg: string }) {
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const x = cv.getContext('2d')!;
  const f = (w: number, s: number) => `${w} ${s}px "Plus Jakarta Sans", system-ui, sans-serif`;

  const bg = x.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0B0D10');
  bg.addColorStop(1, '#1E2229');
  x.fillStyle = bg;
  x.fillRect(0, 0, W, H);
  // lane-marking frame
  x.strokeStyle = '#FFD60A';
  x.lineWidth = 10;
  x.setLineDash([60, 28]);
  x.strokeRect(50, 50, W - 100, H - 100);
  x.setLineDash([]);
  x.strokeStyle = 'rgba(255,214,10,0.35)';
  x.lineWidth = 2;
  x.strokeRect(80, 80, W - 160, H - 160);

  const pavi = await load(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(c.paviSvg)}`).catch(() => null);
  if (pavi) x.drawImage(pavi, 150, 330, 380, 437);

  x.textAlign = 'left';
  x.fillStyle = '#FFD60A';
  x.font = f(800, 34);
  x.fillText('PAVEMENTPINN · SERTIFIKAT', 600, 250);
  x.fillStyle = '#FFFFFF';
  x.font = f(800, 92);
  x.fillText('Relawan Pengawal Jalan', 600, 360);
  x.font = f(600, 36);
  x.fillStyle = 'rgba(255,255,255,0.7)';
  x.fillText('diberikan kepada', 600, 440);
  x.fillStyle = '#FFFFFF';
  x.font = f(800, 72);
  x.fillText(c.name || 'Warga PavementPINN', 600, 530);
  x.fillStyle = '#FFD60A';
  x.fillRect(600, 560, 760, 6);

  const stats: Array<[string, string]> = [[String(c.verified), 'laporan dibenarkan petugas'], [String(c.repaired), 'jalan sudah diperbaiki'], [`±${c.areaM2}`, 'm² jalan ikut diperbaiki']];
  stats.forEach(([v, l], i) => {
    const sx = 600 + i * 300;
    x.fillStyle = '#FFFFFF';
    x.font = f(800, 70);
    x.fillText(v, sx, 680);
    x.fillStyle = 'rgba(255,255,255,0.65)';
    x.font = f(600, 26);
    x.fillText(l, sx, 720);
  });
  x.fillStyle = 'rgba(255,255,255,0.85)';
  x.font = f(700, 34);
  x.fillText(`Level ${c.level}`, 600, 800);
  x.font = f(500, 26);
  x.fillStyle = 'rgba(255,255,255,0.6)';
  x.fillText('Atas kontribusi melaporkan dan mengawal perbaikan jalan secara akurat.', 600, 850);
  x.fillText('Dihitung dari laporan yang diverifikasi petugas, bukan dari jumlah laporan.', 600, 890);

  const qr = await load(await QRCode.toDataURL(c.verifyUrl, { margin: 1, width: 260 }));
  x.fillStyle = '#FFFFFF';
  x.fillRect(1390, 860, 240, 240);
  x.drawImage(qr, 1400, 870, 220, 220);
  x.fillStyle = 'rgba(255,255,255,0.6)';
  x.font = f(600, 22);
  x.textAlign = 'right';
  x.fillText(`Kode ${c.code} · ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`, 1370, 1080);
  x.fillText('Pindai QR untuk memeriksa keaslian', 1370, 1110);

  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'px', format: [W, H] });
  doc.addImage(cv.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, W, H);
  doc.save(`sertifikat-${c.code}.pdf`);
}
