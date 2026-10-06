import assert from 'node:assert/strict';
import { runLocal } from '../../templates/cloudhost247/js/tools-local.js';

const empty = await runLocal('md5', { text: '' });
assert.equal(empty.rows[0].MD5, 'd41d8cd98f00b204e9800998ecf8427e');
const abc = await runLocal('md5', { text: 'abc' });
assert.equal(abc.rows[0].MD5, '900150983cd24fb0d6963f7d28e17f72');

const encoded = await runLocal('base64', { text: 'CloudHost247' });
const decoded = await runLocal('base64', { text: encoded.rows[0].Base64, op: 'decode' });
assert.equal(decoded.rows[0].Text, 'CloudHost247');

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
assert.equal(mrzGenerated.rows[0].Value, 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<');
assert.equal(mrzGenerated.rows[1].Value, 'L898902C36UTO7408122F1204159ZE184226B<<<<<10');
assert.equal(mrzGenerated.copyText, mrzGenerated.rows[0].Value + '\n' + mrzGenerated.rows[1].Value);
assert.match(mrzGenerated.summary, /valid ICAO 9303 check digits/i);
assert.ok(mrzGenerated.notes.some((note) => /nothing was uploaded/i.test(note)));

const mrzValidated = await runLocal('mrz_generate', { mode: 'validate', mrz: mrzGenerated.copyText });
assert.equal(mrzValidated.ok, true);
assert.equal(mrzValidated.summary, 'MRZ structure is valid.');
assert.ok(mrzValidated.rows.every((row) => row.Result === 'PASS'));

const mrzTampered = await runLocal('mrz_generate', {
  mode: 'validate', mrz: mrzGenerated.copyText.replace('L898902C3', 'L898902C4'),
});
assert.equal(mrzTampered.summary, 'MRZ validation failed.');
assert.ok(mrzTampered.rows.some((row) => row.Result === 'FAIL'));

const mrzParsed = await runLocal('mrz_generate', { mode: 'parse', mrz: mrzGenerated.copyText });
assert.match(mrzParsed.summary, /Successfully parsed/i);
assert.equal(mrzParsed.rows.find((row) => row.Field === 'Surname').Value, 'ERIKSSON');
assert.equal(mrzParsed.rows.find((row) => row.Field === 'Given names').Value, 'ANNA MARIA');
assert.equal(mrzParsed.rows.find((row) => row.Field === 'Document number').Value, 'L898902C3');

const mrzTransliterated = await runLocal('mrz_generate', { ...specimen, surname: 'Öztürk', givenNames: 'Ayşe' });
assert.ok(mrzTransliterated.rows[0].Value.startsWith('P<UTOOEZTUERK<<AYSE'), 'ICAO transliteration must be applied');

const mrzRejected = await runLocal('mrz_generate', { ...specimen, surname: 'Eriksson3' });
assert.equal(mrzRejected.ok, false);
assert.match(mrzRejected.error, /cannot be transliterated/i);

console.log('local tools ok');
