import assert from 'node:assert/strict';
import { runLocal, qrResultFromData, scanFrame } from '../../templates/cloudhost247/js/tools-local.js';

const empty = await runLocal('md5', { text: '' });
assert.equal(empty.rows[0].MD5, 'd41d8cd98f00b204e9800998ecf8427e');
const abc = await runLocal('md5', { text: 'abc' });
assert.equal(abc.rows[0].MD5, '900150983cd24fb0d6963f7d28e17f72');

// Measure/Value rows are the shared result shape, so a small reader keeps these assertions honest
// about which row they are reading rather than which index happens to be first.
const row = (result, name) => {
  const found = result.rows.find((item) => item.Measure === name || item.Field === name);
  if (!found) throw new assert.AssertionError({ message: 'No "' + name + '" row in ' + JSON.stringify(result.rows.map((r) => r.Measure || r.Field)) });
  return found.Value;
};

const encoded = await runLocal('base64', { text: 'CloudHost247' });
assert.equal(row(encoded, 'Base64'), 'Q2xvdWRIb3N0MjQ3');
const decoded = await runLocal('base64', { text: row(encoded, 'Base64'), op: 'decode' });
assert.equal(row(decoded, 'Text'), 'CloudHost247');

const puny = await runLocal('punycode', { text: 'münchen.de' });
assert.equal(puny.rows[0].Punycode, 'xn--mnchen-3ya.de');

const valid = await runLocal('card', { number: '4111111111111111' });
assert.equal(valid.rows[0].Luhn, 'Valid');
assert.match(valid.rows[0].Masked, /1111/);
assert.equal(JSON.stringify(valid).includes('4111111111111111'), false);
const invalid = await runLocal('card', { number: '4111111111111112' });
assert.equal(invalid.ok, true);
assert.match(invalid.summary, /does not match/i);

const expanded = await runLocal('ipv6_expand', { target: '2001:db8::1' });
assert.equal(expanded.rows[0].Address, '2001:0db8:0000:0000:0000:0000:0000:0001');
const compressed = await runLocal('ipv6_compress', { target: '2001:0db8:0000:0000:0000:0000:0000:0001' });
assert.equal(compressed.rows[0].Address, '2001:db8::1');

const subnet = await runLocal('subnet', { target: '203.0.113.10/24' });
assert.equal(subnet.rows[0].Network, '203.0.113.0');
assert.equal(subnet.rows[0].Broadcast, '203.0.113.255');

const json = await runLocal('json_beautify', { text: '{"a":1}' });
assert.equal(json.ok, true);
const broken = await runLocal('json_minify', { text: '{oops' });
assert.equal(broken.ok, false);

const serp = await runLocal('serp', { title: 'Example', description: 'A snippet', url: 'https://example.com/' });
assert.match(JSON.stringify(serp.notes), /not a Google ranking/i);

