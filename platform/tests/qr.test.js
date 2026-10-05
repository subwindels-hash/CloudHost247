/**
 * QR encoder tests (src/lib/qr.js).
 *
 * The encoder is hand-written, so "it looks like a QR code" is not evidence. Four independent
 * checks stand behind it:
 *
 *   1. `tests/fixtures/qr-reference.json` — 744 matrices from **python-qrcode** 8.2, an unrelated
 *      implementation: every version 1–40 at every EC level, every mask 0–7 at a spread of versions,
 *      the exact-capacity boundary, and a realistic `otpauth://` URI. Any wrong table entry, spacing,
 *      BCH code, interleave order or bit-pack shows up as a hash mismatch.
 *   2. A codeword reader built on `qr.functionPattern` reads the *bits* back out of a finished
 *      matrix and checks them against the ISO data stream, with the Reed–Solomon check symbols
 *      recomputed by a second, independently written GF(256) implementation.
 *   3. A PNG reader that shares no code with the PNG writer (packing, filter and CRC mistakes
 *      cannot cancel themselves out).
 *   4. The auto-mask choice is checked against the published penalty rules, and all eight masks are
 *      shown to carry identical codewords — so the choice cannot affect what a scanner reads.
 *
 * The committed fixtures also carry one segno matrix, because segno pads differently (an extra 0x00
 * pad codeword). That case is asserted explicitly so the difference is documented, not folklore.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

const qr = require('../src/lib/qr');
const { computeCrc32 } = require('../src/lib/crc32');
const { startServer, jsonFetch, register } = require('./helpers');

const FIXTURES = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures/qr-reference.json'), 'utf8'),
);

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

/** Mirrors make_text() in tests/fixtures/generate-qr-fixtures.py exactly. */
function makeText(version, level, length) {
  const base = `cloudhost247-v${version}-${level}-`;
  return base.repeat(Math.ceil(length / base.length)).slice(0, length);
}

const rowsOf = (matrix) => qr.toBitRows(matrix);
const hashRows = (rows) => sha256(rows.join('\n'));

function caseText(entry) {
  return entry.text ?? makeText(entry.version, entry.ecLevel, entry.textLength);
}

// --- check 2: read the bits back, and verify the EC codewords independently -------------------

const MASK_FUNCTIONS = [
  (y, x) => (y + x) % 2 === 0,
  (y) => y % 2 === 0,
  (y, x) => x % 3 === 0,
  (y, x) => (y + x) % 3 === 0,
  (y, x) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (y, x) => ((y * x) % 2) + ((y * x) % 3) === 0,
  (y, x) => (((y * x) % 2) + ((y * x) % 3)) % 2 === 0,
  (y, x) => (((y + x) % 2) + ((y * x) % 3)) % 2 === 0,
];

/** Walks the two-module-wide zigzag, unmasks, and returns the codewords the matrix carries. */
function readCodewords(matrix, mask) {
  const size = matrix.length;
  const fn = qr.functionPattern((size - 17) / 4);
  const masked = MASK_FUNCTIONS[mask];
  const bits = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // the timing column is skipped, and the pair becomes (5, 4)
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (fn[y][x] !== null) continue;
        const cell = matrix[y][x] ? 1 : 0;
        bits.push(masked(y, x) ? cell ^ 1 : cell);
      }
    }
  }
  const codewords = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    codewords.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  }
  return codewords;
}

/** GF(256) and Reed–Solomon, written again from the polynomial definition (not the encoder's). */
const gf = (() => {
  const exp = new Uint8Array(512);
  const log = new Uint8Array(256);
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    exp[i] = x;
    log[x] = i;
    x = (x << 1) ^ (x & 0x80 ? 0x11d : 0);
  }
  for (let i = 255; i < 512; i += 1) exp[i] = exp[i - 255];
  const mul = (a, b) => (a === 0 || b === 0 ? 0 : exp[log[a] + log[b]]);
  const multiply = (a, b) => {
    const out = new Array(a.length + b.length - 1).fill(0);
    for (let i = 0; i < a.length; i += 1) {
      for (let j = 0; j < b.length; j += 1) out[i + j] ^= mul(a[i], b[j]);
    }
    return out;
  };
  return { exp, mul, multiply };
})();

