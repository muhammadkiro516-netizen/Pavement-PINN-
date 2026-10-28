/**
 * Validation of the report photo reference (execution brief §AS).
 *
 * Accepted: an https/http URL, or a data URL whose decoded bytes really are JPEG, PNG or
 * WebP (magic bytes checked, the declared MIME type is not trusted) and at most 5 MB.
 * The image stays inside the report record in the demo store; production uploads belong
 * in object storage (Supabase Storage, not configured — docs/GAP_REGISTER.md).
 *
 * Not done here: EXIF/GPS metadata stripping (needs an image library; tracked as a gap).
 */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export type PhotoCheck = { ok: true; kind: "url" | "jpeg" | "png" | "webp" } | { ok: false; message: string };

function sniff(bytes: Buffer): "jpeg" | "png" | "webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
}

export function checkPhotoReference(photoUrl: unknown): PhotoCheck {
  if (typeof photoUrl !== "string" || photoUrl.length === 0) return { ok: false, message: "A photo is required." };
  if (/^https?:\/\//i.test(photoUrl)) {
    if (photoUrl.length > 2048) return { ok: false, message: "Photo URL is too long." };
    return { ok: true, kind: "url" };
  }
  const match = /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=\s]+)$/i.exec(photoUrl);
  if (!match) return { ok: false, message: "Photo must be an image URL or a base64 image." };
  const bytes = Buffer.from(match[1], "base64");
  if (bytes.length > MAX_PHOTO_BYTES) return { ok: false, message: "Photo is larger than 5 MB." };
  const kind = sniff(bytes);
  if (!kind) return { ok: false, message: "Photo content is not a JPEG, PNG or WebP image." };
  return { ok: true, kind };
}

/**
 * Removes metadata from a base64 photo before it is stored (privacy: camera GPS, device,
 * owner name). JPEG: APP1–APP15 (EXIF, XMP, ...) and COM segments are dropped, APP0 and
 * the image data are kept. PNG: textual and eXIf chunks are dropped. Other values pass
 * through unchanged. Run after the CV analysis is bound by photo hash.
 */
export function stripPhotoMetadata(photoUrl: string): string {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(photoUrl);
  if (!match) return photoUrl;
  const bytes = Buffer.from(match[2], "base64");
  const cleaned = stripJpeg(bytes) ?? stripPng(bytes);
  return cleaned ? `data:${match[1]};base64,${cleaned.toString("base64")}` : photoUrl;
}

function stripJpeg(b: Buffer): Buffer | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  const parts: Buffer[] = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length && b[i] === 0xff) {
    const marker = b[i + 1];
    if (marker === 0xda) break; // start of scan: the rest is image data
    const len = b.readUInt16BE(i + 2);
    const isMeta = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!isMeta) parts.push(b.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  parts.push(b.subarray(i));
  return Buffer.concat(parts);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_META = new Set(["tEXt", "iTXt", "zTXt", "eXIf", "tIME"]);

function stripPng(b: Buffer): Buffer | null {
  if (b.length < 8 || !b.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  const parts: Buffer[] = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = b.readUInt32BE(i);
    const type = b.toString("latin1", i + 4, i + 8);
    const end = i + 12 + len;
    if (!PNG_META.has(type)) parts.push(b.subarray(i, end));
    i = end;
  }
  // Anything after the last chunk is kept as it was: only metadata chunks are removed.
  parts.push(b.subarray(i));
  return Buffer.concat(parts);
}
