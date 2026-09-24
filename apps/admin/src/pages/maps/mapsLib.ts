// Pure helpers for the Maps page: the upload's client-side checks (the server decides; these only save a round trip)
// and row labels.

/** Largest upload the server accepts (bytes). */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
/** Largest width or height the server accepts (px). */
export const MAX_UPLOAD_SIDE = 4096;
const TYPES = ['image/png', 'image/webp', 'image/jpeg'];

/** Why a picked file can't be uploaded (type, size), or null. The server checks the bytes again. */
export function fileProblem(file: { type: string; size: number }) {
  if (!TYPES.includes(file.type)) return 'Pick a PNG, WebP or JPEG image.';
  if (file.size === 0) return 'That file is empty.';
  if (file.size > MAX_UPLOAD_BYTES) return 'That file is over 8 MB.';
  return null;
}

/** Why a loaded image's size can't be uploaded, or null. */
export function sizeProblem(width: number, height: number) {
  if (width > MAX_UPLOAD_SIDE || height > MAX_UPLOAD_SIDE) {
    return `The image is ${width}×${height} px; at most ${MAX_UPLOAD_SIDE} px per side.`;
  }
  return null;
}

/** "Durotar" or "Map 1411". */
export const zoneName = (m: { uiMapId: number; zone: string | null }) =>
  m.zone ?? `Map ${m.uiMapId}`;

/** `?build=` for the upload, from the form's text: a positive whole number, else none. */
export function buildQuery(raw: string) {
  const v = raw.trim();
  return /^\d{1,10}$/.test(v) && Number(v) > 0 && Number(v) <= 2_147_483_647 ? `?build=${v}` : '';
}

/** The image type's short name: "PNG", "WebP", "JPEG". */
export const mimeLabel = (mime: string) =>
  ({ 'image/png': 'PNG', 'image/webp': 'WebP', 'image/jpeg': 'JPEG' })[mime] ?? mime;
