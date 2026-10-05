#!/usr/bin/env node
/**
 * Icon generator — produces the PNG icons the PWA manifest and the Capacitor apps need.
 *
 * Dependency-free: PNG is written by hand (IHDR + zlib-compressed IDAT + IEND, with CRC32) using
 * only node:zlib and node:fs. The logo is rasterised procedurally so the source of truth is this
 * file, not a binary asset that can drift from the brand.
 *
 * Usage: node scripts/generate-icons.js [outDir]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

// --- PNG plumbing ---------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * Encode an RGBA bitmap to PNG.
 * @param {Buffer} rgba  width*height*4 bytes
 */
function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Each scanline is prefixed with a filter-type byte; 0 (None) keeps this simple and still
  // compresses well because large areas of the logo are flat colour.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- logo rasteriser ------------------------------------------------------

function hexToRgba(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

/** Alpha-composite `fg` over `bg` (both [r,g,b,a]). */
function over(bg, fg) {
  const a = fg[3] / 255;
  const inv = 1 - a;
  return [
    Math.round(fg[0] * a + bg[0] * inv),
    Math.round(fg[1] * a + bg[1] * inv),
    Math.round(fg[2] * a + bg[2] * inv),
    255,
  ];
}


/**
 * Draw the CloudHost247 mark: a rounded blue tile, a white cloud, two green server legs.
 * Coordinates are expressed in a 64x64 design space and scaled to `size`.
 *
 * @param {object} options
 * @param {boolean} [options.maskable] pad the artwork into the safe zone (Android adaptive icons)
 */
function renderLogo(size, options = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const scale = size / 64;
  const transparent = Boolean(options.transparent);
  const background = hexToRgba('#0756d8');
  const white = [255, 255, 255, 255];
  const green = hexToRgba('#12b886');

  // Maskable icons need ~20% padding so a launcher can crop to a circle without clipping art.
  const pad = options.maskable ? 8 : 0;
  const inner = 64 - pad * 2;

  // The artwork is authored in a 64x64 design space (the coordinates of the existing SVG
  // favicon). For maskable output it is scaled into `inner` and offset by `pad`.
  const artScale = inner / 64;

  const put = (px, py, color) => {
    const i = (py * size + px) * 4;
    rgba[i] = color[0];
    rgba[i + 1] = color[1];
    rgba[i + 2] = color[2];
    rgba[i + 3] = color[3];
  };

  /** Rounded-rect test in design space. */
  const inTile = (du, dv, radius) => {
    const dx = Math.max(radius - du, du - (64 - radius), 0);
    const dy = Math.max(radius - dv, dv - (64 - radius), 0);
    return dx * dx + dy * dy <= radius * radius;
  };

  // Approximation of the SVG path M20 40a9…: three lobes plus a flat base.
  const lobes = [
    { cx: 26, cy: 30, r: 9.2 },
    { cx: 36, cy: 26.5, r: 11.5 },
    { cx: 44, cy: 31.5, r: 8.4 },
  ];
  const inCloud = (u, v) => lobes.some((c) => (u - c.cx) ** 2 + (v - c.cy) ** 2 <= c.r * c.r)
    || (v >= 30 && v <= 39.5 && u >= 17.5 && u <= 45.5);

  const inLeg = (u, v) => v >= 43 && v < 49
    && ((u >= 26 && u < 30) || (u >= 34 && u < 38));

  // Iterate the OUTPUT grid and map each pixel back into artwork space. Iterating artwork space
  // instead would only paint every `scale`-th pixel, leaving the artwork speckled at large sizes.
  for (let py = 0; py < size; py += 1) {
    const dv = (py + 0.5) / scale;
    for (let px = 0; px < size; px += 1) {
      const du = (px + 0.5) / scale;

      if (transparent) {
        if (!inTile(du, dv, 14)) continue;
      } else if (!inTile(du, dv, 14)) {
        continue; // outside the rounded tile stays fully transparent
      }

      if (transparent) {
        // Transparent variant: only the artwork is drawn, on a fully transparent tile.
        const u = (du - pad) / artScale;
        const v = (dv - pad) / artScale;
        const inArt = u >= 0 && u < 64 && v >= 0 && v < 64;
        if (!inArt || (!inCloud(u, v) && !inLeg(u, v))) continue;
        put(px, py, inLeg(u, v) ? green : white);
        continue;
      }

      let color = background;
      const u = (du - pad) / artScale;
      const v = (dv - pad) / artScale;
      if (u >= 0 && u < 64 && v >= 0 && v < 64) {
        if (inLeg(u, v)) color = green;
        else if (inCloud(u, v)) color = white;
      }
      put(px, py, color);
    }
  }

  return rgba;
}

// --- output ---------------------------------------------------------------

function main() {
  const outDir = path.resolve(process.argv[2] ?? path.join(__dirname, '..', 'public', 'icons'));
  fs.mkdirSync(outDir, { recursive: true });

  const targets = [
    { size: 192, file: 'icon-192.png' },
    { size: 512, file: 'icon-512.png' },
    { size: 192, file: 'icon-maskable-192.png', maskable: true },
    { size: 512, file: 'icon-maskable-512.png', maskable: true },
    { size: 180, file: 'apple-touch-icon.png' },
    { size: 32, file: 'favicon-32.png' },
  ];

  for (const target of targets) {
    const rgba = renderLogo(target.size, { maskable: target.maskable });
    const file = path.join(outDir, target.file);
    fs.writeFileSync(file, encodePng(target.size, target.size, rgba));
    process.stdout.write(`wrote ${path.relative(process.cwd(), file)} (${target.size}x${target.size})\n`);
  }

  // Capacitor needs splash screens; generate the two the templates reference by default.
  const splashDir = path.resolve(path.join(__dirname, '..', 'mobile', 'resources'));
  fs.mkdirSync(splashDir, { recursive: true });
  for (const [file, size] of [['splash.png', 1284], ['icon.png', 1024]]) {
    const rgba = renderLogo(size);
    fs.writeFileSync(path.join(splashDir, file), encodePng(size, size, rgba));
    process.stdout.write(`wrote mobile/resources/${file} (${size}x${size})\n`);
  }
}

if (require.main === module) main();

module.exports = { encodePng, renderLogo, crc32 };
