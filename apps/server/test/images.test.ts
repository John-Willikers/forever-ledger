// Zone map image validation: magic bytes and header dimensions only (no native deps, nothing decoded).
import { describe, expect, it } from 'vitest';
import {
  aspectWarning,
  ImageError,
  inspectImage,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_SIDE,
} from '../src/images.js';
import {
  jpeg,
  png,
  PNG_SIGNATURE,
  pngHeaderOnly,
  webpExtended,
  webpLossless,
  webpLossy,
} from './image-fixtures.js';

const reject = (buf: Buffer) => {
  try {
    inspectImage(buf);
  } catch (err) {
    expect(err).toBeInstanceOf(ImageError);
    return err as ImageError;
  }
  throw new Error('expected the image to be rejected');
};

describe('inspectImage', () => {
  it('reads PNG dimensions from IHDR', () => {
    expect(inspectImage(png(3, 2))).toEqual({ mime: 'image/png', width: 3, height: 2 });
    expect(inspectImage(pngHeaderOnly(1002, 668))).toEqual({
      mime: 'image/png',
      width: 1002,
      height: 668,
    });
  });

  it('reads WebP dimensions from VP8, VP8L and VP8X', () => {
    expect(inspectImage(webpLossy(1002, 668))).toEqual({
      mime: 'image/webp',
      width: 1002,
      height: 668,
    });
    expect(inspectImage(webpLossless(1002, 668))).toEqual({
      mime: 'image/webp',
      width: 1002,
      height: 668,
    });
    expect(inspectImage(webpExtended(4096, 1))).toEqual({
      mime: 'image/webp',
      width: 4096,
      height: 1,
    });
  });

  it('reads JPEG dimensions from SOFn (baseline, progressive, lossless)', () => {
    for (const sof of [0xc0, 0xc1, 0xc2, 0xc3, 0xc9, 0xcf]) {
      expect(inspectImage(jpeg(1002, 668, sof))).toEqual({
        mime: 'image/jpeg',
        width: 1002,
        height: 668,
      });
    }
  });

  it('skips JPEG fill bytes and standalone markers before SOFn', () => {
    const j = jpeg(20, 10);
    // SOI, then fill bytes 0xff 0xff before APP0's marker.
    const withFill = Buffer.concat([j.subarray(0, 2), Buffer.from([0xff, 0xff]), j.subarray(2)]);
    expect(inspectImage(withFill)).toMatchObject({ width: 20, height: 10 });
  });

  it('rejects SVG, HTML, text, empty and unknown data', () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>',
    );
    const html = Buffer.from('<!doctype html><html><body><script>alert(1)</script></body></html>');
    for (const buf of [
      svg,
      html,
      Buffer.from('hello'),
      Buffer.alloc(0),
      Buffer.from('GIF89a\x01\x00\x01\x00'),
      Buffer.from('BM\x00\x00'),
    ]) {
      const err = reject(buf);
      expect(err.status).toBe(400);
      expect(err.message).toMatch(/PNG, WebP or JPEG/);
    }
  });

  it('rejects a fake PNG: signature only, bad IHDR CRC, IHDR not first, zero size, truncated', () => {
    const good = png(4, 4);
    const badCrc = Buffer.from(good);
    badCrc[29] = badCrc[29]! ^ 0xff;
    const zero = pngHeaderOnly(0, 10);
    const notIhdr = Buffer.from(good);
    notIhdr.write('IHDX', 12, 'latin1');
    for (const [name, buf] of [
      ['signature only', PNG_SIGNATURE],
      ['bad crc', badCrc],
      ['ihdr renamed', notIhdr],
      ['zero width', zero],
      ['cut in IHDR', good.subarray(0, 20)],
      ['cut before IEND', good.subarray(0, good.length - 12)],
      ['cut mid IEND', good.subarray(0, good.length - 3)],
      ['html after signature', Buffer.concat([PNG_SIGNATURE, Buffer.from('<html>')])],
    ] as const) {
      expect(reject(buf).status, name).toBe(400);
    }
  });

  it('rejects a fake or truncated WebP', () => {
    const lossy = webpLossy(10, 10);
    const noStart = Buffer.from(lossy);
    noStart[23] = 0; // start code 9d 01 2a
    const lossless = webpLossless(10, 10);
    const badSig = Buffer.from(lossless);
    badSig[20] = 0;
    const unknown = Buffer.from(lossy);
    unknown.write('VP9 ', 12, 'latin1');
    for (const [name, buf] of [
      ['riff header only', lossy.subarray(0, 12)],
      ['truncated', lossy.subarray(0, lossy.length - 4)],
      ['trailing data', Buffer.concat([lossy, Buffer.from('<script>')])],
      ['no start code', noStart],
      ['bad VP8L signature', badSig],
      ['unknown chunk', unknown],
      ['RIFF but not WEBP', Buffer.concat([lossy.subarray(0, 8), Buffer.from('WAVE')])],
    ] as const) {
      expect(reject(buf).status, name).toBe(400);
    }
  });

  it('rejects a fake or truncated JPEG', () => {
    const j = jpeg(10, 10);
    const noSof = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      Buffer.from([0xff, 0xda, 0x00, 0x04, 0x00, 0x00]),
      Buffer.from([0xff, 0xd9]),
    ]);
    const zero = jpeg(0, 10);
    const badLen = Buffer.from(j);
    badLen.writeUInt16BE(1, 4); // APP0 length < 2
    for (const [name, buf] of [
      ['SOI only', j.subarray(0, 3)],
      ['cut in SOF', j.subarray(0, 30)],
      ['no EOI', j.subarray(0, j.length - 2)],
      ['SOS before SOF', noSof],
      ['zero width', zero],
      ['bad segment length', badLen],
      ['not a marker', Buffer.concat([j.subarray(0, 3), Buffer.from('<html>')])],
    ] as const) {
      expect(reject(buf).status, name).toBe(400);
    }
  });

  it(`rejects more than ${MAX_IMAGE_SIDE} px on a side`, () => {
    for (const buf of [
      pngHeaderOnly(MAX_IMAGE_SIDE + 1, 10),
      pngHeaderOnly(10, MAX_IMAGE_SIDE + 1),
      webpExtended(MAX_IMAGE_SIDE + 1, 10),
      jpeg(10, MAX_IMAGE_SIDE + 1),
      pngHeaderOnly(0x7fffffff, 0x7fffffff),
    ]) {
      const err = reject(buf);
      expect(err.status).toBe(400);
      expect(err.message).toMatch(/4096/);
    }
    expect(inspectImage(pngHeaderOnly(MAX_IMAGE_SIDE, MAX_IMAGE_SIDE)).width).toBe(MAX_IMAGE_SIDE);
  });

  it('rejects more than 8 MB with 413', () => {
    const big = Buffer.concat([png(2, 2), Buffer.alloc(MAX_IMAGE_BYTES)]);
    expect(reject(big).status).toBe(413);
  });
});

describe('aspectWarning', () => {
  it('is null at 1002:668 and close to it, a message otherwise', () => {
    expect(aspectWarning(1002, 668)).toBeNull();
    expect(aspectWarning(2004, 1336)).toBeNull();
    expect(aspectWarning(1000, 668)).toBeNull();
    expect(aspectWarning(1024, 1024)).toMatch(/1002:668/);
    expect(aspectWarning(668, 1002)).toMatch(/1002:668/);
  });
});