/**
 * The EC codewords, computed independently: the generator polynomial is built by multiplying
 * (x - α^i) for i < degree, and the remainder comes from ordinary polynomial division.
 */
function ecRemainder(data, degree) {
  let generator = [1];
  for (let i = 0; i < degree; i += 1) generator = gf.multiply(generator, [1, gf.exp[i]]);
  assert.strictEqual(generator.length, degree + 1, 'generator degree');
  const divisor = generator.slice(1); // the leading coefficient is 1 and is handled implicitly
  const remainder = new Array(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    for (let i = 0; i < degree; i += 1) remainder[i] ^= gf.mul(divisor[i], factor);
  }
  return remainder;
}

// --- check 3: an independent PNG reader -------------------------------------------------------

function readChunks(buffer) {
  assert.deepStrictEqual(
    buffer.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    'PNG signature',
  );
  const chunks = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    assert.strictEqual(
      buffer.readUInt32BE(offset + 8 + length),
      computeCrc32(buffer.subarray(offset + 4, offset + 8 + length)),
      `CRC of ${type} chunk`,
    );
    chunks.push({ type, data });
    offset += 12 + length;
  }
  assert.strictEqual(chunks.at(-1).type, 'IEND', 'ends with IEND');
  return chunks;
}

/** Decodes the 1-bit greyscale PNG this module writes back to a module matrix. */
function decodePng(buffer, { scale, margin }) {
  const chunks = readChunks(buffer);
  const ihdr = chunks.find((c) => c.type === 'IHDR').data;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  assert.strictEqual(ihdr[8], 1, 'bit depth 1');
  assert.strictEqual(ihdr[9], 0, 'greyscale colour type');

  const raw = zlib.inflateSync(Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  const bytesPerRow = Math.ceil(width / 8);
  assert.strictEqual(raw.length, (bytesPerRow + 1) * height, 'inflated IDAT size');

  const size = (width / scale) - margin * 2;
  assert.ok(Number.isInteger(size), 'image dimension matches scale and margin');
  const matrix = Array.from({ length: size }, () => new Array(size).fill(false));

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (bytesPerRow + 1);
    assert.strictEqual(raw[rowStart], 0, 'every row uses filter type 0');
    for (let x = 0; x < width; x += 1) {
      const dark = ((raw[rowStart + 1 + (x >> 3)] >> (7 - (x & 7))) & 1) === 0; // 0 = black
      const moduleY = Math.floor(y / scale) - margin;
      const moduleX = Math.floor(x / scale) - margin;
      if (moduleY < 0 || moduleX < 0 || moduleY >= size || moduleX >= size) {
        assert.strictEqual(dark, false, 'quiet zone is white');
        continue;
      }
      if (matrix[moduleY][moduleX]) assert.strictEqual(dark, true, 'every pixel of a dark module');
      if (dark) matrix[moduleY][moduleX] = true;
    }
  }
  return matrix;
}

// --- conformance against the independent implementation ---------------------------------------

