import assert from 'node:assert/strict';
import { runLocal } from '../../templates/cloudhost247/js/tools-local.js';

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
