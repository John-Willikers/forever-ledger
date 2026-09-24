// Zone map uploads: accept PNG, WebP or JPEG only, judged by magic bytes, with the size read from the header (PNG
// IHDR, WebP VP8/VP8L/VP8X, JPEG SOFn). Nothing is decoded and there are no native deps: the bytes are stored and
// served back as-is with the mime found here, never the one the client claimed. SVG, HTML and anything else are refused.
import { crc32 } from 'node:zlib';

export type ImageMime = 'image/png' | 'image/webp' | 'image/jpeg';

export interface ImageInfo {
  mime: ImageMime;
  width: number;
  height: number;
}

/** Largest upload accepted (bytes). */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** Largest width or height accepted (px). */
export const MAX_IMAGE_SIDE = 4096;
/** wow.export's canvas for a Classic zone map (UiMapArtStyleLayer LayerWidth × LayerHeight). */
export const ZONE_MAP_SIZE = { width: 1002, height: 668 } as const;
/** How far (relative) the aspect ratio may drift from 1002:668 before the upload gets a warning. */
const ASPECT_TOLERANCE = 0.02;

/** A refused image: 400 (not an accepted image, broken or too many pixels) or 413 (too many bytes). */
export class ImageError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413 = 400,
  ) {
    super(message);
    this.name = 'ImageError';
  }
}

const KIND = 'expected a PNG, WebP or JPEG image';
const broken = (what: string) => new ImageError(`${what}: truncated or not a valid image`);

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_IEND = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];

const startsWith = (buf: Buffer, bytes: readonly number[], at = 0) =>
  buf.length >= at + bytes.length && bytes.every((b, i) => buf[at + i] === b);
const ascii = (buf: Buffer, at: number, len: number) =>
  buf.length >= at + len ? buf.toString('latin1', at, at + len) : '';

/** PNG: signature, IHDR first (length 13, valid CRC), size from IHDR, and the file ends with IEND. */
function png(buf: Buffer): ImageInfo {
  if (buf.length < 8 + 25 + 12) throw broken('PNG');
  if (buf.readUInt32BE(8) !== 13 || ascii(buf, 12, 4) !== 'IHDR') throw broken('PNG');
  if (crc32(buf.subarray(12, 29)) !== buf.readUInt32BE(29)) throw broken('PNG');
  if (!startsWith(buf, PNG_IEND, buf.length - PNG_IEND.length)) throw broken('PNG');
  return { mime: 'image/png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** WebP: RIFF size matches the file, then the first chunk's header (VP8, VP8L or VP8X). */
function webp(buf: Buffer): ImageInfo {
  if (buf.length < 30 || buf.readUInt32LE(4) + 8 !== buf.length) throw broken('WebP');
  const chunk = ascii(buf, 12, 4);
  const at = 20;
  if (chunk === 'VP8 ') {
    // Frame tag (3 bytes), start code 9d 01 2a, then 14-bit width and height (2 scale bits each).
    if (!startsWith(buf, [0x9d, 0x01, 0x2a], at + 3)) throw broken('WebP');
    return {
      mime: 'image/webp',
      width: buf.readUInt16LE(at + 6) & 0x3fff,
      height: buf.readUInt16LE(at + 8) & 0x3fff,
    };
  }
  if (chunk === 'VP8L') {
    if (buf[at] !== 0x2f) throw broken('WebP');
    const bits = buf.readUInt32LE(at + 1);
    return { mime: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    return {
      mime: 'image/webp',
      width: buf.readUIntLE(at + 4, 3) + 1,
      height: buf.readUIntLE(at + 7, 3) + 1,
    };
  }
  throw broken('WebP');
}

/** SOFn markers: C0–CF except DHT (C4), JPG (C8) and DAC (CC). */
const isSof = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
/** Markers without a length: TEM and RST0–7 (SOI/EOI never appear mid-header). */
const standalone = (m: number) => m === 0x01 || (m >= 0xd0 && m <= 0xd7);

/** JPEG: walk the segments from SOI to the first SOFn (before SOS) for the size; the file ends with EOI. */
function jpeg(buf: Buffer): ImageInfo {
  if (buf[buf.length - 2] !== 0xff || buf[buf.length - 1] !== 0xd9) throw broken('JPEG');
  let i = 2;
  for (;;) {
    if (i >= buf.length || buf[i] !== 0xff) throw broken('JPEG');
    while (buf[i] === 0xff) i++; // fill bytes
    if (i >= buf.length) throw broken('JPEG');
    const marker = buf[i++]!;
    if (standalone(marker)) continue;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0xda || marker === 0x00)
      throw broken('JPEG');
    if (i + 2 > buf.length) throw broken('JPEG');
    const len = buf.readUInt16BE(i);
    if (len < 2 || i + len > buf.length) throw broken('JPEG');
    if (isSof(marker)) {
      if (len < 8) throw broken('JPEG');
      return {
        mime: 'image/jpeg',
        height: buf.readUInt16BE(i + 3),
        width: buf.readUInt16BE(i + 5),
      };
    }
    i += len;
  }
}

/**
 * The type and size of an uploaded zone map, from its bytes alone. Throws an ImageError: 413 above MAX_IMAGE_BYTES,
 * 400 for anything that isn't a well-formed PNG, WebP or JPEG header, a zero size or a side above MAX_IMAGE_SIDE.
 */
export function inspectImage(buf: Buffer): ImageInfo {
  if (buf.length > MAX_IMAGE_BYTES) {
    throw new ImageError(`image larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB`, 413);
  }
  let info: ImageInfo;
  if (startsWith(buf, PNG_SIGNATURE)) info = png(buf);
  else if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 4) === 'WEBP') info = webp(buf);
  else if (startsWith(buf, [0xff, 0xd8, 0xff])) info = jpeg(buf);
  else throw new ImageError(KIND);
  if (info.width < 1 || info.height < 1) throw broken(info.mime);
  if (info.width > MAX_IMAGE_SIDE || info.height > MAX_IMAGE_SIDE) {
    throw new ImageError(
      `image is ${info.width}×${info.height} px; at most ${MAX_IMAGE_SIDE} px per side`,
    );
  }
  return info;
}

/** A warning when the image isn't ≈ 1002:668 (points would land off by the stretch), else null. */
export function aspectWarning(width: number, height: number): string | null {
  const want = ZONE_MAP_SIZE.width / ZONE_MAP_SIZE.height;
  const got = width / height;
  if (Math.abs(got / want - 1) <= ASPECT_TOLERANCE) return null;
  return (
    `aspect ratio ${width}×${height} is not 1002:668 (wow.export's zone map canvas); ` +
    'points may not line up — check the preview'
  );
}
