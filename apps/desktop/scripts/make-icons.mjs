// Writes the tray icons and the app icon as PNGs with no image dependencies. Commit the output.
// Run: `pnpm --filter @forever-ledger/desktop icons`.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const SAMPLES = 4; // supersampling per axis, for anti-aliased edges

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** RGBA pixels (width*height*4 bytes) → PNG file bytes. */
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** Renders `paint(x, y) → [r, g, b] | null` (null = transparent) with supersampled anti-aliasing. */
function render(size, paint) {
  const out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let hits = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const c = paint(px + (sx + 0.5) / SAMPLES, py + (sy + 0.5) / SAMPLES);
          if (!c) continue;
          r += c[0];
          g += c[1];
          b += c[2];
          hits++;
        }
      }
      const i = (py * size + px) * 4;
      if (hits === 0) continue;
      out[i] = Math.round(r / hits);
      out[i + 1] = Math.round(g / hits);
      out[i + 2] = Math.round(b / hits);
      out[i + 3] = Math.round((255 * hits) / (SAMPLES * SAMPLES));
    }
  }
  return encodePng(size, size, out);
}

/** A filled circle with a slightly darker rim so it reads on light and dark taskbars. */
function trayIcon(color) {
  const fill = hex(color);
  const rim = fill.map((v) => Math.round(v * 0.7));
  const c = 16;
  return render(32, (x, y) => {
    const d = Math.hypot(x - c, y - c);
    if (d > 14) return null;
    return d > 12.5 ? rim : fill;
  });
}

/** A gold "L" on a dark rounded square. */
function appIcon() {
  const bg = hex('#1f2330');
  const gold = hex('#d4a93a');
  const size = 256;
  const radius = 48;
  const inRoundedSquare = (x, y) => {
    const dx = Math.max(radius - x, 0, x - (size - radius));
    const dy = Math.max(radius - y, 0, y - (size - radius));
    return dx * dx + dy * dy <= radius * radius;
  };
  const inL = (x, y) =>
    (x >= 78 && x <= 118 && y >= 52 && y <= 204) || (x >= 78 && x <= 178 && y >= 164 && y <= 204);
  return render(size, (x, y) => {
    if (!inRoundedSquare(x, y)) return null;
    return inL(x, y) ? gold : bg;
  });
}

const TRAY = { idle: '#2e9d57', uploading: '#2f6fd6', queued: '#d99a1e', error: '#cf3a3a' };

await mkdir(ASSETS, { recursive: true });
for (const [state, color] of Object.entries(TRAY)) {
  await writeFile(join(ASSETS, `tray-${state}.png`), trayIcon(color));
}
await writeFile(join(ASSETS, 'icon.png'), appIcon());
console.log(`wrote ${Object.keys(TRAY).length + 1} icons to ${ASSETS}`);
