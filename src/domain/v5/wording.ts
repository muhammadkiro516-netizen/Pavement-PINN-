/**
 * Banned-word checker (07 §13.2). Free text that reaches an event, a flag or a document must
 * stay descriptive: flags attach to a case, segment or package and never accuse a person.
 */
import banned from '../../../config/wording/banned_words.json';

const PATTERNS = banned.words.map((word) => ({ word, re: new RegExp(`(^|[^\\p{L}])${word.replace(/[-\s]/g, '[-\\s]?')}($|[^\\p{L}])`, 'iu') }));

/** Banned words found in the text; empty when the text is clean. */
export function bannedWordsIn(text: string): string[] {
  return PATTERNS.filter((p) => p.re.test(text)).map((p) => p.word);
}

/** Accusing words become "perlu klarifikasi"; everything else stays as written. */
export function neutralize(text: string): string {
  let out = text;
  for (const p of PATTERNS) out = out.replace(new RegExp(p.re.source, 'giu'), '$1perlu klarifikasi$2');
  return out.replace(/(perlu klarifikasi)(\s+perlu klarifikasi)+/gi, '$1').replace(/\s{2,}/g, ' ').trim();
}