test('conformance: 744 python-qrcode matrices are reproduced exactly', async (t) => {
  const mismatches = [];

  await t.test('every version, level and mask matches module for module', () => {
    for (const entry of FIXTURES.cases) {
      let encoded;
      try {
        encoded = qr.encode(caseText(entry), {
          ecLevel: entry.ecLevel, mask: entry.requestedMask, minVersion: entry.version,
        });
      } catch (err) {
        mismatches.push(`${entry.version}${entry.ecLevel} mask=${entry.mask}: threw ${err.message}`);
        continue;
      }
      if (encoded.version !== entry.version) {
        mismatches.push(`${entry.version}${entry.ecLevel}: version ${encoded.version}`);
        continue;
      }
      if (hashRows(rowsOf(encoded.matrix)) !== entry.sha256) {
        mismatches.push(`${entry.version}${entry.ecLevel} mask=${entry.mask}: matrix differs`);
      }
    }
    assert.deepStrictEqual(mismatches, [], `${mismatches.length} of ${FIXTURES.cases.length} matrices differ`);
    assert.strictEqual(FIXTURES.cases.length, 744);
    assert.strictEqual(new Set(FIXTURES.cases.map((c) => c.version)).size, 40, 'all 40 versions');
    assert.strictEqual(new Set(FIXTURES.cases.map((c) => c.mask)).size, 8, 'all 8 masks');
  });

  await t.test('version selection is the encoder\'s own, for payloads that only fit that version', () => {
    const forced = FIXTURES.cases.filter((c) => c.forcesVersion);
    assert.ok(forced.length >= 200, `plenty of boundary cases, got ${forced.length}`);
    const wrong = [];
    for (const entry of forced) {
      const encoded = qr.encode(caseText(entry), { ecLevel: entry.ecLevel, mask: entry.requestedMask });
      if (encoded.version !== entry.version || hashRows(rowsOf(encoded.matrix)) !== entry.sha256) {
        wrong.push(`${entry.version}${entry.ecLevel}: chose ${encoded.version}`);
      }
    }
    assert.deepStrictEqual(wrong, [], 'a full-capacity payload must select exactly its version');
  });

  await t.test('the full reference matrices compare row for row', () => {
    const full = FIXTURES.cases.filter((c) => Array.isArray(c.rows));
    assert.ok(full.length >= 40, `fixtures include full matrices (${full.length})`);
    for (const entry of full) {
      const encoded = qr.encode(caseText(entry), {
        ecLevel: entry.ecLevel, mask: entry.requestedMask, minVersion: entry.version,
      });
      assert.deepStrictEqual(rowsOf(encoded.matrix), entry.rows, `${entry.version}${entry.ecLevel}`);
    }
  });
});

test('conformance: the bits in a finished matrix are the ISO data stream', async (t) => {
  // Version 1 level L is a single block of 19 data + 7 error-correction codewords, so the stream can
  // be checked end to end without carrying the block tables into the test.
  const payload = makeText(1, 'L', 8); // 'cloudhos'
  const { matrix, mask } = qr.encode(payload, { ecLevel: 'L', mask: 0 });

  await t.test('mode, length, payload, terminator and pad codewords are exactly right', () => {
    const codewords = readCodewords(matrix, mask);
    assert.strictEqual(codewords.length, 26, '26 codewords at version 1-L');

    const bits = [];
    for (const byte of codewords.slice(0, 19)) {
      for (let i = 7; i >= 0; i -= 1) bits.push((byte >> i) & 1);
    }
    const asInts = (from, length) => parseInt(bits.slice(from, from + length).join(''), 2);
    assert.strictEqual(asInts(0, 4), 0b0100, 'byte-mode indicator');
    assert.strictEqual(asInts(4, 8), payload.length, 'character count');
    const data = Buffer.from(bits.slice(12, 12 + payload.length * 8).join('').match(/.{8}/g)
      .map((b) => parseInt(b, 2)));
    assert.strictEqual(data.toString('utf8'), payload, 'payload bytes');
    assert.deepStrictEqual(bits.slice(12 + payload.length * 8, 16 + payload.length * 8), [0, 0, 0, 0], 'terminator');

    // 12 + 64 + 4 = 80 bits = 10 codewords; the rest are the alternating pad codewords.
    const pads = codewords.slice(10, 19);
    assert.strictEqual(pads.length, 9);
    assert.deepStrictEqual(pads, [0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec],
      'pads alternate 0xEC/0x11 starting with 0xEC, with no extra byte');
  });

  await t.test('the seven error-correction codewords are the Reed-Solomon remainder', () => {
    const codewords = readCodewords(matrix, mask);
    const expected = ecRemainder(codewords.slice(0, 19), 7);
    assert.deepStrictEqual(codewords.slice(19), expected);
  });

  await t.test('all eight masks carry byte-identical codewords', () => {
    const reference = readCodewords(matrix, mask);
    for (let m = 0; m < 8; m += 1) {
      const { matrix: masked } = qr.encode(payload, { ecLevel: 'L', mask: m });
      assert.deepStrictEqual(readCodewords(masked, m), reference, `mask ${m}`);
    }
  });

  await t.test('segno\'s extra pad codeword is a known deviation, not an accident', () => {
    const deviation = FIXTURES.segno_padding_deviation;
    assert.ok(deviation, 'fixtures keep one segno matrix');
    const segno = deviation.rows.map((row) => row.split('').map(Number));
    assert.deepStrictEqual(readCodewords(segno, deviation.mask).slice(0, 10), readCodewords(matrix, mask).slice(0, 10),
      'both agree on the data');
    const mine = readCodewords(matrix, mask);
    const theirs = readCodewords(segno, deviation.mask);
    assert.strictEqual(mine[10], 0xec, 'ISO: padding starts with 0xEC');
    assert.strictEqual(theirs[10], 0x00, 'segno inserts an extra zero codeword first');
    assert.deepStrictEqual(theirs.slice(11, 19), mine.slice(10, 18), 'before the EC codewords shift');
  });
});

