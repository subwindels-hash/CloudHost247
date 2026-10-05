/**
 * QR Code encoder (ISO/IEC 18004) — byte mode, versions 1–40, EC levels L/M/Q/H.
 *
 * Written here rather than pulled in as a dependency for the same reason the rest of this platform
 * is dependency-free: it runs on cPanel shared hosting with no build step. `qrcode`/`qrcode-generator`
 * would add a transitive tree for a feature that is 400 lines of tables and GF(256) arithmetic.
 *
 * Scope, stated so callers do not assume more:
 *   - **byte mode only.** Numeric/alphanumeric/kanji compaction is not implemented; an 8-bit
 *     character count is used for versions 1–9 and 16 bits for 10–40. Text is encoded as UTF-8
 *     bytes with no ECI segment, which is what authenticator apps expect for `otpauth://` URIs.
 *   - **all 40 versions, all four error-correction levels**, with automatic version selection and
 *     automatic mask selection by the ISO penalty rules (a mask can also be forced, which the tests
 *     use to check encoding independently of mask scoring).
 *   - PNG output is 1-bit greyscale (colour type 0) — the smallest correct encoding of a two-colour
 *     image — rather than the RGBA writer used for app icons in `scripts/generate-icons.js`.
 *
 * Correctness is pinned by `tests/qr.test.js` against 744 matrices produced by **python-qrcode**
 * (an independent implementation) covering every version at every EC level, every mask 0–7 at a
 * spread of versions, the exact-capacity boundary and the `otpauth://` payload this exists for —
 * see `tests/fixtures/qr-reference.json`.
 *
 * Two deliberate positions worth knowing:
 *   - **Padding follows ISO 7.4.10 literally** (terminator, then pad to the byte boundary *only when
 *     needed*, then alternate 0xEC/0x11). segno 1.6.6 emits an extra 0x00 pad codeword when the
 *     stream is already aligned; that still scans, but the fixtures pin the difference rather than
 *     pretend the two agree.
 *   - **Mask choice is not normative.** Every mask is legal and implementations disagree
 *     (python-qrcode scores with a light border included; this file and segno score the bare
 *     matrix). The rules implemented here are the ISO penalty rules; the tests check that the
 *     chosen mask minimises them, and that all eight masks carry identical codewords.
 */

'use strict';

const zlib = require('node:zlib');
const { computeCrc32 } = require('./crc32');

const EC_LEVELS = ['L', 'M', 'Q', 'H'];

// Format-info bits per level (ISO/IEC 18004 table 25). Note this is not the array order above.
const EC_FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };

