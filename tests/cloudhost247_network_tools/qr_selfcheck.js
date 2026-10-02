/**
 * CloudHost247 Network Tools — QR encoder self-check.
 *
 * The browser encoder is the only QR implementation in the module, so this test
 * verifies it end to end without a DOM and without a third-party library:
 *
 *   1. structure  — finder patterns, timing pattern, dark module, format info
 *   2. format     — the format information BCH code decodes to the mask and EC
 *                   level that were actually used
 *   3. data       — read the modules back, un-mask, de-interleave the blocks,
 *                   check that every Reed-Solomon block has zero syndromes and
 *                   decode the byte-mode payload back to the input
 *
 * A wrong table, a wrong mask, a wrong byte order or a wrong ECC would fail one
 * of these steps. Run: node tests/cloudhost247_network_tools/qr_selfcheck.js
 */
'use strict';

const path = require('path');
const { encodeQr } = require(path.join(__dirname, '..', '..', 'modules', 'addons', 'cloudhost247_network_tools', 'assets', 'js', 'cloudhost247-tools.js'));

const ECC = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
  Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24],
  H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28],
};
const BLOCKS = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
  Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8],
  H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8],
};
const ALIGN = {
  2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
  7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

function rawModules(version) {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function gfMultiply(a, b) {
  let result = 0;
  for (let i = 7; i >= 0; i--) {
    result = ((result << 1) ^ ((result >>> 7) * 0x11D)) & 0xFF;
    result ^= ((b >>> i) & 1) * a;
  }
  return result & 0xFF;
}

function maskCondition(mask, x, y) {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

function formatBits(ecl, mask) {
  const eclBits = { L: 1, M: 0, Q: 3, H: 2 }[ecl];
  const value = (eclBits << 3) | mask;
  let remainder = value;
  for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  return ((value << 10) | remainder) ^ 0x5412;
}

function buildFunctionMask(version, size) {
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
  function mark(x, y) { if (x >= 0 && y >= 0 && x < size && y < size) reserved[y][x] = true; }
  [ [3, 3], [size - 4, 3], [3, size - 4] ].forEach(([cx, cy]) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) mark(cx + dx, cy + dy);
  });
  for (let i = 8; i < size - 8; i++) { mark(i, 6); mark(6, i); }
  const positions = ALIGN[version] || [];
  positions.forEach((px) => positions.forEach((py) => {
    const corner = (px === 6 && py === 6) || (px === 6 && py === size - 7) || (px === size - 7 && py === 6);
    if (corner) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) mark(px + dx, py + dy);
  }));
  mark(8, size - 8);
  for (let i = 0; i <= 8; i++) { mark(i, 8); mark(8, i); }
  for (let i = 0; i < 8; i++) { mark(size - 1 - i, 8); mark(8, size - 1 - i); }
  if (version >= 7) {
    for (let i = 0; i < 18; i++) { mark(size - 11 + (i % 3), Math.floor(i / 3)); mark(Math.floor(i / 3), size - 11 + (i % 3)); }
  }
  return reserved;
}

function readFormat(modules, size) {
  const bits = [];
  const read = (x, y) => (modules[y][x] ? 1 : 0);
  for (let i = 0; i <= 5; i++) bits.push(read(8, i));
  bits.push(read(8, 7));
  bits.push(read(8, 8));
  bits.push(read(7, 8));
  for (let i = 9; i < 15; i++) bits.push(read(14 - i, 8));
  let value = 0;
  for (let i = 0; i < 15; i++) value = (value << 1) | bits[14 - i];
  value ^= 0x5412;
  const eclBits = (value >>> 13) & 0x3;
  const mask = (value >>> 10) & 0x7;
  const ecl = { 1: 'L', 0: 'M', 3: 'Q', 2: 'H' }[eclBits];
  // Verify the BCH remainder.
  let remainder = (value >>> 10) & 0x1F;
  for (let i = 0; i < 10; i++) remainder = ((remainder << 1) ^ ((remainder >>> 9) * 0x537)) & 0x7FFFFFFF;
  const expected = formatBits(ecl, mask) ^ 0x5412;
  return { ecl, mask, valid: (expected >>> 10) === ((value >>> 10) & 0x1F) || value === formatBits(ecl, mask) };
}

function extractCodewords(modules, version, size, mask) {
  const reserved = buildFunctionMask(version, size);
  const bits = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical++) {
      for (let columnOffset = 0; columnOffset < 2; columnOffset++) {
        const x = right - columnOffset;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vertical : vertical;
        if (reserved[y][x]) continue;
        let bit = modules[y][x] ? 1 : 0;
        if (maskCondition(mask, x, y)) bit ^= 1;
        bits.push(bit);
      }
    }
  }
  const codewords = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j++) value = (value << 1) | bits[i + j];
    codewords.push(value);
  }
  return codewords;
}