test('conformance: the penalty score agrees with an independent implementation', async (t) => {
  await t.test('every scored matrix matches the reference implementation exactly', () => {
    const checks = FIXTURES.scoreChecks;
    assert.ok(checks.length >= 32, 'the fixtures carry reference scores');
    assert.match(FIXTURES.score_reference, /^segno /);
    const wrong = [];
    for (const check of checks) {
      const text = makeText(check.version, check.ecLevel, check.textLength);
      const { matrix } = qr.encode(text, {
        ecLevel: check.ecLevel, mask: check.mask, minVersion: check.version,
      });
      // `n1`–`n4` are the four ISO penalty components; the reference score is their sum, so an
      // implementation that got one rule right and another wrong cannot pass by coincidence.
      const total = qr.penaltyScore(matrix);
      if (total !== check.total) {
        wrong.push(`${check.version}${check.ecLevel} mask${check.mask}: ${total} != ${check.total} `
          + `(reference components ${check.n1}/${check.n2}/${check.n3}/${check.n4})`);
      }
    }
    assert.deepStrictEqual(wrong, []);
  });
});

test('unit: the matrix is a clean boolean grid', async (t) => {
  await t.test('every cell is a boolean, so comparisons cannot be type-confused', () => {
    for (const [text, ecLevel] of [['A', 'L'], [makeText(2, 'H', 14), 'H'], [makeText(7, 'M', 120), 'M']]) {
      const { matrix } = qr.encode(text, { ecLevel });
      const kinds = new Set();
      for (const row of matrix) for (const cell of row) kinds.add(typeof cell);
      assert.deepStrictEqual([...kinds], ['boolean'], `matrix for ${text.slice(0, 8)}… must be all booleans`);
      assert.strictEqual(matrix.length, matrix[0].length, 'square');
    }
  });
});