// Table 13/14: error-correction codewords per block, indexed [level][version - 1].
const ECC_CODEWORDS_PER_BLOCK = {
  L: [
    7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28,
    28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
  M: [
    10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26,
    26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
  ],
  Q: [
    13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30,
    28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
  H: [
    17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28,
    30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
};

// Table 13/14: number of error-correction blocks, indexed [level][version - 1].
const NUM_EC_BLOCKS = {
  L: [
    1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8,
    8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25,
  ],
  M: [
    1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16,
    17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
  ],
  Q: [
    1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20,
    23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68,
  ],
  H: [
    1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25,
    25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81,
  ],
};

const PENALTY_RUN = 3;
const PENALTY_BLOCK = 3;
const PENALTY_FINDER = 40;
const PENALTY_BALANCE = 10;

const MODE_BYTE = 0b0100;

// --- GF(256) arithmetic, primitive polynomial 0x11D (x^8 + x^4 + x^3 + x^2 + 1) -------------

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255];
}

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

/** Reed–Solomon generator polynomial of the given degree, highest power first. */
function rsGenerator(degree) {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < degree; j += 1) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

/** Remainder of `data` divided by `divisor` — the error-correction codewords. */
function rsRemainder(data, divisor) {
  const result = new Uint8Array(divisor.length);
  for (const byte of data) {
    const factor = byte ^ result[0];
    result.copyWithin(0, 1);
    result[result.length - 1] = 0;
    for (let i = 0; i < divisor.length; i += 1) result[i] ^= gfMul(divisor[i], factor);
  }
  return result;
}

// --- geometry -------------------------------------------------------------------------------

/** Alignment pattern centre coordinates for a version (empty for version 1). */
function alignmentPositions(version) {
  if (version === 1) return [];
  const size = version * 4 + 17;
  const numAlign = Math.floor(version / 7) + 2;
  const step = version === 32
    ? 26
    : Math.floor((version * 4 + numAlign * 2 + 1) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

/**
 * Function-pattern map for a version: `null` where a data module may go, otherwise the fixed value.
 * Building the map first (instead of counting modules with a formula) keeps capacity, placement and
 * rendering derived from the same geometry, so they cannot disagree.
 */
function functionPattern(version) {
  const size = version * 4 + 17;
  const map = Array.from({ length: size }, () => new Array(size).fill(null));
  const set = (x, y, value) => { map[y][x] = value; };

  // Finder patterns + separators, plus the format-information reservations around them.
  for (const [fx, fy] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
    for (let dy = -1; dy <= 7; dy += 1) {
      for (let dx = -1; dx <= 7; dx += 1) {
        const x = fx + dx;
        const y = fy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const inFinder = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
        const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
        set(x, y, inFinder ? (ring !== 2 ? 1 : 0) : 0);
      }
    }
  }

  // Timing patterns.
  for (let i = 8; i < size - 8; i += 1) {
    if (map[6][i] === null) set(i, 6, i % 2 === 0 ? 1 : 0);
    if (map[i][6] === null) set(6, i, i % 2 === 0 ? 1 : 0);
  }

  // Alignment patterns (never overlapping a finder).
  for (const cy of alignmentPositions(version)) {
    for (const cx of alignmentPositions(version)) {
      const overlapsFinder = (cx <= 8 && cy <= 8) || (cx >= size - 9 && cy <= 8) || (cx <= 8 && cy >= size - 9);
      if (overlapsFinder) continue;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1 ? 1 : 0);
        }
      }
    }
  }

  // Format information: reserved now (the real bits are written by drawFormatInfo), so data skips
  // them. Copy 1 wraps the top-left finder, copy 2 is split between the other two finders.
  for (let i = 0; i <= 5; i += 1) if (map[i][8] === null) set(8, i, 0);
  for (const [row, col] of [[7, 8], [8, 8], [8, 7]]) {
    if (map[row][col] === null) set(col, row, 0);
  }
  for (let i = 0; i <= 5; i += 1) if (map[8][i] === null) set(i, 8, 0);
  for (let i = 0; i < 8; i += 1) if (map[8][size - 1 - i] === null) set(size - 1 - i, 8, 0);
  for (let row = size - 7; row <= size - 1; row += 1) if (map[row][8] === null) set(8, row, 0);

  // The dark module.
  set(8, size - 8, 1);

  // Version information (versions 7 and up).
  if (version >= 7) {
    for (let i = 0; i < 18; i += 1) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      if (map[b][a] === null) set(a, b, 0);
      if (map[a][b] === null) set(b, a, 0);
    }
  }

  return map;
}

/** Number of data modules (hence codewords) available in a version. */
function rawDataModules(version) {
  const map = functionPattern(version);
  let count = 0;
  for (const row of map) for (const cell of row) if (cell === null) count += 1;
  return count;
}

function dataCapacityCodewords(version) {
  return Math.floor(rawDataModules(version) / 8);
}

function remainderBits(version) {
  return rawDataModules(version) % 8;
}

// --- bit stream -----------------------------------------------------------------------------

function charCountBits(version) {
  return version <= 9 ? 8 : 16;
}

/** Maximum byte-mode payload length for a version/level, header included. */
function byteCapacity(version, ecLevel) {
  const level = normaliseEcLevel(ecLevel);
  const dataBits = (dataCapacityCodewords(version)
    - ECC_CODEWORDS_PER_BLOCK[level][version - 1] * NUM_EC_BLOCKS[level][version - 1]) * 8;
  return Math.floor((dataBits - 4 - charCountBits(version)) / 8);
}

function appendBits(bits, value, length) {
  for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
}

