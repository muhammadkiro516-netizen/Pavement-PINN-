/**
 * SPEC M4.1: 1080x1920 story card drawn on a canvas in the browser. The photo is ALWAYS blurred
 * (SPEC 0.5: faces and plates must not be readable); AI boxes are drawn on top. Nothing leaves
 * the device until the person shares the image.
 */
import QRCode from 'qrcode';
import type { StoryTemplate } from '../../domain/share/captions';

export interface StoryInput {
  template: StoryTemplate;
  photoUrl: string | null;
  afterPhotoUrl?: string | null;
  boxes?: Array<{ bbox: [number, number, number, number]; label: string }>;
  imageSize?: { width: number; height: number } | null;
  damage: string;
  severity?: string | null;
  address: string;
  agency: string | null;
  statusLabel: string;
  days: number;
  url: string;
  verified: boolean;
  aiAnalysed: boolean;
  impact?: { points: number; level: string; areaM2: number; verified: number };
  paviSvg?: string | null;
}

const W = 1080;
const H = 1920;
const TITLE: Record<StoryTemplate, string> = {
  BARU: 'LAPORAN BARU',
  BELUM_DITANGANI: 'BELUM DITANGANI',
  DIPERBAIKI: 'SUDAH DIPERBAIKI',
  SIAGA_HUJAN: 'SIAGA HUJAN',
  DAMPAK: 'KARTU DAMPAKKU'
};
const ACCENT: Record<StoryTemplate, string> = { BARU: '#FFD60A', BELUM_DITANGANI: '#FF4D5E', DIPERBAIKI: '#2BD67B', SIAGA_HUJAN: '#38BDF8', DAMPAK: '#FFD60A' };

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number, maxLines = 3): number {
  const words = text.split(/\s+/);
  let line = '';
  let lines = 0;
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > maxW && line) {
      ctx.fillText(line, x, y + lines * lh);
      lines += 1;
      line = w;
      if (lines === maxLines - 1) break;
    } else line = t;
  }
  ctx.fillText(line, x, y + lines * lh);
  return y + (lines + 1) * lh;
}

/** Photo drawn cover-fit into the box, blurred, with AI boxes mapped from image pixels. */
async function photo(ctx: CanvasRenderingContext2D, src: string, x: number, y: number, w: number, h: number, input: StoryInput, withBoxes: boolean) {
  const img = await load(src).catch(() => null);
  ctx.save();
  rounded(ctx, x, y, w, h, 40);
  ctx.clip();
  if (!img) {
    ctx.fillStyle = '#1E2229';
    ctx.fillRect(x, y, w, h);
    ctx.restore();
    return;
  }
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  const ox = x + (w - dw) / 2;
  const oy = y + (h - dh) / 2;
  ctx.filter = 'blur(14px)';
  ctx.drawImage(img, ox - 20, oy - 20, dw + 40, dh + 40);
  ctx.filter = 'none';
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(x, y, w, h);
  if (withBoxes && input.boxes?.length) {
    const sx = dw / (input.imageSize?.width ?? img.width);
    const sy = dh / (input.imageSize?.height ?? img.height);
    ctx.lineWidth = 8;
    ctx.font = '700 34px "Plus Jakarta Sans", system-ui, sans-serif';
    for (const b of input.boxes.slice(0, 4)) {
      const [x1, y1, x2, y2] = b.bbox;
      const bx = ox + x1 * sx;
      const by = oy + y1 * sy;
      ctx.strokeStyle = '#FF6B2C';
      rounded(ctx, bx, by, (x2 - x1) * sx, (y2 - y1) * sy, 18);
      ctx.stroke();
      const tw = ctx.measureText(b.label).width + 28;
      ctx.fillStyle = '#FF6B2C';
      rounded(ctx, bx, by - 54, tw, 48, 14);
      ctx.fill();
      ctx.fillStyle = '#0B0D10';
      ctx.fillText(b.label, bx + 14, by - 18);
    }
  }
  ctx.restore();
}