test('unit: the automatic mask choice follows the ISO penalty rules', async (t) => {
  await t.test('the chosen mask really minimises the score, ties going to the lowest index', () => {
    for (const [text, ecLevel] of [['A', 'L'], [makeText(4, 'Q', 30), 'Q'], [makeText(9, 'H', 60), 'H']]) {
      const chosen = qr.encode(text, { ecLevel }).mask;
      const scores = [];
      for (let m = 0; m < 8; m += 1) scores.push(qr.penaltyScore(qr.encode(text, { ecLevel, mask: m }).matrix));
      const best = Math.min(...scores);
      assert.strictEqual(scores[chosen], best, `mask ${chosen} is minimal`);
      assert.strictEqual(scores.indexOf(best), chosen, 'ties resolve to the lowest mask index');
    }
  });

  await t.test('each penalty rule is right in isolation, per the reference implementation', () => {
    // Synthetic matrices that isolate one rule at a time: an all-light symbol (runs + balance), a
    // lone dark module, two adjacent dark modules (the 2x2 rule), and the 1:1:3:1:1 finder pattern
    // with and without the surrounding light area. Values come from the reference scorer, rule by
    // rule — so a single wrong rule cannot hide inside a plausible-looking total.
    assert.ok(FIXTURES.scoreExamples.length >= 5, 'component fixtures are present');
    for (const example of FIXTURES.scoreExamples) {
      const matrix = example.rows.map((row) => row.split('').map((c) => c === '1'));
      assert.strictEqual(qr.penaltyScore(matrix), example.total,
        `${example.name}: expected ${example.n1}/${example.n2}/${example.n3}/${example.n4}`);
      assert.strictEqual(example.total, example.n1 + example.n2 + example.n3 + example.n4,
        `${example.name}: reference components add up`);
    }
  });
});

test('unit: fixed patterns, capacities and BCH codes', async (t) => {
  await t.test('finder, timing and dark module are where the spec puts them', () => {
    const { matrix } = qr.encode('A');
    const size = matrix.length;
    for (const [ox, oy] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
      for (let y = 0; y < 7; y += 1) {
        for (let x = 0; x < 7; x += 1) {
          const ring = Math.max(Math.abs(x - 3), Math.abs(y - 3));
          assert.strictEqual(matrix[oy + y][ox + x], ring !== 2, `finder pixel ${x},${y}`);
        }
      }
    }
    for (let i = 8; i < size - 8; i += 1) {
      assert.strictEqual(matrix[6][i], i % 2 === 0, `timing row at ${i}`);
      assert.strictEqual(matrix[i][6], i % 2 === 0, `timing column at ${i}`);
    }
    assert.strictEqual(matrix[size - 8][8], true, 'dark module');
  });

  await t.test('alignment patterns are placed where the spec says', () => {
    assert.deepStrictEqual(qr.alignmentPositions(1), []);
    assert.deepStrictEqual(qr.alignmentPositions(2), [6, 18]);
    assert.deepStrictEqual(qr.alignmentPositions(7), [6, 22, 38]);
    assert.deepStrictEqual(qr.alignmentPositions(32), [6, 34, 60, 86, 112, 138]);
    assert.deepStrictEqual(qr.alignmentPositions(40), [6, 30, 58, 86, 114, 142, 170]);

    const { matrix, version } = qr.encode(makeText(7, 'H', 60), { ecLevel: 'H', minVersion: 7 });
    assert.strictEqual(version, 7, 'the fixture for this check is a version 7 symbol');
    const size = matrix.length;
    for (const cy of qr.alignmentPositions(7)) {
      for (const cx of qr.alignmentPositions(7)) {
        if ((cx <= 8 && cy <= 8) || (cx >= size - 9 && cy <= 8) || (cx <= 8 && cy >= size - 9)) continue;
        assert.strictEqual(matrix[cy][cx], true, `alignment centre ${cx},${cy}`);
        assert.strictEqual(matrix[cy - 1][cx], false, `alignment ring ${cx},${cy}`);
      }
    }
  });

  await t.test('byte capacity matches the published table, and one byte more needs a bigger version', () => {
    const expected = {
      '1L': 17, '1M': 14, '1Q': 11, '1H': 7,
      '2L': 32, '2M': 26, '2Q': 20, '2H': 14,
      '5L': 106, '5M': 84, '5Q': 60, '5H': 44,
      '10L': 271, '10M': 213, '10Q': 151, '10H': 119,
      '40L': 2953, '40M': 2331, '40Q': 1663, '40H': 1273,
    };
    for (const [key, bytes] of Object.entries(expected)) {
      const version = Number(key.slice(0, -1));
      const level = key.slice(-1);
      assert.strictEqual(qr.byteCapacity(version, level), bytes, `${key} capacity`);
      const atLimit = qr.encode(makeText(version, level, bytes), { ecLevel: level, minVersion: version });
      assert.strictEqual(atLimit.version, version, `${key}: the limit still fits`);
      if (version === 40) {
        assert.throws(() => qr.encode(makeText(40, level, bytes + 1), { ecLevel: level, minVersion: 40 }),
          /does not fit/, `${key}: nothing fits beyond version 40`);
      } else {
        const overLimit = qr.encode(makeText(version, level, bytes + 1), { ecLevel: level, minVersion: version });
        assert.strictEqual(overLimit.version, version + 1, `${key}: one byte more does not fit`);
      }
    }
  });

  await t.test('format information is a valid BCH(15,5) code and decodes back', () => {
    for (const level of ['L', 'M', 'Q', 'H']) {
      for (let mask = 0; mask < 8; mask += 1) {
        const bits = qr.formatInfoBits(level, mask) ^ 0x5412;
        const data = bits >>> 10;
        assert.strictEqual(data >>> 3, { L: 1, M: 0, Q: 3, H: 2 }[level], `level bits for ${level}`);
        assert.strictEqual(data & 7, mask, `mask bits for ${level}/${mask}`);
        let remainder = bits;
        for (let i = 14; i >= 10; i -= 1) if ((remainder >>> i) & 1) remainder ^= 0x537 << (i - 10);
        assert.strictEqual(remainder, 0, `BCH remainder for ${level}/${mask}`);
      }
    }
  });

  await t.test('version information is a valid BCH(18,6) code for versions 7 and up', () => {
    for (const version of [7, 12, 25, 40]) {
      const bits = qr.versionInfoBits(version);
      assert.strictEqual(bits >>> 12, version);
      let remainder = bits;
      for (let i = 17; i >= 12; i -= 1) if ((remainder >>> i) & 1) remainder ^= 0x1f25 << (i - 12);
      assert.strictEqual(remainder, 0, `remainder for version ${version}`);
    }
  });

  await t.test('the encoder refuses what it cannot encode', () => {
    assert.throws(() => qr.encode(''), /non-empty/);
    assert.throws(() => qr.encode(null), /non-empty/);
    assert.throws(() => qr.encode('A', { ecLevel: 'X' }), /Error correction level/);
    assert.throws(() => qr.encode('A', { mask: 8 }), /Mask/);
    assert.throws(() => qr.encode('A', { mask: -1 }), /Mask/);
    assert.throws(() => qr.encode('A'.repeat(3000), { ecLevel: 'H' }), /does not fit/);
  });
});