/** Mode + length + payload + terminator + padding, as data codewords. */
function buildDataCodewords(bytes, version, ecLevel) {
  const capacity = dataCapacityCodewords(version)
    - ECC_CODEWORDS_PER_BLOCK[ecLevel][version - 1] * NUM_EC_BLOCKS[ecLevel][version - 1];
  const bits = [];
  appendBits(bits, MODE_BYTE, 4);
  appendBits(bits, bytes.length, charCountBits(version));
  for (const byte of bytes) appendBits(bits, byte, 8);

  if (bits.length > capacity * 8) {
    throw new Error(`Payload does not fit version ${version} at level ${ecLevel}`);
  }

  // Terminator: up to four zero bits, then pad to a byte boundary.
  appendBits(bits, 0, Math.min(4, capacity * 8 - bits.length));
  appendBits(bits, 0, (8 - (bits.length % 8)) % 8);

  const codewords = new Uint8Array(capacity);
  for (let i = 0; i < bits.length; i += 1) codewords[i >> 3] |= bits[i] << (7 - (i & 7));

  // Pad codewords 0xEC / 0x11 alternating, as the spec requires.
  for (let i = Math.ceil(bits.length / 8), pad = 0; i < capacity; i += 1, pad += 1) {
    codewords[i] = pad % 2 === 0 ? 0xec : 0x11;
  }
  return codewords;
}

/** Splits into blocks, appends Reed–Solomon codewords, and interleaves both sequences. */
function addErrorCorrectionAndInterleave(data, version, ecLevel) {
  const numBlocks = NUM_EC_BLOCKS[ecLevel][version - 1];
  const eccLen = ECC_CODEWORDS_PER_BLOCK[ecLevel][version - 1];
  const rawCodewords = dataCapacityCodewords(version);

  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const divisor = rsGenerator(eccLen);

  const blocks = [];
  let offset = 0;
  for (let i = 0; i < numBlocks; i += 1) {
    const dataLen = shortBlockLen - eccLen + (i < numShortBlocks ? 0 : 1);
    const blockData = data.subarray(offset, offset + dataLen);
    offset += dataLen;
    blocks.push({ data: blockData, ecc: rsRemainder(blockData, divisor) });
  }
  if (offset !== data.length) {
    throw new Error(`Block split consumed ${offset} of ${data.length} data codewords`);
  }

  const result = new Uint8Array(rawCodewords);
  let k = 0;
  const maxDataLen = shortBlockLen - eccLen + 1;
  for (let i = 0; i < maxDataLen; i += 1) {
    for (const block of blocks) {
      if (i < block.data.length) result[k++] = block.data[i];
    }
  }
  for (let i = 0; i < eccLen; i += 1) {
    for (const block of blocks) result[k++] = block.ecc[i];
  }
  if (k !== result.length) throw new Error(`Interleaving wrote ${k} of ${result.length} codewords`);
  return result;
}

// --- matrix ---------------------------------------------------------------------------------

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

function formatInfoBits(ecLevel, mask) {
  const data = (EC_FORMAT_BITS[ecLevel] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function versionInfoBits(version) {
  let rem = version;
  for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

/** Writes the data codewords into the matrix in the spec's two-column zigzag order. */
function placeCodewords(matrix, functionMap, codewords) {
  const size = matrix.length;
  let i = 0; // bit index into codewords
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // the timing column is skipped entirely
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (functionMap[y][x] !== null || i >= codewords.length * 8) continue;
        matrix[y][x] = ((codewords[i >> 3] >>> (7 - (i & 7))) & 1) === 1;
        i += 1;
        // Remaining modules (if any) stay light — they are the spec's remainder bits.
      }
    }
  }
}

/**
 * Writes both copies of the 15 format bits (ISO/IEC 18004 §7.9.1). Bit 0 is the least significant
 * bit of `formatInfoBits`; the two copies interleave so a damaged finder still leaves one readable.
 */
function drawFormatInfo(matrix, ecLevel, mask) {
  const size = matrix.length;
  const bits = formatInfoBits(ecLevel, mask);
  const bit = (i) => ((bits >>> i) & 1) === 1;

  // Copy 1: column 8 above the top-left finder, then row 8 to its left.
  for (let i = 0; i <= 5; i += 1) matrix[i][8] = bit(i);
  matrix[7][8] = bit(6);
  matrix[8][8] = bit(7);
  matrix[8][7] = bit(8);
  for (let i = 9; i < 15; i += 1) matrix[8][14 - i] = bit(i);

  // Copy 2: row 8 under the top-right finder, then column 8 beside the bottom-left finder.
  for (let i = 0; i < 8; i += 1) matrix[8][size - 1 - i] = bit(i);
  for (let i = 8; i < 15; i += 1) matrix[size - 15 + i][8] = bit(i);

  matrix[size - 8][8] = true; // the dark module
}

function drawVersionInfo(matrix, version) {
  if (version < 7) return;
  const size = matrix.length;
  const bits = versionInfoBits(version);
  for (let i = 0; i < 18; i += 1) {
    const bit = ((bits >>> i) & 1) === 1;
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    matrix[b][a] = bit;
    matrix[a][b] = bit;
  }
}