export async function renderStoryCard(input: StoryInput): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const accent = ACCENT[input.template];
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#15181D');
  g.addColorStop(1, '#0B0D10');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const font = (w: number, s: number) => `${w} ${s}px "Plus Jakarta Sans", system-ui, sans-serif`;

  // header
  ctx.font = font(800, 38);
  const tw = ctx.measureText(TITLE[input.template]).width + 64;
  ctx.fillStyle = accent;
  rounded(ctx, 64, 96, tw, 72, 36);
  ctx.fill();
  ctx.fillStyle = '#0B0D10';
  ctx.fillText(TITLE[input.template], 96, 146);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = font(800, 40);
  ctx.textAlign = 'right';
  ctx.fillText('PavementPINN', W - 64, 146);
  ctx.textAlign = 'left';

  if (input.template === 'DAMPAK' && input.impact) {
    if (input.paviSvg) {
      const pavi = await load(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(input.paviSvg)}`).catch(() => null);
      if (pavi) ctx.drawImage(pavi, W / 2 - 220, 300, 440, 506);
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = accent;
    ctx.font = font(800, 140);
    ctx.fillText(String(input.impact.points), W / 2, 960);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = font(700, 48);
    ctx.fillText('Poin Jalan Aman', W / 2, 1030);
    ctx.font = font(800, 64);
    ctx.fillText(input.impact.level, W / 2, 1140);
    ctx.font = font(600, 42);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(`${input.impact.verified} laporan dibenarkan petugas`, W / 2, 1240);
    ctx.fillText(`±${input.impact.areaM2} m² jalan ikut diperbaiki`, W / 2, 1300);
    ctx.textAlign = 'left';
  } else if (input.template === 'DIPERBAIKI' && input.afterPhotoUrl && input.photoUrl) {
    await photo(ctx, input.photoUrl, 64, 230, 466, 760, input, false);
    await photo(ctx, input.afterPhotoUrl, 550, 230, 466, 760, input, false);
    ctx.font = font(800, 34);
    for (const [label, x] of [['SEBELUM', 96], ['SESUDAH', 582]] as const) {
      ctx.fillStyle = 'rgba(11,13,16,0.75)';
      rounded(ctx, x, 940, 200, 56, 28);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(label, x + 24, 980);
    }
  } else if (input.photoUrl) {
    await photo(ctx, input.photoUrl, 64, 230, W - 128, 900, input, true);
  }

  // facts
  let y = input.template === 'DAMPAK' ? 1400 : 1220;
  if (input.template !== 'DAMPAK') {
    ctx.font = font(800, 64);
    ctx.fillStyle = '#FFFFFF';
    y = wrap(ctx, `${input.damage}${input.severity ? ` · ${input.severity}` : ''}`, 64, y, W - 128, 74, 2);
    ctx.font = font(600, 40);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    y = wrap(ctx, input.address, 64, y + 6, W - 128, 50, 2);
    ctx.fillText(`Instansi: ${input.agency ?? 'sedang ditentukan'}`, 64, y + 14);
    y += 80;
    ctx.fillStyle = accent;
    ctx.font = font(800, 46);
    ctx.fillText(`${input.statusLabel} · Hari ke-${input.days}`, 64, y);
  }

  // QR + footer
  const qr = await QRCode.toDataURL(input.url, { margin: 1, width: 260, color: { dark: '#0B0D10', light: '#FFFFFF' } });
  const qrImg = await load(qr);
  ctx.fillStyle = '#FFFFFF';
  rounded(ctx, W - 64 - 280, H - 380, 280, 280, 28);
  ctx.fill();
  ctx.drawImage(qrImg, W - 64 - 270, H - 370, 260, 260);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = font(700, 36);
  ctx.fillText(input.url.replace(/^https?:\/\//, ''), 64, H - 300);
  ctx.font = font(600, 32);
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  const note = input.template === 'DAMPAK' ? 'Dihitung dari laporan terverifikasi' : input.verified ? 'Dianalisis AI · diverifikasi petugas' : input.aiAnalysed ? 'Dianalisis AI · menunggu verifikasi petugas' : 'Menunggu verifikasi petugas';
  ctx.fillText(note, 64, H - 248);
  ctx.fillText('Foto dikaburkan untuk privasi', 64, H - 200);

  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas'))), 'image/png'));
}