test('unit: image output', async (t) => {
  const { matrix, size } = qr.encode('otpauth://totp/CloudHost247:test?secret=JBSWY3DPEHPK3PXP&issuer=CloudHost247');

  await t.test('PNG decodes back to the same matrix, with a white quiet zone', () => {
    const png = qr.toPngBuffer(matrix, { scale: 3, margin: 4 });
    const decoded = decodePng(png, { scale: 3, margin: 4 });
    assert.strictEqual(decoded.length, size);
    assert.deepStrictEqual(rowsOf(decoded), rowsOf(matrix));
    assert.deepStrictEqual(readChunks(png).map((c) => c.type), ['IHDR', 'IDAT', 'IEND']);
  });

  await t.test('scale changes the pixel size, not the matrix', () => {
    for (const scale of [1, 5, 10]) {
      const decoded = decodePng(qr.toPngBuffer(matrix, { scale, margin: 2 }), { scale, margin: 2 });
      assert.deepStrictEqual(rowsOf(decoded), rowsOf(matrix), `scale ${scale}`);
    }
    assert.ok(qr.toPngBuffer(matrix, { scale: 1, margin: 4 }).length
      < qr.toPngBuffer(matrix, { scale: 8, margin: 4 }).length, 'a bigger image takes more bytes');
    assert.throws(() => qr.toPngBuffer(matrix, { scale: 0 }), /positive integer/);
  });

  await t.test('a margin of 0 is still a legal image', () => {
    const decoded = decodePng(qr.toPngBuffer(matrix, { scale: 2, margin: 0 }), { scale: 2, margin: 0 });
    assert.deepStrictEqual(rowsOf(decoded), rowsOf(matrix));
  });

  await t.test('the data URI is a PNG and matches the buffer', () => {
    const uri = qr.toPngDataUri(matrix, { scale: 2, margin: 4 });
    assert.match(uri, /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/);
    assert.deepStrictEqual(Buffer.from(uri.split(',')[1], 'base64'), qr.toPngBuffer(matrix, { scale: 2, margin: 4 }));
  });

  await t.test('SVG draws one rect per dark module and no more', () => {
    const svg = qr.toSvg(matrix, { scale: 4, margin: 4 });
    const dark = matrix.flat().filter(Boolean).length;
    assert.strictEqual((svg.match(/<rect /g) ?? []).length, dark + 1, 'dark modules plus the background');
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.ok(svg.endsWith('</svg>'));
    const dimension = (size + 8) * 4;
    assert.ok(svg.includes(`width="${dimension}" height="${dimension}"`));
  });
});