function applyMask(matrix, functionMap, mask) {
  const size = matrix.length;
  const fn = MASK_FUNCTIONS[mask];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (functionMap[y][x] === null && fn(y, x)) matrix[y][x] = !matrix[y][x];
    }
  }
}

/** First index at or after `from` where `pattern` appears, or -1. */
function findPattern(line, pattern, from) {
  outer:
  for (let i = Math.max(0, from); i + pattern.length <= line.length; i += 1) {
    for (let j = 0; j < pattern.length; j += 1) {
      if (line[i + j] !== pattern[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function penaltyScore(matrix) {
  const size = matrix.length;
  let score = 0;

  // Rule 1: runs of five or more same-coloured modules in a row or column.
  const scoreLine = (get) => {
    let runColor = get(0);
    let runLength = 1;
    for (let i = 1; i < size; i += 1) {
      const color = get(i);
      if (color === runColor) {
        runLength += 1;
      } else {
        if (runLength >= 5) score += PENALTY_RUN + (runLength - 5);
        runColor = color;
        runLength = 1;
      }
    }
    if (runLength >= 5) score += PENALTY_RUN + (runLength - 5);
  };
  for (let y = 0; y < size; y += 1) scoreLine((x) => matrix[y][x]);
  for (let x = 0; x < size; x += 1) scoreLine((y) => matrix[y][x]);

  // Rule 2: 2x2 blocks of one colour.
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const c = matrix[y][x];
      if (c === matrix[y][x + 1] && c === matrix[y + 1][x] && c === matrix[y + 1][x + 1]) {
        score += PENALTY_BLOCK;
      }
    }
  }

  // Rule 3: occurrences of the 1:1:3:1:1 finder-like pattern with a four-module light area on one
  // side. Each occurrence scores once even when both sides are light (the reading used by the
  // reference implementation this encoder is verified against; ISO leaves that ambiguous, and the
  // choice cannot affect decodability — every mask is legal).
  const FINDER = [true, false, true, true, true, false, true]; // the 1:1:3:1:1 core
  const countFinderPatterns = (line) => {
    let found = 0;
    let index = findPattern(line, FINDER, 0);
    while (index !== -1) {
      let next = index + FINDER.length;
      // A pattern flush against the symbol edge counts as bounded by a light area.
      const lightBefore = line.slice(Math.max(index - 4, 0), index).every((cell) => !cell);
      const lightAfter = line.slice(next, next + 4).every((cell) => !cell);
      if (index === 0 || index === line.length - FINDER.length || lightBefore || lightAfter) {
        found += PENALTY_FINDER;
      } else {
        next = index + 4; // no light area: resume inside the pattern, as the reference does
      }
      index = findPattern(line, FINDER, next);
    }
    return found;
  };
  for (let y = 0; y < size; y += 1) score += countFinderPatterns(matrix[y]);
  for (let x = 0; x < size; x += 1) score += countFinderPatterns(matrix.map((row) => row[x]));

  // Rule 4: deviation of the dark-module proportion from 50%, in 5% steps.
  let dark = 0;
  for (const row of matrix) for (const cell of row) if (cell) dark += 1;
  const total = size * size;
  const k = Math.floor(Math.abs(20 * dark - 10 * total) / total);
  score += k * PENALTY_BALANCE;

  return score;
}

// --- public API -----------------------------------------------------------------------------

function normaliseEcLevel(ecLevel) {
  const level = String(ecLevel ?? 'M').toUpperCase();
  if (!EC_LEVELS.includes(level)) {
    throw new Error(`Error correction level must be one of ${EC_LEVELS.join(', ')}`);
  }
  return level;
}

/**
 * Encode text as a QR code.
 *
 * @param {string} text
 * @param {{ecLevel?: 'L'|'M'|'Q'|'H', mask?: number|null, minVersion?: number}} [options]
 * @returns {{version: number, size: number, ecLevel: string, mask: number, matrix: boolean[][]}}
 */
function encode(text, options = {}) {
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('QR payload must be a non-empty string');
  }
  const ecLevel = normaliseEcLevel(options.ecLevel);
  const bytes = Buffer.from(text, 'utf8');

  const minVersion = Math.max(1, Math.min(40, options.minVersion ?? 1));
  let version = null;
  for (let v = minVersion; v <= 40; v += 1) {
    if (bytes.length <= byteCapacity(v, ecLevel)) { version = v; break; }
  }
  if (version === null) {
    throw new Error(`Payload of ${bytes.length} bytes does not fit any version at level ${ecLevel}`);
  }

  const codewords = addErrorCorrectionAndInterleave(
    buildDataCodewords(bytes, version, ecLevel), version, ecLevel,
  );

  const size = version * 4 + 17;
  const functionMap = functionPattern(version);

  const build = (mask) => {
    const matrix = functionMap.map((row) => row.map((cell) => cell === 1));
    placeCodewords(matrix, functionMap, codewords);
    applyMask(matrix, functionMap, mask);
    drawFormatInfo(matrix, ecLevel, mask);
    drawVersionInfo(matrix, version);
    return matrix;
  };

  let mask = options.mask;
  if (mask === null || mask === undefined) {
    let best = 0;
    let bestScore = Infinity;
    for (let m = 0; m < 8; m += 1) {
      const score = penaltyScore(build(m));
      if (score < bestScore) { bestScore = score; best = m; }
    }
    mask = best;
  } else if (!Number.isInteger(mask) || mask < 0 || mask > 7) {
    throw new Error('Mask must be an integer between 0 and 7');
  }

  return { version, size, ecLevel, mask, matrix: build(mask) };
}

/** Rows of '1'/'0' — the serialisation the reference fixtures are hashed over. */
function toBitRows(matrix) {
  return matrix.map((row) => row.map((cell) => (cell ? '1' : '0')).join(''));
}

function toSvg(matrix, { scale = 4, margin = 4, dark = '#000', light = '#fff' } = {}) {
  const size = matrix.length;
  const dimension = (size + margin * 2) * scale;
  const rects = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!matrix[y][x]) continue;
      rects.push(`<rect x="${(x + margin) * scale}" y="${(y + margin) * scale}" width="${scale}" height="${scale}"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dimension}" height="${dimension}" `
    + `viewBox="0 0 ${dimension} ${dimension}" shape-rendering="crispEdges" role="img">`
    + `<rect width="${dimension}" height="${dimension}" fill="${light}"/>`
    + `<g fill="${dark}">${rects.join('')}</g></svg>`;
}

/**
 * PNG bytes: 1-bit greyscale (colour type 0), one filter byte per row, zlib-compressed.
 * `scale` pixels per module, `margin` modules of quiet zone (the spec requires 4).
 */
function toPngBuffer(matrix, { scale = 6, margin = 4 } = {}) {
  if (!Number.isInteger(scale) || scale < 1) throw new Error('scale must be a positive integer');
  const size = matrix.length;
  const dimension = (size + margin * 2) * scale;
  const bytesPerRow = Math.ceil(dimension / 8);

  const raw = Buffer.alloc((bytesPerRow + 1) * dimension);
  for (let y = 0; y < dimension; y += 1) {
    const rowStart = y * (bytesPerRow + 1);
    raw[rowStart] = 0; // filter type: None
    const moduleY = Math.floor(y / scale) - margin;
    for (let x = 0; x < dimension; x += 1) {
      const moduleX = Math.floor(x / scale) - margin;
      const outside = moduleY < 0 || moduleX < 0 || moduleY >= size || moduleX >= size;
      // In 1-bit greyscale a 0 sample is black. Only dark modules are black here: the quiet zone
      // and the light modules are written as 1 (white).
      if (!outside && matrix[moduleY][moduleX]) continue;
      raw[rowStart + 1 + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(dimension, 0);
  ihdr.writeUInt32BE(dimension, 4);
  ihdr[8] = 1; // bit depth
  ihdr[9] = 0; // colour type: greyscale
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(computeCrc32(body), 0);
    return Buffer.concat([length, body, crc]);
  };

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function toPngDataUri(matrix, options) {
  return `data:image/png;base64,${toPngBuffer(matrix, options).toString('base64')}`;
}

module.exports = {
  encode,
  byteCapacity,
  // Exposed for the tests: `null` marks a data module, and the penalty score lets the suite check
  // that the automatic mask choice really is the minimum under the published rules.
  functionPattern,
  penaltyScore,
  toBitRows,
  toSvg,
  toPngBuffer,
  toPngDataUri,
  EC_LEVELS,
  alignmentPositions,
  dataCapacityCodewords,
  rawDataModules,
  remainderBits,
  formatInfoBits,
  versionInfoBits,
};
