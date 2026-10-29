/** The citizen's Pavi avatar (helmet, vest, expression), kept on this device (SPEC M8, optional). */
import { PAVI_HELMETS, PAVI_VESTS, type PaviMood } from './Pavi';

const KEY = 'pp-pavi-helmet';
const AVATAR = 'pp-pavi-avatar';
export const PAVI_FACES: PaviMood[] = ['idle', 'found', 'celebrate', 'scan'];

export interface PaviAvatar {
  helmet: string;
  vest: string;
  mood: PaviMood;
}

export function readPaviHelmet(): string {
  try {
    const v = localStorage.getItem(KEY);
    return v && (PAVI_HELMETS as readonly string[]).includes(v) ? v : PAVI_HELMETS[0];
  } catch {
    return PAVI_HELMETS[0];
  }
}

export function savePaviHelmet(color: string): void {
  try {
    localStorage.setItem(KEY, color);
  } catch {
    // storage blocked: the default helmet is used
  }
}

export function readPavi(): PaviAvatar {
  let rest: Partial<PaviAvatar> = {};
  try {
    rest = JSON.parse(localStorage.getItem(AVATAR) ?? '{}');
  } catch {
    rest = {};
  }
  return {
    helmet: readPaviHelmet(),
    vest: rest.vest && (PAVI_VESTS as readonly string[]).includes(rest.vest) ? rest.vest : PAVI_VESTS[0],
    mood: rest.mood && PAVI_FACES.includes(rest.mood) ? rest.mood : 'idle'
  };
}

export function savePavi(next: PaviAvatar): void {
  savePaviHelmet(next.helmet);
  try {
    localStorage.setItem(AVATAR, JSON.stringify({ vest: next.vest, mood: next.mood }));
  } catch {
    // storage blocked: defaults are used
  }
}
