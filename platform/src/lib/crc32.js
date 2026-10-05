/**
 * IEEE 802.3 CRC32 (the zlib/PNG polynomial, reflected).
 *
 * Ported from cloudhost247-node/src/payments/paypal-gateway.ts, which uses it because PayPal's
 * webhook signature verification string ends with the **decimal** CRC32 of the raw request body:
 *
 *     <transmission-id>|<transmission-time>|<webhook-id>|<crc32>
 *
 * The table is built once at load; `computeCrc32` returns an unsigned 32-bit integer.
 */
'use strict';

const TABLE = new Int32Array(256);
for (let i = 0; i < 256; i += 1) {
  let c = i;
  for (let j = 0; j < 8; j += 1) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  TABLE[i] = c;
}

/** CRC32 of `buffer` as an unsigned integer (PayPal compares its decimal string form). */
function computeCrc32(buffer) {
  let crc = 0 ^ -1;
  for (let i = 0; i < buffer.length; i += 1) {
    const byte = buffer[i] ?? 0;
    crc = (crc >>> 8) ^ (TABLE[(crc ^ byte) & 0xff] ?? 0);
  }
  return (crc ^ -1) >>> 0;
}

module.exports = { computeCrc32 };