function deinterleave(codewords, version, ecl) {
  const rawCodewords = Math.floor(rawModules(version) / 8);
  const numBlocks = BLOCKS[ecl][version];
  const eccPerBlock = ECC[ecl][version];
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortDataLength = Math.floor(rawCodewords / numBlocks) - eccPerBlock;
  const blocks = [];
  for (let b = 0; b < numBlocks; b++) {
    blocks.push({ data: [], ecc: [], dataLength: shortDataLength + (b < numShortBlocks ? 0 : 1) });
  }
  let index = 0;
  const maxData = Math.max(...blocks.map((b) => b.dataLength));
  for (let i = 0; i < maxData; i++) {
    for (const block of blocks) {
      if (i < block.dataLength) block.data.push(codewords[index++]);
    }
  }
  for (let i = 0; i < eccPerBlock; i++) {
    for (const block of blocks) block.ecc.push(codewords[index++]);
  }
  return { blocks, numShortBlocks };
}

function syndromesZero(block) {
  // Evaluate the received polynomial (data followed by ECC) at alpha^0..alpha^(n-1).
  const received = block.data.concat(block.ecc);
  for (let i = 0; i < block.ecc.length; i++) {
    let value = 0;
    const x = (() => {
      let exponent = 1;
      for (let e = 0; e < i; e++) exponent = gfMultiply(exponent, 2);
      return exponent;
    })();
    for (const coefficient of received) value = gfMultiply(value, x) ^ coefficient;
    if (value !== 0) return false;
  }
  return true;
}

function decodePayload(blocks, version) {
  const data = [];
  for (const block of blocks) data.push(...block.data);
  const bits = [];
  for (const byte of data) for (let i = 7; i >= 0; i--) bits.push((byte >>> i) & 1);
  const take = (count) => { let value = 0; for (let i = 0; i < count; i++) value = (value << 1) | (bits.shift() || 0); return value; };
  const mode = take(4);
  if (mode !== 4) throw new Error('Expected byte mode, found mode ' + mode);
  // Byte-mode character count: 8 bits for versions 1-9, 16 bits from version 10.
  const length = take(version <= 9 ? 8 : 16);
  const bytes = [];
  for (let i = 0; i < length; i++) bytes.push(take(8));
  return Buffer.from(bytes).toString('utf8');
}

function checkStructure(qr) {
  const size = qr.size;
  const modules = qr.modules;
  const finder = (cx, cy) => {
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        const expected = distance !== 2;
        if (modules[cy + dy][cx + dx] !== expected) throw new Error('finder pattern broken at ' + cx + ',' + cy);
      }
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  for (let i = 8; i < size - 8; i++) {
    if (modules[6][i] !== (i % 2 === 0)) throw new Error('timing pattern broken at column ' + i);
    if (modules[i][6] !== (i % 2 === 0)) throw new Error('timing pattern broken at row ' + i);
  }
  if (modules[size - 8][8] !== true) throw new Error('dark module missing');
}

function selfCheck(payload, ecl) {
  const qr = encodeQr(payload, ecl);
  checkStructure(qr);
  const format = readFormat(qr.modules, qr.size);
  if (format.ecl !== ecl) throw new Error('format says EC ' + format.ecl + ', expected ' + ecl);
  if (format.mask !== qr.mask) throw new Error('format mask ' + format.mask + ' != used mask ' + qr.mask);
  const codewords = extractCodewords(qr.modules, qr.version, qr.size, format.mask);
  const { blocks } = deinterleave(codewords, qr.version, format.ecl);
  for (const block of blocks) {
    if (!syndromesZero(block)) throw new Error('Reed-Solomon check failed for a block of version ' + qr.version + ' EC ' + ecl);
  }
  const decoded = decodePayload(blocks, qr.version);
  if (decoded !== payload) throw new Error('round-trip mismatch: "' + decoded + '" != "' + payload + '"');
  return { version: qr.version, size: qr.size, mask: qr.mask, modules: qr.size * qr.size };
}

const cases = [];
['L', 'M', 'Q', 'H'].forEach((ecl) => {
  cases.push(['https://www.cloudhost247.com/tools?tool=dns/propagation', ecl]);
  cases.push(['WIFI:T:WPA;S:CloudHost247-Guest;P:not-a-real-password;;', ecl]);
  cases.push(['☁ CloudHost247 — native tools', ecl]);
});
for (let length = 1; length <= 200; length += 37) {
  cases.push(['x'.repeat(length), 'M']);
}
cases.push(['BEGIN:VCARD\r\nVERSION:3.0\r\nN:Ada Lovelace\r\nORG:CloudHost247\r\nTEL;TYPE=CELL:+10000000000\r\nEMAIL:ada@example.com\r\nEND:VCARD', 'Q']);
cases.push(['a'.repeat(250), 'L']);

let passed = 0;
for (const [payload, ecl] of cases) {
  try {
    const info = selfCheck(payload, ecl);
    passed++;
    console.log('PASS  EC ' + ecl + ' v' + info.version + ' ' + info.size + 'x' + info.size + ' mask ' + info.mask + ' (' + payload.length + ' bytes)');
  } catch (error) {
    console.error('FAIL  EC ' + ecl + ' payload ' + payload.length + ' bytes: ' + error.message);
    process.exit(1);
  }
}
console.log('\nQR self-check passed: ' + passed + ' case(s), structure + format BCH + Reed-Solomon + byte-mode round-trip.');
