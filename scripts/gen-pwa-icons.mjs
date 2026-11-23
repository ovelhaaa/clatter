#!/usr/bin/env node
/**
 * Generates crisp pixel-art monochrome PNG icons for the CLATTER PWA from the 16x16 favicon motif.
 * Zero external dependencies: uses Node's built-in zlib to encode RGBA/indexed PNGs.
 *
 * Copyright (C) 2026 The CLATTER contributors. SPDX-License-Identifier: GPL-3.0-only
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0; // filter type 0
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * 16x16 CLATTER mark:
 *   rect(2, 2, 3, 12)
 *   rect(6, 6, 3, 8)
 *   rect(10, 4, 3, 10)
 */
function isWhitePixel(gx, gy) {
  if (gx >= 2 && gx < 5 && gy >= 2 && gy < 14) return true;
  if (gx >= 6 && gx < 9 && gy >= 6 && gy < 14) return true;
  if (gx >= 10 && gx < 13 && gy >= 4 && gy < 14) return true;
  return false;
}

function renderIcon(size, scale) {
  const rgba = Buffer.alloc(size * size * 4);
  const motifSize = 16 * scale;
  const offset = Math.floor((size - motifSize) / 2);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const mx = x - offset;
      const my = y - offset;
      let white = false;
      if (mx >= 0 && mx < motifSize && my >= 0 && my < motifSize) {
        const gx = Math.floor(mx / scale);
        const gy = Math.floor(my / scale);
        white = isWhitePixel(gx, gy);
      }
      const v = white ? 255 : 0;
      rgba[idx] = v;
      rgba[idx + 1] = v;
      rgba[idx + 2] = v;
      rgba[idx + 3] = 255;
    }
  }
  return encodePng(size, size, rgba);
}

const outDir = resolve('public/icons');
mkdirSync(outDir, { recursive: true });

const targets = [
  ['icon-192.png', 192, 12],
  ['icon-512.png', 512, 32],
  ['icon-maskable-192.png', 192, 8],
  ['icon-maskable-512.png', 512, 18],
  ['apple-touch-icon.png', 180, 10],
];

for (const [name, size, scale] of targets) {
  const file = resolve(outDir, name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, renderIcon(size, scale));
  console.log(`Generated ${name} (${size}x${size}, scale ${scale}x)`);
}
