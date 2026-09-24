// Tiny images built in memory for the zone map tests: real PNGs (zlib + CRC), and WebP / JPEG files whose headers are
// exactly what a browser reads for the size (the pixel data is only a placeholder; the server never decodes it).
import { crc32, deflateSync } from 'node:zlib';

const u32be = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
};

function pngChunk(type: string, data: Buffer) {
  const t = Buffer.from(type, 'latin1');
  return Buffer.concat([u32be(data.length), t, data, u32be(crc32(Buffer.concat([t, data])))]);
}

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A valid RGB PNG of `width`×`height` (solid color, or `pixel(x, y)` → [r, g, b]). */
export function png(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number] = () => [40, 90, 60],
) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const row = 1 + width * 3;
  const raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      const o = y * row + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A PNG header claiming `width`×`height` (valid IHDR CRC) with a tiny IDAT: for size limits without big buffers. */
export function pngHeaderOnly(width: number, height: number) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(Buffer.alloc(8))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function riff(chunkType: string, payload: Buffer) {
  const padded = payload.length % 2 === 1 ? Buffer.concat([payload, Buffer.alloc(1)]) : payload;
  const chunk = Buffer.concat([
    Buffer.from(chunkType, 'latin1'),
    Buffer.from([
      payload.length & 0xff,
      (payload.length >> 8) & 0xff,
      (payload.length >> 16) & 0xff,
      (payload.length >>> 24) & 0xff,
    ]),
    padded,
  ]);
  const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), chunk]);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(body.length);
  return Buffer.concat([Buffer.from('RIFF', 'latin1'), size, body]);
}

/** Lossy WebP ('VP8 '): frame tag, start code 9d 01 2a, 14-bit width and height. */
export function webpLossy(width: number, height: number) {
  const p = Buffer.alloc(30);
  p[0] = 0x10; // keyframe, version 0, show frame
  p.writeUInt16LE(0, 1);
  p[3] = 0x9d;
  p[4] = 0x01;
  p[5] = 0x2a;
  p.writeUInt16LE(width & 0x3fff, 6);
  p.writeUInt16LE(height & 0x3fff, 8);
  return riff('VP8 ', p);
}

/** Lossless WebP ('VP8L'): signature 0x2f, then (width-1) and (height-1) in 14 bits each. */
export function webpLossless(width: number, height: number) {
  const p = Buffer.alloc(16);
  p[0] = 0x2f;
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  p.writeUInt32LE(bits >>> 0, 1);
  return riff('VP8L', p);
}

/** Extended WebP ('VP8X'): flags, 3 reserved bytes, (width-1) and (height-1) as 24-bit little endian. */
export function webpExtended(width: number, height: number) {
  const p = Buffer.alloc(10);
  p.writeUIntLE(width - 1, 4, 3);
  p.writeUIntLE(height - 1, 7, 3);
  return riff('VP8X', p);
}

const segment = (marker: number, data: Buffer) => {
  const len = Buffer.alloc(2);
  len.writeUInt16BE(data.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), len, data]);
};

/** A JPEG: SOI, APP0 (JFIF), a SOFn (baseline C0 by default) with the size, SOS, a few bytes of scan data, EOI. */
export function jpeg(width: number, height: number, sof = 0xc0) {
  const app0 = Buffer.from([0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0, 1, 0, 1, 0, 0]);
  const sofData = Buffer.alloc(15);
  sofData[0] = 8; // precision
  sofData.writeUInt16BE(height, 1);
  sofData.writeUInt16BE(width, 3);
  sofData[5] = 3; // components
  sofData.set([1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1], 6);
  const sos = Buffer.from([3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xe0, app0),
    segment(sof, sofData),
    segment(0xda, sos),
    Buffer.from([0x12, 0x34, 0x56, 0x78]),
    Buffer.from([0xff, 0xd9]),
  ]);
}