// --- the feature the encoder exists for --------------------------------------------------------

test('integration: TOTP enrolment hands back a QR that encodes the same URI', async (t) => {
  const { base, close } = await startServer({});
  try {
    const registration = await register(base, 'qr-enrolment@example.com');
    const token = registration.data.accessToken;

    const res = await jsonFetch(base, {
      path: '/api/v1/auth/mfa/totp/enroll', method: 'POST', body: {},
    }, token);
    assert.strictEqual(res.status, 200, JSON.stringify(res.data));

    await t.test('the response keeps the old fields and adds a PNG data URI', () => {
      assert.ok(res.data.otpauthUri?.startsWith('otpauth://totp/'), 'URI unchanged for existing clients');
      assert.ok(res.data.secret, 'secret still returned as text');
      assert.ok(res.data.qrPngDataUri?.startsWith('data:image/png;base64,'), 'PNG data URI added');
      const bytes = Buffer.from(res.data.qrPngDataUri.split(',')[1], 'base64').length;
      assert.ok(bytes < 4096, `the image stays small (${bytes} bytes)`);
      assert.equal(res.data.qrSvg, undefined, 'no vector copy: clients cannot use 50 kB of SVG usefully');
      assert.ok(JSON.stringify(res.data).length < 4096, 'the whole response is a single small JSON object');
    });

    await t.test('the image is exactly the encoding of the URI', () => {
      const png = Buffer.from(res.data.qrPngDataUri.split(',')[1], 'base64');
      const decoded = decodePng(png, { scale: 4, margin: 4 });
      const encoded = qr.encode(res.data.otpauthUri, { ecLevel: 'M' });
      assert.deepStrictEqual(rowsOf(decoded), rowsOf(encoded.matrix));
      assert.ok(decoded.length >= 21, 'a real QR, not a placeholder');
    });

    await t.test('the URI a client scans carries the secret the server stored', () => {
      const url = new URL(res.data.otpauthUri);
      assert.strictEqual(url.searchParams.get('secret'), res.data.secret);
      assert.strictEqual(url.searchParams.get('issuer'), 'CloudHost247');
      assert.strictEqual(url.searchParams.get('digits'), '6');
      assert.strictEqual(url.searchParams.get('period'), '30');
    });

    await t.test('an unauthenticated caller cannot get enrolment material', async () => {
      const unauth = await jsonFetch(base, { path: '/api/v1/auth/mfa/totp/enroll', method: 'POST', body: {} });
      assert.strictEqual(unauth.status, 401);
    });
  } finally {
    await close();
  }
});
