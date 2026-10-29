/**
 * SPEC M4.3: share captions per situation x tone, with local hashtags. Every caption must pass
 * the banned-word checker (SPEC 0.4): no accusations, no names, neutral language.
 */
export type StoryTemplate = 'BARU' | 'BELUM_DITANGANI' | 'DIPERBAIKI' | 'SIAGA_HUJAN' | 'DAMPAK';
export type Tone = 'INFORMATIF' | 'MENDESAK' | 'APRESIASI';

export interface CaptionFacts {
  damage: string;
  place: string;
  agency: string | null;
  days: number;
  url: string;
  city?: string | null;
  points?: number;
  areaM2?: number;
}

const BANNED = [/korup/i, /mark-?up/i, /nakal/i, /lalai/i, /maling/i, /penipu/i, /bodoh/i, /pungli/i, /bohong/i];

export function bannedWords(text: string): string[] {
  return BANNED.filter((re) => re.test(text)).map((re) => re.source);
}

function hashtags(f: CaptionFacts): string {
  const city = (f.city ?? '').replace(/[^A-Za-z]/g, '');
  return ['#JalanAman', '#PavementPINN', city ? `#Jalan${city}` : null, '#LaporJalan'].filter(Boolean).join(' ');
}

export function caption(t: StoryTemplate, tone: Tone, f: CaptionFacts): string {
  const who = f.agency ?? 'instansi terkait';
  const lines: Record<StoryTemplate, Record<Tone, string>> = {
    BARU: {
      INFORMATIF: `Saya melaporkan ${f.damage.toLowerCase()} di ${f.place}. Laporan diteruskan ke ${who}.`,
      MENDESAK: `${f.damage} di ${f.place} berbahaya bagi pengendara, terutama motor dan saat hujan. Mohon ${who} menindaklanjuti.`,
      APRESIASI: `Terima kasih ${who} sudah menerima laporan ${f.damage.toLowerCase()} di ${f.place}. Mari kita kawal bersama.`
    },
    BELUM_DITANGANI: {
      INFORMATIF: `Hari ke-${f.days}: ${f.damage.toLowerCase()} di ${f.place} masih menunggu penanganan dari ${who}.`,
      MENDESAK: `Sudah ${f.days} hari ${f.damage.toLowerCase()} di ${f.place} belum ditangani. Mohon ${who} memasang rambu dan menjadwalkan perbaikan.`,
      APRESIASI: `Laporan ${f.damage.toLowerCase()} di ${f.place} sudah ${f.days} hari. Kami percaya ${who} sedang menjadwalkan, mari kita kawal.`
    },
    DIPERBAIKI: {
      INFORMATIF: `${f.damage} di ${f.place} sudah diperbaiki oleh ${who}. Sebelum dan sesudah ada di kartu ini.`,
      MENDESAK: `${f.damage} di ${f.place} sudah diperbaiki. Bantu pantau 1, 3 dan 6 bulan ke depan agar perbaikannya awet.`,
      APRESIASI: `Terima kasih ${who}! ${f.damage} di ${f.place} sudah diperbaiki.`
    },
    SIAGA_HUJAN: {
      INFORMATIF: `Siaga hujan: ada genangan dan kerusakan jalan di ${f.place}. Hati-hati saat melintas.`,
      MENDESAK: `Genangan menutupi lubang di ${f.place}. Pengendara motor, kurangi kecepatan. ${who}, mohon pasang rambu.`,
      APRESIASI: `Terima kasih warga yang ikut menandai genangan di ${f.place}. Info ini membantu ${who}.`
    },
    DAMPAK: {
      INFORMATIF: `Kontribusi saya untuk jalan yang lebih aman: ${f.points ?? 0} Poin Jalan Aman${f.areaM2 ? `, ±${f.areaM2} m² jalan ikut diperbaiki` : ''}.`,
      MENDESAK: `Jalan rusak di sekitarmu? Potret dan laporkan, AI langsung meneruskannya ke instansi yang berwenang.`,
      APRESIASI: `Terima kasih semua petugas dan warga yang ikut mengawal jalan kita.`
    }
  };
  const text = `${lines[t][tone]}\n${f.url}\n${hashtags(f)}`;
  if (bannedWords(text).length) throw new Error('Caption failed the neutral-language check.');
  return text;
}