// --- ICAO Doc 9303 TD3 MRZ tool (browser-only) ---------------------------------------------------
// The tool is registered in the catalogue at /tools/mrz-generator and published in the footer. These
// assertions keep the browser handler honest: the specimen must reproduce ICAO's own check digits,
// a tampered digit must fail, an unsupported character must be reported rather than deleted, and the
// notes must say where the data was processed.
const specimen = {
  mode: 'generate', issuingState: 'UTO', surname: 'Eriksson', givenNames: 'Anna Maria',
  nationality: 'UTO', documentNumber: 'L898902C3', dateOfBirth: '740812', sex: 'F',
  expiryDate: '120415', optionalData: 'ZE184226B',
};
const mrzGenerated = await runLocal('mrz_generate', specimen);
assert.equal(mrzGenerated.ok, true);
assert.equal(mrzGenerated.rows[0].Field, 'Line 1 (44 characters)');
assert.equal(mrzGenerated.rows[0].Value, 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<');
assert.equal(mrzGenerated.rows[1].Value, 'L898902C36UTO7408122F1204159ZE184226B<<<<<10');
assert.equal(mrzGenerated.copyText, mrzGenerated.rows[0].Value + '\n' + mrzGenerated.rows[1].Value);
assert.match(mrzGenerated.summary, /valid ICAO 9303 check digits/i);
assert.ok(mrzGenerated.notes.some((note) => /nothing was uploaded/i.test(note)));

const mrzValidated = await runLocal('mrz_generate', { mode: 'validate', mrz: mrzGenerated.copyText });
assert.equal(mrzValidated.ok, true);
assert.match(mrzValidated.summary, /^TD3 zone is structurally valid and every check digit matches\.$/);
assert.ok(mrzValidated.rows.every((row) => row.Result === 'PASS'));

const mrzTampered = await runLocal('mrz_generate', {
  mode: 'validate', mrz: mrzGenerated.copyText.replace('L898902C3', 'L898902C4'),
});
// A wrong check digit is the answer, so it is reported as a failure rather than a green result.
assert.equal(mrzTampered.ok, false);
assert.equal(mrzTampered.summary, 'Validation failed');
assert.match(mrzTampered.error, /failed validation/);
assert.ok(mrzTampered.rows.some((row) => row.Result === 'FAIL'));

const mrzParsed = await runLocal('mrz_generate', { mode: 'parse', mrz: mrzGenerated.copyText });
assert.match(mrzParsed.summary, /^Parsed TD3/);
// The parse table repeats some names as validation checks, so select the rows that carry a value.
const mrzField = (name) => mrzParsed.rows.find((row) => row.Field === name && 'Value' in row).Value;
assert.equal(mrzField('Surname'), 'ERIKSSON');
assert.equal(mrzField('Given names'), 'ANNA MARIA');
assert.equal(mrzField('Document number'), 'L898902C3');
assert.equal(mrzField('Nationality'), 'UTO');

const mrzTransliterated = await runLocal('mrz_generate', { ...specimen, surname: 'Öztürk', givenNames: 'Ayşe' });
assert.ok(mrzTransliterated.rows[0].Value.startsWith('P<UTOOEZTUERK<<AYSE'), 'ICAO transliteration must be applied');

const mrzRejected = await runLocal('mrz_generate', { ...specimen, surname: 'Eriksson3' });
assert.equal(mrzRejected.ok, false);
assert.match(mrzRejected.error, /cannot be transliterated/i);

console.log('local tools ok');

// --- QR scanner: the camera path decodes the same way the upload path does ----------------------
// The scanner is browser-only, but the parts that decide what the visitor sees are testable here:
// the payload formatter is pure, the input guards refuse anything that is not local image data, and
// the frame decoder can be driven with real pixels by standing in for the one browser API it needs
// (a canvas 2D context). The matrix below is a genuine QR symbol for the Wi-Fi string underneath —
// produced by the platform's own encoder — so a decoder regression fails here rather than on a
// visitor's screen.

const wifiPayload = 'WIFI:S:CloudHost247 Guest;T:WPA;P:welcome247;';
const wifiMatrix = [
  '111111101011011011001100101111111',
  '100000101001111000101001001000001',
  '101110101101111110000111001011101',
  '101110100011001110111010101011101',
  '101110101100000111000001101011101',
  '100000100100000110110010001000001',
  '111111101010101010101010101111111',
  '000000000000001111100110000000000',
  '100111111010110011101011010010111',
  '011000000010010111011101110001110',
  '110001100110010010010011111110101',
  '010101010111110110110111001010110',
  '100010111111110001010101010001000',
  '001111000111001001111100100010010',
  '011011110110111100111011000001010',
  '101101010001101011001011100110010',
  '010110111001001100101100101000000',
  '000001001100000111010000111011010',
  '111100110111011101111111111100011',
  '100111010110100010011011110001011',
  '110110100101001010110110011001011',
  '111111001100010001000100111000111',
  '100000111100100000111101111001011',
  '100111011011101101111000111011000',
  '110100101111010001100110111110001',
  '000000001100011001011111100011110',
  '111111101101101111001001101010011',
  '100000101110010111111110100010111',
  '101110101011001011010110111110010',
  '101110101010111010100111001010100',
  '101110100010100101010011000011011',
  '100000100000000001011001110010110',
  '111111101100101111111110100001010',
];

const plain = qrResultFromData('https://cloudhost247.com/tools', false);
assert.equal(plain.rows[0].Text, 'https://cloudhost247.com/tools');
assert.match(plain.notes[0], /not opened/i);

const wifi = qrResultFromData(wifiPayload, true);
assert.equal(wifi.rows[0].SSID, 'CloudHost247 Guest');
assert.equal(wifi.rows[0].Security, 'WPA');
assert.equal(wifi.rows[0].Passphrase, 'welcome247');
assert.match(wifi.notes[0], /not stored/i);
assert.throws(() => qrResultFromData('https://cloudhost247.com', true), /not a Wi-Fi setup code/);

// A remote URL is refused before anything is fetched: the scanner decodes local pixels only.
const remote = await runLocal('qr_scan', { image: 'https://example.com/code.png' });
assert.equal(remote.ok, false);
assert.match(remote.error, /data:image/);
const nothing = await runLocal('qr_scan', {});
assert.equal(nothing.ok, false);
assert.match(nothing.error, /camera/i);

/** Pixels for a QR matrix: `scale` device pixels per module, `quiet` modules of margin. */
function qrPixels(matrix, scale, quiet) {
  const size = (matrix.length + quiet * 2) * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  matrix.forEach((row, rowIndex) => {
    for (let column = 0; column < row.length; column += 1) {
      if (row[column] !== '1') continue;
      for (let y = 0; y < scale; y += 1) {
        for (let x = 0; x < scale; x += 1) {
          const px = (quiet + column) * scale + x;
          const py = (quiet + rowIndex) * scale + y;
          const offset = (py * size + px) * 4;
          data[offset] = 0; data[offset + 1] = 0; data[offset + 2] = 0; data[offset + 3] = 255;
        }
      }
    }
  });
  return { data, width: size, height: size };
}

const blankPixels = { data: new Uint8ClampedArray(64 * 64 * 4).fill(255), width: 64, height: 64 };
let currentPixels = blankPixels;
// The only browser API the frame decoder needs. `drawImage` is a no-op because `getImageData`
// already returns the frame the camera would have drawn.
globalThis.document = {
  createElement(tag) {
    assert.equal(tag, 'canvas');
    return {
      width: 0,
      height: 0,
      getContext() { return { drawImage() {}, getImageData: () => currentPixels }; },
    };
  },
};

const blankFrame = await scanFrame({ width: 64, height: 64 }, true);
assert.equal(blankFrame, null, 'a viewfinder frame with no symbol is not an error');

currentPixels = qrPixels(wifiMatrix, 8, 4);
const decodedFrame = await scanFrame({ width: currentPixels.width, height: currentPixels.height }, true);
assert.ok(decodedFrame, 'the frame decoder finds the symbol');
assert.equal(decodedFrame.rows[0].SSID, 'CloudHost247 Guest');
assert.equal(decodedFrame.rows[0].Passphrase, 'welcome247');

// The same pixels read as a plain code, and at a module density where the symbol is only three
// device pixels wide per module — the range a low-resolution webcam actually delivers.
const asText = await scanFrame({ width: currentPixels.width, height: currentPixels.height }, false);
assert.equal(asText.rows[0].Text, wifiPayload);
const coarse = qrPixels(wifiMatrix, 3, 4);
currentPixels = coarse;
const coarseFrame = await scanFrame({ width: coarse.width, height: coarse.height }, true);
assert.ok(coarseFrame, 'a three-pixel-per-module frame still decodes');
assert.equal(coarseFrame.rows[0].SSID, 'CloudHost247 Guest');

delete globalThis.document;
