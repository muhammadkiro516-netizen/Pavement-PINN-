/** The citizen's chosen Pavi helmet colour, kept on this device. */
import { PAVI_HELMETS } from './Pavi';

const KEY = 'pp-pavi-helmet';

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
