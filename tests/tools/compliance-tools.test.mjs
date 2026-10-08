/**
 * Acceptance suite for the Compliance & Document Tools collection.
 *
 *   node tests/tools/compliance-tools.test.mjs
 *
 * Every tool in the collection is exercised through the same `runLocal` entry point the browser
 * uses, so a test that passes here is testing the shipped handler rather than a copy of it. The
 * cases are the ones the section promises: valid input, invalid input, empty input, malformed
 * input, minimum and maximum lengths, boundary values, decimals, date edge cases, leap years and
 * time-zone behaviour.
 *
 * The MRZ cases are checked against the three machine-readable zones ICAO publishes as specimens
 * in Doc 9303, and the check digits behind those expectations are re-derived independently in
 * tests/tools/mrz-crosscheck.py so a mistake in this file cannot confirm a mistake in the handler.
 */
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { runLocal, isSecretCell } from '../../templates/cloudhost247/js/tools-local.js';

/**
 * Read a labelled value out of a result, failing loudly when it is absent.
 * Handlers label their rows three ways — { Measure, Value }, { Field, Value } for MRZ, and
 * { Password: ... } style single-purpose rows — so all three are accepted.
 */
const row = (result, name) => {
  const direct = result.rows.find((item) => Object.hasOwn(item, name));
  if (direct) return direct[name];
  const labelled = result.rows.find((item) => (item.Measure ?? item.Field) === name && 'Value' in item);
  assert.ok(labelled, `no "${name}" in ${JSON.stringify(result.rows).slice(0, 400)}`);
  return labelled.Value;
};
const notes = (result) => result.notes.join(' | ');

/** Assert the tool refused the input and said something a person can act on. */
async function refuses(handler, input, pattern) {
  const result = await runLocal(handler, input);
  assert.equal(result.ok, false, `${handler} should have refused ${JSON.stringify(input)} but returned: ${result.summary}`);
  assert.ok(result.error && result.error.length > 12, `${handler} returned an error with no useful message`);
  if (pattern) assert.match(result.error, pattern);
  assert.equal(result.rows.length, 0, 'a refused run must not present result rows');
  return result;
}

/* ============================================================================================== *
 * 1. Age & Date Calculator
 * ============================================================================================== */

test('age: exact age from a date of birth and a reference date', async () => {
  const result = await runLocal('age_date', { dateOfBirth: '1990-04-23', referenceDate: '2026-10-08' });
  assert.equal(result.ok, true);
  assert.equal(result.summary, '36 years, 5 months and 15 days');
  assert.equal(row(result, 'Completed years'), 36);
  assert.equal(row(result, 'Completed months (total)'), 36 * 12 + 5);
  assert.equal(row(result, 'Total days'), 13317);
  assert.equal(row(result, 'Total weeks'), '1902 weeks, 3 days');
  assert.equal(row(result, 'Next birthday'), '2027-04-23 — in 197 day(s)');
});

test('age: DD/MM/YYYY is accepted, ambiguous separators are refused', async () => {
  const slash = await runLocal('age_date', { dateOfBirth: '23/04/1990', referenceDate: '08/10/2026' });
  assert.equal(slash.summary, '36 years, 5 months and 15 days');
  // 03-04-1990 could be 3 April or 4 March. Guessing would make an age silently wrong.
  await refuses('age_date', { dateOfBirth: '03-04-1990' }, /not a date this tool will guess at/);
});

test('age: leap-day birthdays are counted against the real calendar', async () => {
  const onLeap = await runLocal('age_date', { dateOfBirth: '2000-02-29', referenceDate: '2024-02-29' });
  assert.equal(onLeap.summary, '24 years, 0 months and 0 days');
  assert.equal(row(onLeap, 'Total days'), 8766); // 24 years including six leap days
  const afterLeap = await runLocal('age_date', { dateOfBirth: '2000-02-29', referenceDate: '2026-03-01' });
  assert.equal(afterLeap.summary, '26 years, 0 months and 0 days');
  assert.equal(row(afterLeap, 'Total days'), 9497);
});

test('age: empty, invalid and out-of-order input', async () => {
  await refuses('age_date', { dateOfBirth: '' }, /Enter the date of birth/);
  await refuses('age_date', { dateOfBirth: '1990-13-01' }, /months run from 1 to 12/);
  await refuses('age_date', { dateOfBirth: '1990-02-30' }, /does not exist/);
  await refuses('age_date', { dateOfBirth: 'yesterday' }, /not a date this tool will guess at/);
  await refuses('age_date', { dateOfBirth: '2026-01-01', referenceDate: '2025-01-01' }, /before the date of birth/);
});

test('age: the reference date defaults to today and the privacy note is present', async () => {
  const result = await runLocal('age_date', { dateOfBirth: '2000-01-01' });
  assert.equal(result.ok, true);
  assert.match(row(result, 'Reference date'), /^\d{4}-\d{2}-\d{2} \((Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\)$/);
  assert.match(notes(result), /Nothing was uploaded, logged or stored/);
});

/* ============================================================================================== *
 * 2. Date & Duration Calculator
 * ============================================================================================== */

test('duration: exact span between two dates', async () => {
  const result = await runLocal('date_duration', { action: 'difference', startDate: '2026-01-31', endDate: '2026-12-31' });
  assert.equal(row(result, 'Exact duration'), '0y 11m 0d');
  assert.equal(row(result, 'Total days'), 334);
  assert.equal(row(result, 'Weeks and days'), '47 weeks, 5 days');
  assert.equal(row(result, 'Business days (Mon–Fri)'), 239);
  assert.equal(row(result, 'Leap days in range'), 0);
});

test('duration: a range spanning leap years counts 29 February', async () => {
  const result = await runLocal('date_duration', { action: 'difference', startDate: '1970-01-01', endDate: '2026-10-08' });
  assert.equal(row(result, 'Exact duration'), '56y 9m 7d');
  assert.equal(row(result, 'Total days'), 20734);
  assert.equal(row(result, 'Leap days in range'), 14);
});

test('duration: reversed dates are reported rather than returning a negative', async () => {
  const result = await runLocal('date_duration', { action: 'difference', startDate: '2026-12-31', endDate: '2026-01-31' });
  assert.equal(row(result, 'Total days'), 334);
  assert.match(row(result, 'Direction'), /the end date is earlier than the start date/);
});

test('duration: adding months clamps to the last valid day, never rolls over', async () => {
  const plus = await runLocal('date_duration', { action: 'add', startDate: '2026-01-31', amount: '1', unit: 'months' });
  assert.equal(row(plus, 'Result date').slice(0, 10), '2026-02-28');
  const leap = await runLocal('date_duration', { action: 'add', startDate: '2024-01-31', amount: '1', unit: 'months' });
  assert.equal(row(leap, 'Result date').slice(0, 10), '2024-02-29');
  const back = await runLocal('date_duration', { action: 'subtract', startDate: '2024-03-31', amount: '1', unit: 'months' });
  assert.equal(row(back, 'Result date').slice(0, 10), '2024-02-29');
  const years = await runLocal('date_duration', { action: 'add', startDate: '2024-02-29', amount: '1', unit: 'years' });
  assert.equal(row(years, 'Result date').slice(0, 10), '2025-02-28');
});

test('duration: days and weeks, boundaries and invalid input', async () => {
  const week = await runLocal('date_duration', { action: 'add', startDate: '2026-01-01', amount: '2', unit: 'weeks' });
  assert.equal(row(week, 'Result date').slice(0, 10), '2026-01-15');
  assert.equal(row(week, 'Actual day difference'), 14);
  await refuses('date_duration', { action: 'add', startDate: '2026-01-01', amount: '', unit: 'days' }, /Enter the number of days/);
  await refuses('date_duration', { action: 'add', startDate: '2026-01-01', amount: '1.5', unit: 'days' }, /whole number/);
  await refuses('date_duration', { action: 'add', startDate: '2026-01-01', amount: '200000', unit: 'days' }, /more than 100,000/);
  await refuses('date_duration', { action: 'difference', startDate: '2026-01-01' }, /Enter the end date/);
  await refuses('date_duration', { action: 'difference', startDate: '2026-02-30', endDate: '2026-03-01' }, /does not exist/);
});

/* ============================================================================================== *
 * 3. Percentage & Rate Calculator
 * ============================================================================================== */

test('percentage: increase, decrease, difference and reverse', async () => {
  const up = await runLocal('percentage', { action: 'change', from: '1200', to: '1500' });
  assert.match(up.summary, /increase of 25%/);
  assert.equal(row(up, 'Percentage change'), '25%');
  assert.equal(row(up, 'Multiplier'), '1.25×');

  const down = await runLocal('percentage', { action: 'change', from: '1500', to: '1200' });
  assert.match(down.summary, /decrease of 20%/);

  const diff = await runLocal('percentage', { action: 'difference', from: '1200', to: '1500' });
  assert.equal(row(diff, 'Percentage difference'), '22.222222222222%');

  const reverse = await runLocal('percentage', { action: 'reverse', percent: '15', to: '1500' });
  assert.equal(row(reverse, 'Original value'), '1304.347826086957');

  const of = await runLocal('percentage', { action: 'of', percent: '17.5', to: '240' });
  assert.equal(row(of, 'Result'), '42');

  const isWhat = await runLocal('percentage', { action: 'isWhat', from: '60', to: '240' });
  assert.equal(row(isWhat, 'Percentage'), '25%');
});

test('percentage: decimals, thousands separators and division by zero', async () => {
  const decimals = await runLocal('percentage', { action: 'change', from: '0.0025', to: '0.0031' });
  assert.equal(row(decimals, 'Percentage change'), '24%');
  const grouped = await runLocal('percentage', { action: 'of', percent: '10', to: '1,250,000' });
  assert.equal(row(grouped, 'Result'), '125000');
  await refuses('percentage', { action: 'change', from: '0', to: '10' }, /undefined/);
  await refuses('percentage', { action: 'isWhat', from: '10', to: '0' }, /whole is 0/);
  await refuses('percentage', { action: 'change', from: 'abc', to: '10' }, /not a number/);
  await refuses('percentage', { action: 'change', from: '', to: '10' }, /Enter the original value/);
});

/* ============================================================================================== *
 * 4. Unit & Data Conversion Calculator
 * ============================================================================================== */

test('units: binary and decimal conversions are exact', async () => {
  const gib = await runLocal('unit_data', { amount: '1', fromUnit: 'GiB', toUnit: 'GB', precision: '9' });
  assert.equal(row(gib, 'Output'), '1.073741824 GB');
  const tib = await runLocal('unit_data', { amount: '1', fromUnit: 'TiB', toUnit: 'TB', precision: '12' });
  assert.equal(row(tib, 'Output'), '1.099511627776 TB');
  const drive = await runLocal('unit_data', { amount: '4', fromUnit: 'TB', toUnit: 'GiB', precision: '6' });
  assert.equal(row(drive, 'Output'), '3,725.290298 GiB');
  assert.match(notes(drive), /powers of 1024/);
});

test('units: bits, bytes and boundary values', async () => {
  const bits = await runLocal('unit_data', { amount: '8', fromUnit: 'bit', toUnit: 'B', precision: '0' });
  assert.equal(row(bits, 'Output'), '1 B');
  const bytes = await runLocal('unit_data', { amount: '1', fromUnit: 'B', toUnit: 'bit', precision: '0' });
  assert.equal(row(bytes, 'Output'), '8 bit');
  const zero = await runLocal('unit_data', { amount: '0', fromUnit: 'GiB', toUnit: 'TiB' });
  assert.equal(row(zero, 'Output'), '0.000000 TiB');
  await refuses('unit_data', { amount: '-1', fromUnit: 'GiB', toUnit: 'TiB' }, /cannot be negative/);
  await refuses('unit_data', { amount: '1', fromUnit: 'GiB', toUnit: 'lightyears' }, /not a unit/);
  await refuses('unit_data', { amount: '', fromUnit: 'GiB', toUnit: 'GB' }, /Enter the amount/);
  await refuses('unit_data', { amount: '1', fromUnit: 'GiB', toUnit: 'GB', precision: '99' }, /from 0 to 15/);
});

/* ============================================================================================== *
 * 5. Timestamp / Unix Time Calculator
 * ============================================================================================== */

test('timestamp: seconds and milliseconds decode to the same instant', async () => {
  const seconds = await runLocal('unix_timestamp', { action: 'decode', timestamp: '1767225600', zone: 'utc' });
  assert.equal(row(seconds, 'Read as'), 'seconds');
  assert.equal(row(seconds, 'ISO 8601 (UTC)'), '2026-01-01T00:00:00.000Z');
  assert.equal(row(seconds, 'UTC date and time'), '2026-01-01 00:00:00 (Thursday)');
  const millis = await runLocal('unix_timestamp', { action: 'decode', timestamp: '1767225600000', zone: 'utc' });
  assert.equal(row(millis, 'Read as'), 'milliseconds');
  assert.equal(row(millis, 'ISO 8601 (UTC)'), '2026-01-01T00:00:00.000Z');
  assert.equal(row(millis, 'Seconds'), '1767225600');
  const epoch = await runLocal('unix_timestamp', { action: 'decode', timestamp: '0', zone: 'utc' });
  assert.equal(row(epoch, 'ISO 8601 (UTC)'), '1970-01-01T00:00:00.000Z');
});

test('timestamp: encodes ISO 8601 with and without an offset', async () => {
  const utc = await runLocal('unix_timestamp', { action: 'encode', datetime: '2026-01-01T00:00:00Z', zone: 'utc' });
  assert.equal(row(utc, 'Seconds'), '1767225600');
  const offset = await runLocal('unix_timestamp', { action: 'encode', datetime: '2026-01-01T01:00:00+01:00', zone: 'utc' });
  assert.equal(row(offset, 'Seconds'), '1767225600', 'an explicit offset is honoured over the zone selector');
  const plain = await runLocal('unix_timestamp', { action: 'encode', datetime: '2026-01-01 00:00:00', zone: 'utc' });
  assert.equal(row(plain, 'Seconds'), '1767225600');
  const local = await runLocal('unix_timestamp', { action: 'encode', datetime: '2026-01-01 00:00:00', zone: 'local' });
  assert.equal(row(local, 'Read as').startsWith('local time'), true);
});

test('timestamp: local output names the zone and matches the UTC instant', async () => {
  const result = await runLocal('unix_timestamp', { action: 'decode', timestamp: '1767225600', zone: 'local' });
  const localText = row(result, 'Local date and time');
  assert.match(localText, /\(.+\)$/, 'the local reading names its time zone');
  // Same instant, so the offset between the two readings is a whole number of minutes.
  const utcDate = new Date(row(result, 'ISO 8601 (UTC)'));
  const expectedOffset = -new Date().getTimezoneOffset();
  const localDate = new Date(`${localText.replace(/ \(.*\)$/, '').replace(' ', 'T')}`);
  assert.equal((utcDate - localDate) / 60000 - expectedOffset, 0, 'the local reading is the same instant as the UTC one');
});

test('timestamp: now, and rejection of malformed input', async () => {
  const now = await runLocal('unix_timestamp', { action: 'now' });
  assert.match(row(now, 'Seconds'), /^\d{10}$/);
  assert.match(row(now, 'ISO 8601 (UTC)'), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  await refuses('unix_timestamp', { action: 'decode', timestamp: '' }, /Enter the Unix timestamp/);
  await refuses('unix_timestamp', { action: 'decode', timestamp: 'abc' }, /whole number of seconds or milliseconds/);
  await refuses('unix_timestamp', { action: 'decode', timestamp: '1767225600.5' }, /whole number/);
  await refuses('unix_timestamp', { action: 'encode', datetime: '01/01/2026' }, /not a date\/time this tool accepts/);
  await refuses('unix_timestamp', { action: 'encode', datetime: '2026-02-30T00:00:00Z' }, /not a real date/);
  await refuses('unix_timestamp', { action: 'encode', datetime: '2026-01-01T25:00:00Z' }, /hour/);
});

/* ============================================================================================== *
 * 6. MRZ Generator — TD1, TD2 and TD3 against the published ICAO specimens
 * ============================================================================================== */

const ICAO = {
  TD1: ['I<UTOD231458907<<<<<<<<<<<<<<<', '7408122F1204159UTO<<<<<<<<<<<6', 'ERIKSSON<<ANNA<MARIA<<<<<<<<<<'],
  TD2: ['I<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<', 'D231458907UTO7408122F1204159<<<<<<<6'],
  TD3: ['P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<', 'L898902C36UTO7408122F1204159ZE184226B<<<<<10'],
};
const specimenInput = (format) => ({
  mode: 'generate', format, documentCode: format === 'TD3' ? 'P' : 'I',
  issuingState: 'UTO', surname: 'Eriksson', givenNames: 'Anna Maria', nationality: 'UTO',
  documentNumber: format === 'TD3' ? 'L898902C3' : 'D23145890',
  dateOfBirth: '740812', sex: 'F', expiryDate: '120415',
  optionalData: format === 'TD3' ? 'ZE184226B' : '',
});
const lines = (result) => result.rows.filter((item) => /^Line \d \(/.test(item.Field)).map((item) => item.Value);

for (const format of ['TD1', 'TD2', 'TD3']) {
  test(`mrz: ${format} reproduces the published ICAO specimen exactly`, async () => {
    const result = await runLocal('mrz_generate', specimenInput(format));
    assert.equal(result.ok, true);
    assert.deepEqual(lines(result), ICAO[format]);
    assert.equal(lines(result).every((line) => line.length === ICAO[format][0].length), true);
    assert.equal(result.copyText, ICAO[format].join('\n'));
    assert.match(result.summary, new RegExp(`^${format} machine-readable zone generated`));
    assert.match(result.summary, /valid ICAO 9303 check digits/);
    // The generated zone must survive the tool's own validator.
    const validated = await runLocal('mrz_generate', { mode: 'validate', mrz: result.copyText });
    assert.ok(validated.rows.every((check) => check.Result === 'PASS'), JSON.stringify(validated.rows.filter((c) => c.Result !== 'PASS')));
    assert.equal(validated.ok, true);
  });

  test(`mrz: ${format} validation fails when a single digit is tampered with`, async () => {
    // Change the document number's own check digit, which is present in all three specimens.
    const joined = ICAO[format].join('\n');
    const at = joined.indexOf(format === 'TD3' ? 'L898902C36' : 'D231458907');
    assert.ok(at >= 0, `${format} specimen contains its document number and check digit`);
    const original = joined.slice(at, at + 10);
    const tampered = joined.slice(0, at) + original.slice(0, 9) + (original[9] === '0' ? '1' : '0') + joined.slice(at + 10);
    assert.notEqual(tampered, joined);
    const result = await runLocal('mrz_generate', { mode: 'validate', mrz: tampered });
    assert.equal(result.ok, false, 'a wrong check digit must be reported as a failure');
    assert.match(result.error, /failed validation/i);
    const failing = result.rows.filter((check) => check.Result === 'FAIL');
    assert.ok(failing.length >= 1, 'the failing check is identified');
    assert.ok(failing.some((check) => /check digit/i.test(check.Field)), JSON.stringify(failing));
  });

  test(`mrz: ${format} parses back into labelled fields`, async () => {
    const result = await runLocal('mrz_generate', { mode: 'parse', mrz: ICAO[format].join('\n') });
    assert.equal(row(result, 'Surname'), 'ERIKSSON');
    assert.equal(row(result, 'Given names'), 'ANNA MARIA');
    assert.equal(row(result, 'Nationality'), 'UTO');
    assert.equal(row(result, 'Date of birth (YYMMDD)'), '740812');
    assert.match(row(result, 'Format'), new RegExp(`^${format}`));
    assert.match(notes(result), /does not prove|authenticity is not verified|Syntactic validation/);
  });
}

test('mrz: the composite check digit covers the ranges ICAO specifies for each layout', async () => {
  // TD1 excludes the sex code and the nationality; TD2 and TD3 exclude the nationality and the sex.
  // A wrong range still produces a self-consistent zone, so this pins the range itself.
  const td1 = await runLocal('mrz_generate', specimenInput('TD1'));
  assert.equal(lines(td1)[1].slice(29), '6');
  const td2 = await runLocal('mrz_generate', specimenInput('TD2'));
  assert.equal(lines(td2)[1].slice(35), '6');
  const td3 = await runLocal('mrz_generate', specimenInput('TD3'));
  assert.equal(lines(td3)[1].slice(43), '0');
});

test('mrz: a field that cannot fit the selected layout is rejected, never truncated', async () => {
  const longName = await runLocal('mrz_generate', { ...specimenInput('TD1'), surname: 'Brzezczykiewicz', givenNames: 'Wojciech Stanislaw Maksymilian' });
  assert.equal(longName.ok, false);
  assert.match(longName.error, /combined name field .* is \d+ characters/);
  assert.match(longName.error, /TD1 .* allows 30/);
  assert.match(longName.error, /does not truncate/);

  const longDoc = await runLocal('mrz_generate', { ...specimenInput('TD3'), documentNumber: 'L898902C399999' });
  assert.equal(longDoc.ok, false);
  assert.match(longDoc.error, /document number is 14 characters/);

  const longOptional = await runLocal('mrz_generate', { ...specimenInput('TD2'), optionalData: 'TOOLONGFORTD2' });
  assert.equal(longOptional.ok, false);
  assert.match(longOptional.error, /TD2 .* allows 7/);
});

test('mrz: document codes, dates, states and the character set are validated', async () => {
  await refuses('mrz_generate', { ...specimenInput('TD3'), documentCode: 'I' }, /not a valid TD3 document code/);
  await refuses('mrz_generate', { ...specimenInput('TD1'), documentCode: 'P' }, /not a valid TD1 document code/);
  await refuses('mrz_generate', { ...specimenInput('TD3'), documentCode: 'PP1' }, /two characters/);
  await refuses('mrz_generate', { ...specimenInput('TD3'), issuingState: 'UT' }, /three-letter ICAO code/);
  await refuses('mrz_generate', { ...specimenInput('TD3'), dateOfBirth: '741312' }, /uses "13" as its month/);
  await refuses('mrz_generate', { ...specimenInput('TD3'), dateOfBirth: '740230' }, /not a real calendar date/);
  await refuses('mrz_generate', { ...specimenInput('TD3'), dateOfBirth: '1974-08-12' }, /six digits in YYMMDD/);
  await refuses('mrz_generate', { ...specimenInput('TD3'), surname: '' }, /Enter the surname/);
  await refuses('mrz_generate', { ...specimenInput('TD3'), surname: '张' }, /cannot be transliterated/);
  await refuses('mrz_generate', { mode: 'validate', mrz: '' }, /Paste the machine-readable lines/);
});

test('mrz: unsupported zone shapes are reported with what was found', async () => {
  const wrongShape = await runLocal('mrz_generate', { mode: 'validate', mrz: 'P<UTOERIKSSON<<ANNA\nL898902C36' });
  assert.equal(wrongShape.ok, false);
  assert.match(wrongShape.rows[0].Found, /2 line\(s\) of 19 \+ 10/);
  const badCharset = await runLocal('mrz_generate', { mode: 'validate', mrz: ICAO.TD3.join('\n').replace('L898902C3', 'L898902C*') });
  assert.ok(badCharset.rows.some((check) => check.Field === 'Character set' && check.Result === 'FAIL'));
});

test('mrz: transliteration follows ICAO and the scope and privacy notes are stated', async () => {
  const result = await runLocal('mrz_generate', { ...specimenInput('TD3'), surname: 'Öztürk', givenNames: 'Ayşe Nur' });
  assert.equal(lines(result)[0].startsWith('P<UTOOEZTUERK<<AYSE<NUR'), true);
  assert.match(notes(result), /transliterated to the ICAO Latin character set/);
  assert.match(notes(result), /do not prove|Syntactic validation/);
  assert.match(notes(result), /Nothing was uploaded/);
  assert.equal(result.downloadName, 'mrz-td3.txt');
});

/* ============================================================================================== *
 * 7. QR Code Generator
 * ============================================================================================== */

test('qr: encodes text and reports the symbol the encoder produced', async () => {
  const result = await runLocal('qr_generate', { text: 'https://www.cloudhost247.com/tools', ecl: 'M', size: '320', output: 'png' });
  assert.equal(result.ok, true);
  assert.ok(result.rows.some((item) => String(item.Preview ?? '').startsWith('data:image/png')));
  assert.match(row(result, 'Modules'), /^\d+×\d+$/);
  assert.match(notes(result), /No image service was called/);
});

test('qr: SVG output is copyable and error correction changes the symbol', async () => {
  const svg = await runLocal('qr_generate', { text: 'CH247', ecl: 'L', output: 'svg' });
  assert.match(row(svg, 'SVG'), /^<svg/);
  assert.equal(svg.downloadName, 'qrcode.svg');
  const low = await runLocal('qr_generate', { text: 'CH247', ecl: 'L', output: 'svg' });
  const high = await runLocal('qr_generate', { text: 'CH247', ecl: 'H', output: 'svg' });
  assert.notEqual(row(low, 'SVG'), row(high, 'SVG'), 'a higher error-correction level must add redundancy');
});

test('qr: empty input is refused and the limit is enforced', async () => {
  await refuses('qr_generate', { text: '' }, /Enter the text or URL/);
  await refuses('qr_generate', { text: 'x'.repeat(4001) }, /caps input at 4,000 characters/);
  await refuses('qr_generate', { text: 'ok', size: '10000' }, /from 128 to 1024/);
});

/* ============================================================================================== *
 * 8. UUID Generator
 * ============================================================================================== */

test('uuid: v4 is RFC 9562 shaped and every value is distinct', async () => {
  const result = await runLocal('uuid', { version: 'v4', count: '50', format: 'standard' });
  const values = result.rows.map((item) => item.UUID);
  assert.equal(values.length, 50);
  values.forEach((value) => assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/));
  assert.equal(new Set(values).size, 50);
  assert.equal(result.downloadName, 'uuids.txt');
});

test('uuid: v7 embeds the current time and sorts by creation', async () => {
  const result = await runLocal('uuid', { version: 'v7', count: '5', format: 'standard' });
  const values = result.rows.map((item) => item.UUID);
  values.forEach((value) => assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/));
  const timestamps = values.map((value) => Number.parseInt(value.replace(/-/g, '').slice(0, 12), 16));
  const drift = Math.abs(timestamps[0] - Date.now());
  assert.ok(drift < 60000, `the v7 timestamp is within a minute of now (drift ${drift} ms)`);
  assert.deepEqual([...timestamps].sort((a, b) => a - b), timestamps, 'v7 values sort by creation time');
});

test('uuid: nil, formats and bulk boundaries', async () => {
  const nil = await runLocal('uuid', { version: 'nil', count: '3', format: 'standard' });
  assert.deepEqual(nil.rows.map((item) => item.UUID), Array(3).fill('00000000-0000-0000-0000-000000000000'));
  const formats = { hex: /^[0-9a-f]{32}$/, braces: /^\{[0-9a-f-]{36}\}$/, urn: /^urn:uuid:[0-9a-f-]{36}$/, upper: /^[0-9A-F-]{36}$/ };
  for (const [format, pattern] of Object.entries(formats)) {
    const result = await runLocal('uuid', { version: 'v4', count: '1', format });
    assert.match(result.rows[0].UUID, pattern, `format ${format}`);
  }
  const bulk = await runLocal('uuid', { version: 'v4', count: '1000' });
  assert.equal(bulk.rows.length, 1000);
  await refuses('uuid', { version: 'v4', count: '0' }, /from 1 to 1000/);
  await refuses('uuid', { version: 'v4', count: '1001' }, /from 1 to 1000/);
  await refuses('uuid', { version: 'v4', count: '' }, /from 1 to 1000/);
});

/* ============================================================================================== *
 * 9. Random Password Generator
 * ============================================================================================== */

test('password: honours length and character classes, and reports real entropy', async () => {
  const result = await runLocal('password_generate', {
    kind: 'password', length: '32', uppercase: 'yes', lowercase: 'yes', numbers: 'yes', symbols: 'yes', unambiguous: 'no',
  });
  const password = row(result, 'Password');
  assert.equal(password.length, 32);
  assert.match(password, /[A-Z]/);
  assert.match(password, /[a-z]/);
  assert.match(password, /[0-9]/);
  assert.match(password, /[^A-Za-z0-9]/);
  assert.equal(row(result, 'Character classes'), 4);
  assert.ok(Number(row(result, 'Entropy (bits)')) > 180, `32 characters from a 90+ alphabet is well over 180 bits, got ${row(result, 'Entropy (bits)')}`);
  assert.match(notes(result), /Not uploaded, not logged, not stored/);
});

test('password: excluding look-alikes lowers the alphabet and the entropy', async () => {
  const full = await runLocal('password_generate', { kind: 'password', length: '20', uppercase: 'yes', lowercase: 'yes', numbers: 'yes', symbols: 'no', unambiguous: 'no' });
  const clean = await runLocal('password_generate', { kind: 'password', length: '20', uppercase: 'yes', lowercase: 'yes', numbers: 'yes', symbols: 'no', unambiguous: 'yes' });
  assert.ok(Number(row(clean, 'Alphabet size')) < Number(row(full, 'Alphabet size')));
  assert.ok(Number(row(clean, 'Entropy (bits)')) < Number(row(full, 'Entropy (bits)')));
  assert.equal(/[Il1O0]/.test(row(clean, 'Password')), false);
});

test('password: no character set, and length boundaries', async () => {
  const min = await runLocal('password_generate', { kind: 'password', length: '8', lowercase: 'yes', uppercase: 'no', numbers: 'no', symbols: 'no' });
  assert.equal(row(min, 'Password').length, 8);
  const max = await runLocal('password_generate', { kind: 'password', length: '128', lowercase: 'yes' });
  assert.equal(row(max, 'Password').length, 128);
  await refuses('password_generate', { kind: 'password', length: '7', lowercase: 'yes' }, /from 8 to 128/);
  await refuses('password_generate', { kind: 'password', length: '129', lowercase: 'yes' }, /from 8 to 128/);
  await refuses('password_generate', { kind: 'password', length: '20', uppercase: 'no', lowercase: 'no', numbers: 'no', symbols: 'no' }, /at least one character set/);
});

test('password: passphrase mode uses the word list and reports its entropy', async () => {
  const five = await runLocal('password_generate', { kind: 'passphrase', length: '5' });
  const passphrase = row(five, 'Passphrase');
  assert.equal(passphrase.split(/[-. ]/).length, 5);
  // The list is 368 words, so each word is worth log2(368) = 8.52 bits and the total is stated.
  assert.ok(Math.abs(Number(row(five, 'Entropy (bits)')) - 5 * Math.log2(368)) < 0.01,
    `entropy must be words * log2(368), got ${row(five, 'Entropy (bits)')}`);
  const seven = await runLocal('password_generate', { kind: 'passphrase' });
  assert.equal(row(seven, 'Passphrase').split(/[-. ]/).length, 7, 'the default passphrase is seven words');
  assert.ok(Number(row(seven, 'Entropy (bits)')) >= 59, `seven words is about 60 bits, got ${row(seven, 'Entropy (bits)')}`);
  assert.match(notes(five), /assumes the list is public/);
  assert.match(notes(five), /368-word list/);
  await refuses('password_generate', { kind: 'passphrase', length: '2' }, /from 3 to 12/);
});

test('password: 200 runs produce no repeat and no Math.random fallback', async () => {
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) {
    const result = await runLocal('password_generate', { kind: 'password', length: '24', lowercase: 'yes', uppercase: 'yes', numbers: 'yes', symbols: 'yes' });
    seen.add(row(result, 'Password'));
  }
  assert.equal(seen.size, 200);
});

/* ============================================================================================== *
 * 10. API Key / Token Generator
 * ============================================================================================== */

test('api key: prefix, alphabet, length and bulk', async () => {
  const result = await runLocal('api_key_generate', { prefix: 'ch247_live', length: '40', alphabet: 'base62', count: '5' });
  const keys = result.rows.filter((item) => item['#'] !== '').map((item) => item.Key);
  assert.equal(keys.length, 5);
  keys.forEach((key) => {
    assert.match(key, /^ch247_live_[A-Za-z0-9]{40}$/);
  });
  assert.equal(new Set(keys).size, 5);
  assert.match(notes(result), /Estimated entropy: 238\.17 bits \(40 characters from a 62-character set\)\. The prefix is not secret/);
  assert.equal(result.downloadName, 'api-keys.txt');
});

test('api key: every declared alphabet is used and only that alphabet', async () => {
  const patterns = {
    base62: /^[A-Za-z0-9]+$/, hex: /^[0-9a-f]+$/, base32: /^[A-Z2-7]+$/,
    urlsafe: /^[A-Za-z0-9_-]+$/, digits: /^[0-9]+$/,
  };
  for (const [alphabet, pattern] of Object.entries(patterns)) {
    const result = await runLocal('api_key_generate', { prefix: '', length: '64', alphabet, count: '1' });
    assert.match(result.rows[0].Key, pattern, `alphabet ${alphabet}`);
    assert.equal(result.rows[0].Key.length, 64);
  }
});

test('api key: boundaries, prefix sanitising and the privacy note', async () => {
  const min = await runLocal('api_key_generate', { length: '16', count: '1' });
  assert.equal(min.rows[0].Key.length, 16);
  const bulk = await runLocal('api_key_generate', { length: '32', count: '100' });
  assert.equal(bulk.rows.filter((item) => item['#'] !== '').length, 100);
  await refuses('api_key_generate', { length: '15', count: '1' }, /from 16 to 256/);
  await refuses('api_key_generate', { length: '257', count: '1' }, /from 16 to 256/);
  await refuses('api_key_generate', { length: '32', count: '101' }, /from 1 to 100/);
  // A prefix is not part of the secret and must not smuggle characters into a URL or a shell.
  const dirty = await runLocal('api_key_generate', { prefix: 'sk/../live key!', length: '32', count: '1' });
  assert.match(dirty.rows[0].Key, /^sklivekey_[A-Za-z0-9]{32}$/);
  assert.match(notes(min), /Not uploaded, not logged, not stored, not placed in a URL/);
});

/* ============================================================================================== *
 * 11. Checksum / Hash Generator
 * ============================================================================================== */

test('hash: known SHA-256, SHA-384, SHA-512 and SHA-1 digests of "abc"', async () => {
  const expected = {
    sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    sha384: 'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7',
    sha512: 'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
    sha1: 'a9993e364706816aba3e25717850c26c9cd0d89d',
  };
  for (const [algorithm, digest] of Object.entries(expected)) {
    const result = await runLocal('checksum_hash', { source: 'text', text: 'abc', algorithm });
    assert.equal(row(result, 'Hex'), digest, algorithm);
  }
});

test('hash: MD5 is produced and labelled as legacy', async () => {
  const result = await runLocal('checksum_hash', { source: 'text', text: 'abc', algorithm: 'md5' });
  assert.equal(row(result, 'Hex'), '900150983cd24fb0d6963f7d28e17f72');
  assert.match(notes(result), /broken for collision resistance/);
  const empty = await runLocal('checksum_hash', { source: 'text', text: '', algorithm: 'md5' });
  assert.equal(row(empty, 'Hex'), 'd41d8cd98f00b204e9800998ecf8427e');
});

test('hash: UTF-8 text, Base64 output and the empty-input path', async () => {
  const result = await runLocal('checksum_hash', { source: 'text', text: 'CloudHost247 — Lagos', algorithm: 'sha256' });
  assert.equal(row(result, 'Hex').length, 64);
  assert.equal(row(result, 'Base64').length, 44);
  assert.match(row(result, 'Input'), /bytes UTF-8/);
  // A multi-byte string is hashed as UTF-8, so the byte count exceeds the character count.
  assert.match(row(result, 'Input'), /22 bytes UTF-8/);
});

test('hash: a file is hashed from its bytes and unknown algorithms are refused', async () => {
  const bytes = new TextEncoder().encode('abc');
  const result = await runLocal('checksum_hash', { source: 'file', algorithm: 'sha256', file: { name: 'abc.txt', size: 3, arrayBuffer: async () => bytes.buffer } });
  assert.equal(row(result, 'Hex'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.match(row(result, 'Input'), /abc\.txt \(3 bytes\)/);
  await refuses('checksum_hash', { source: 'file', algorithm: 'sha256' }, /Choose a file/);
  await refuses('checksum_hash', { source: 'text', text: 'abc', algorithm: 'sha3-256' }, /Supported algorithms/);
});

/* ============================================================================================== *
 * 12. Base64 Encoder / Decoder
 * ============================================================================================== */

test('base64: UTF-8 round trip, URL-safe alphabet and strict decoding', async () => {
  const text = 'CloudHost247 — Lagos ⇄ ☃';
  const encoded = await runLocal('base64', { op: 'encode', variant: 'standard', text });
  const decoded = await runLocal('base64', { op: 'decode', variant: 'standard', text: row(encoded, 'Base64') });
  assert.equal(row(decoded, 'Text'), text);

  const urlSafe = await runLocal('base64', { op: 'encode', variant: 'urlsafe', text: 'subjects?_d=1>>>' });
  assert.equal(/[+/=]/.test(row(urlSafe, 'Base64')), false);
  const back = await runLocal('base64', { op: 'decode', variant: 'urlsafe', text: row(urlSafe, 'Base64') });
  assert.equal(row(back, 'Text'), 'subjects?_d=1>>>');
});

test('base64: invalid input is reported, not silently skipped', async () => {
  await refuses('base64', { op: 'decode', variant: 'standard', text: '!!!!' }, /not in the standard Base64 alphabet/);
  // "QUJDR" is 5 characters: a body whose length leaves a remainder of 1 when divided by 4 cannot
  // be valid Base64, so it is reported rather than decoded with a byte dropped.
  await refuses('base64', { op: 'decode', variant: 'standard', text: 'QUJDR' }, /remainder of 1/);
  await refuses('base64', { op: 'decode', variant: 'standard', text: '' }, /Enter the Base64 to decode/);
  await refuses('base64', { op: 'encode', variant: 'standard', text: '' }, /Enter the text to encode/);
  // A standard-alphabet string is not valid URL-safe Base64: the alphabets are not interchangeable.
  const standard = await runLocal('base64', { op: 'encode', variant: 'standard', text: '>>>???' });
  if (/[+/]/.test(row(standard, 'Base64'))) {
    await refuses('base64', { op: 'decode', variant: 'urlsafe', text: row(standard, 'Base64') }, /not in the URL-safe Base64 alphabet/);
  }
});

test('base64: binary payloads are reported as bytes rather than mangled into text', async () => {
  const binary = Buffer.from([0xff, 0xfe, 0x00, 0x80]).toString('base64');
  const result = await runLocal('base64', { op: 'decode', variant: 'standard', text: binary });
  assert.match(result.summary, /not valid UTF-8/);
  assert.equal(row(result, 'Hex'), 'fffe0080');
});

/* ============================================================================================== *
 * 13. JSON Formatter / Generator
 * ============================================================================================== */

test('json: format, minify and validate preserve semantics', async () => {
  const input = '{"b":[1,2,{"a":null}],"s":"x"}';
  const formatted = await runLocal('json_format', { action: 'format', text: input, indent: '2' });
  assert.equal(row(formatted, 'Result'), '{\n  "b": [\n    1,\n    2,\n    {\n      "a": null\n    }\n  ],\n  "s": "x"\n}');
  const tabs = await runLocal('json_format', { action: 'format', text: '{"a":1}', indent: 'tab' });
  assert.equal(row(tabs, 'Result'), '{\n\t"a": 1\n}');
  const minified = await runLocal('json_format', { action: 'minify', text: '{\n  "a" : 1\n}', indent: '2' });
  assert.equal(row(minified, 'Result'), '{"a":1}');
  const validated = await runLocal('json_format', { action: 'validate', text: input });
  assert.equal(row(validated, 'Result'), 'Valid');
  assert.match(row(validated, 'Top-level type'), /^object$/);
});

test('json: syntax errors carry a line, a column and the offending fragment', async () => {
  const result = await runLocal('json_format', { action: 'format', text: '{\n  "a": 1,\n  "b": ,\n}', indent: '2' });
  assert.equal(result.ok, false);
  assert.match(result.error, /Invalid JSON/);
  assert.match(result.error, /line \d+, column \d+/);
  assert.match(result.error, /Near "/);
  await refuses('json_format', { action: 'format', text: '' }, /Enter the JSON/);
  await refuses('json_format', { action: 'format', text: '{oops' }, /Invalid JSON/);
  await refuses('json_format', { action: 'format', text: "{'a':1}" }, /Invalid JSON/);
});

test('json: precision loss beyond 2^53 is reported instead of silently rewritten', async () => {
  const result = await runLocal('json_format', { action: 'format', text: '{"id": 12345678901234567890}', indent: '2' });
  assert.equal(result.ok, true);
  assert.match(notes(result), /exceeds 2\^53-1/);
  const safe = await runLocal('json_format', { action: 'format', text: '{"id": 123}', indent: '2' });
  assert.equal(notes(safe).match(/exceeds 2\^53-1/g), null, 'a safe document gets no precision warning');
});

/* ============================================================================================== *
 * 14. Robots.txt Generator
 * ============================================================================================== */

test('robots: a valid file with agents, rules, crawl-delay and sitemap', async () => {
  const result = await runLocal('robots', {
    agent: '*\nGooglebot', disallow: '/admin/\n/tmp/', allow: '/admin/help',
    crawlDelay: '10', sitemap: 'https://example.com/sitemap.xml', noindexNote: 'yes',
  });
  const file = row(result, 'File');
  assert.equal(file, [
    'User-agent: *', 'User-agent: Googlebot', 'Disallow: /admin/', 'Disallow: /tmp/',
    'Allow: /admin/help', 'Crawl-delay: 10', '', 'Sitemap: https://example.com/sitemap.xml',
  ].join('\n'));
  assert.equal(result.downloadName, 'robots.txt');
  assert.match(notes(result), /not an access control/);
  assert.match(notes(result), /ignored by Googlebot/);
  assert.match(notes(result), /re-opens part of a Disallowed directory/);
});

test('robots: malformed paths, sitemaps and empty input are refused', async () => {
  await refuses('robots', { agent: '*', disallow: 'admin/' }, /must start with a forward slash/);
  await refuses('robots', { agent: '*', sitemap: 'sitemap.xml' }, /not an absolute URL/);
  await refuses('robots', { agent: '*', sitemap: 'ftp://example.com/s.xml' }, /must be http or https/);
  await refuses('robots', { agent: '', disallow: '/admin/' }, /at least one user-agent/);
  await refuses('robots', { agent: '*' }, /Nothing to publish/);
  await refuses('robots', { agent: 'Bad Agent\nOK', crawlDelay: '5' }, /contains a space/);
  await refuses('robots', { agent: '*', crawlDelay: '0' }, /from 1 to 86400/);
});

/* ============================================================================================== *
 * 15. HTTP Security Headers Generator
 * ============================================================================================== */

test('headers: a strict set is emitted in the syntax of each target', async () => {
  const nginx = await runLocal('http_security_headers', { server: 'nginx', csp: 'strict', hsts: 'oneyear', frame: 'deny', referrerpolicy: 'strict-origin-when-cross-origin', permissions: 'restrictive', cookies: 'yes' });
  const config = row(nginx, 'Configuration');
  assert.match(config, /add_header Content-Security-Policy "default-src 'self'; script-src 'self'/);
  assert.match(config, /add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;/);
  assert.match(config, /add_header X-Content-Type-Options "nosniff" always;/);
  assert.match(config, /add_header X-Frame-Options "DENY" always;/);
  assert.match(config, /add_header Permissions-Policy "camera=\(\)/);
  assert.match(notes(nginx), /preload is effectively irreversible/);

  const apache = await runLocal('http_security_headers', { server: 'apache', csp: 'balanced', hsts: 'sixmonths', frame: 'sameorigin', referrerpolicy: 'no-referrer', permissions: 'off', cookies: 'no' });
  const apacheConfig = row(apache, 'Configuration');
  assert.match(apacheConfig, /<IfModule mod_headers\.c>/);
  assert.match(apacheConfig, /Header always set X-Frame-Options "SAMEORIGIN"/);
  assert.match(apacheConfig, /Header always set Referrer-Policy "no-referrer"/);
  assert.equal(/Permissions-Policy/.test(apacheConfig.split('#')[0]), false, 'Permissions-Policy is omitted when switched off');

  const caddy = await runLocal('http_security_headers', { server: 'caddy', csp: 'strict', hsts: 'oneyear', frame: 'deny', referrerpolicy: 'same-origin', permissions: 'restrictive', cookies: 'no' });
  assert.match(row(caddy, 'Configuration'), /^header \{\n {4}Content-Security-Policy/);
  const cloudflare = await runLocal('http_security_headers', { server: 'cloudflare', csp: 'strict', hsts: 'oneyear', frame: 'deny', referrerpolicy: 'same-origin', permissions: 'restrictive', cookies: 'no' });
  assert.match(row(cloudflare, 'Configuration'), /http\.response\.headers\["X-Content-Type-Options"\]/);
  const raw = await runLocal('http_security_headers', { server: 'raw', csp: 'off', hsts: 'off', frame: 'off', referrerpolicy: 'same-origin', permissions: 'off', cookies: 'no' });
  const rawConfig = row(raw, 'Configuration');
  assert.equal(/Content-Security-Policy:/.test(rawConfig.split('\n\n')[0]), false);
  assert.match(rawConfig, /X-Content-Type-Options: nosniff/);
});

test('headers: the tool says it generates configuration and does not verify anything', async () => {
  const result = await runLocal('http_security_headers', { server: 'nginx', csp: 'strict', hsts: 'sixmonths', frame: 'deny', referrerpolicy: 'same-origin', permissions: 'restrictive', cookies: 'no' });
  assert.match(notes(result), /does not scan your site/);
  assert.match(notes(result), /staging/);
  assert.equal(result.downloadName, 'security-headers.conf');
});

/* ============================================================================================== *
 * 16. Password Policy Generator
 * ============================================================================================== */

test('policy: the selected controls appear in the exported document', async () => {
  const result = await runLocal('password_policy', {
    minLength: '16', mfa: 'required', lockoutThreshold: '5', lockoutMinutes: '30', history: '12',
    maxAgeDays: '0', sessionMinutes: '15', breachCheck: 'yes', complexity: 'length', storage: 'argon2',
  });
  const document = row(result, 'Policy document');
  assert.match(document, /Minimum length: 16 characters/);
  assert.match(document, /Required for every account/);
  assert.match(document, /5 consecutive failures, then 30 minutes locked/);
  assert.match(document, /last 12 passwords cannot be reused/);
  assert.match(document, /Maximum password age: No scheduled expiry/);
  assert.match(document, /Idle session timeout: 15 minutes/);
  assert.match(document, /Argon2id/);
  assert.match(document, /not a certification/);
  assert.equal(result.downloadName, 'password-policy.md');
});

test('policy: alternatives, boundaries and invalid input', async () => {
  const classes = await runLocal('password_policy', {
    minLength: '12', mfa: 'privileged', lockoutThreshold: '0', lockoutMinutes: '15', history: '0',
    maxAgeDays: '365', sessionMinutes: '60', breachCheck: 'no', complexity: 'classes', storage: 'pbkdf2',
  });
  const document = row(classes, 'Policy document');
  assert.match(document, /Required for privileged accounts only/);
  assert.match(document, /No lockout/);
  assert.match(document, /No reuse history kept/);
  assert.match(document, /365 days/);
  assert.match(document, /uppercase letter, one lowercase letter/);
  assert.match(document, /PBKDF2-SHA-256/);
  assert.match(document, /not screened/);
  await refuses('password_policy', { minLength: '5' }, /from 6 to 128/);
  await refuses('password_policy', { minLength: '129' }, /from 6 to 128/);
  await refuses('password_policy', { minLength: '14', history: '25' }, /from 0 to 24/);
  await refuses('password_policy', { minLength: '14', lockoutThreshold: '101' }, /from 0 to 100/);
  const defaults = await runLocal('password_policy', {});
  assert.equal(row(defaults, 'Minimum length'), '14 characters', 'omitted controls fall back to their documented defaults');
  await refuses('password_policy', { minLength: '14', sessionMinutes: '0' }, /from 1 to 1440/);
});

/* ============================================================================================== *
 * 17. DNS / Domain Configuration Generator
 * ============================================================================================== */

test('dns: a zone file with A, AAAA, CNAME, MX, TXT, SPF and DMARC', async () => {
  const result = await runLocal('dns_record_generate', {
    domain: 'example.com', defaultTtl: '3600',
    aRecords: '@ = 203.0.113.10\nwww = 203.0.113.11',
    aaaaRecords: '@ = 2001:db8::10',
    cnameRecords: 'shop = example.net.',
    mxRecords: '10 mail.example.com.\n20 mail2.example.com.',
    txtRecords: '_acme-challenge = verify123',
    spfIncludes: '_spf.example.net, _spf.example.org', spfPolicy: '-all',
    dmarcPolicy: 'quarantine', dmarcRua: 'dmarc@example.com',
    format: 'zone',
  });
  const zone = row(result, 'Configuration');
  assert.match(zone, /\$ORIGIN example\.com\./);
  assert.match(zone, /\$TTL 3600/);
  assert.match(zone, /^@\s+3600\s+IN\s+A\s+203\.0\.113\.10$/m);
  assert.match(zone, /IN\s+AAAA\s+2001:db8::10/);
  assert.match(zone, /shop\s+3600\s+IN\s+CNAME\s+example\.net\./);
  assert.match(zone, /IN\s+MX\s+10 mail\.example\.com\./);
  assert.match(zone, /"v=spf1 include:_spf\.example\.net include:_spf\.example\.org -all"/);
  assert.match(zone, /_dmarc.*"v=DMARC1; p=quarantine; rua=mailto:dmarc@example\.com"/);
  assert.match(notes(result), /Nothing was published/);
});

test('dns: DKIM is emitted only when both a selector and a key are supplied', async () => {
  const key = 'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQD';
  const withKey = await runLocal('dns_record_generate', { domain: 'example.com', defaultTtl: '3600', dkimSelector: 'google', dkimPublicKey: key, format: 'json' });
  const parsed = JSON.parse(row(withKey, 'Configuration'));
  const dkim = parsed.records.find((record) => record.type === 'TXT' && record.name === 'google._domainkey');
  assert.equal(dkim.value, `v=DKIM1; k=rsa; p=${key}`);
  await refuses('dns_record_generate', { domain: 'example.com', defaultTtl: '3600', dkimSelector: 'google' }, /Enter the DKIM public key/);
  await refuses('dns_record_generate', { domain: 'example.com', defaultTtl: '3600', dkimPublicKey: key }, /Enter the DKIM selector/);
  await refuses('dns_record_generate', { domain: 'example.com', defaultTtl: '3600', dkimSelector: 'google', dkimPublicKey: 'not base64!!' }, /must be base64/);
});

test('dns: malformed values are rejected before any output', async () => {
  await refuses('dns_record_generate', { domain: 'example.com', defaultTtl: '3600', aRecords: '@ = 999.1.1.1' }, /not an IPv4 address/);
  await refuses('dns_record_generate', { domain: 'example.com', defaultTtl: '3600', aaaaRecords: '@ = not-an-ipv6' }, /not an IPv6 address/);
  await refuses('dns_record_generate', { domain: 'example.com', defaultTtl: '3600', mxRecords: '10 203.0.113.5' }, /must be a hostname, not an address literal/);
  await refuses('dns_record_generate', { domain: 'example.com', defaultTtl: '3600', mxRecords: 'mail.example.com' }, /use "priority hostname"/);
  await refuses('dns_record_generate', { domain: 'example.com', defaultTtl: '3600', aRecords: '@ 203.0.113.10' }, /use "name = value"/);
  await refuses('dns_record_generate', { domain: 'example.com', defaultTtl: '3600', dmarcPolicy: 'reject', dmarcRua: 'not-an-email' }, /not an email address/);
  await refuses('dns_record_generate', { domain: 'not a domain', defaultTtl: '3600' }, /not a valid hostname/);
  await refuses('dns_record_generate', { domain: 'example.com', defaultTtl: '10' }, /from 60 to 86400/);
  await refuses('dns_record_generate', { domain: '', defaultTtl: '3600' }, /Enter the domain/);
});

test('dns: a CNAME that collides with another record is skipped with a warning, never published twice', async () => {
  const result = await runLocal('dns_record_generate', {
    domain: 'example.com', defaultTtl: '3600', aRecords: '@ = 203.0.113.10', cnameRecords: '@ = example.net.', format: 'json',
  });
  const parsed = JSON.parse(row(result, 'Configuration'));
  assert.equal(parsed.records.filter((record) => record.name === '@').length, 1);
  assert.match(notes(result), /a CNAME cannot coexist/);
});

test('dns: no invented values — empty input produces no records, and Cloudflare CSV is quoted', async () => {
  const empty = await runLocal('dns_record_generate', { domain: 'example.com', defaultTtl: '3600', format: 'zone' });
  assert.match(row(empty, 'Configuration'), /No records were generated/);
  assert.match(notes(empty), /Nothing was invented/);
  const csv = await runLocal('dns_record_generate', {
    domain: 'example.com', defaultTtl: '3600', aRecords: '@ = 203.0.113.10', mxRecords: '10 mail.example.com.', format: 'cloudflare',
  });
  const lines = row(csv, 'Configuration').split('\n');
  assert.equal(lines[0], 'name,type,content,ttl,proxied,priority');
  assert.equal(lines[1], 'example.com.,A,203.0.113.10,3600,false,');
  assert.equal(lines[2], 'example.com.,MX,mail.example.com.,3600,false,10');
});

test('dns: SPF warns past the 10-lookup and 255-character limits', async () => {
  const many = Array.from({ length: 11 }, (_, i) => `_spf${i}.example.net`).join(' ');
  const result = await runLocal('dns_record_generate', { domain: 'example.com', defaultTtl: '3600', spfIncludes: many, spfPolicy: '-all', format: 'zone' });
  assert.match(notes(result), /at most 10 DNS lookups/);
  const monitoring = await runLocal('dns_record_generate', { domain: 'example.com', defaultTtl: '3600', dmarcPolicy: 'none', dmarcRua: 'd@example.com', format: 'zone' });
  assert.match(notes(monitoring), /monitoring only/);
});

test('mrz: an independent implementation reproduces every specimen check digit', async () => {
  // tests/tools/mrz-crosscheck.py re-derives the check digits from the ICAO field tables in Python,
  // with no import of the JavaScript under test. If the two disagree, one of them is wrong.
  const script = new URL('./mrz-crosscheck.py', import.meta.url);
  let run;
  try {
    run = spawnSync('python3', [fileURLToPath(script)], { encoding: 'utf8' });
  } catch {
    test.skip = true;
    return;
  }
  if (run.error && run.error.code === 'ENOENT') {
    // No Python in this environment: say so rather than passing a test that never ran.
    assert.ok(false, 'python3 is required to run tests/tools/mrz-crosscheck.py');
  }
  assert.equal(run.status, 0, `the independent cross-check failed:\n${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /all specimens verified against an independent implementation/);
  // The cross-check also proves the two candidate TD1 composite ranges are distinguishable, so a
  // regression to the wrong range cannot pass by accident.
  assert.match(run.stdout, /the wrong range, must differ from the specimen/);
});

test('secrets are masked in the result table, measurements are not', async () => {
  // The page masks whatever isSecretCell says to mask, so this exercises the same rule the browser
  // uses against the rows the generators actually emit.
  const password = await runLocal('password_generate', { kind: 'password', length: '24', lowercase: 'yes' });
  assert.equal(isSecretCell(password.rows[0], 'Password'), true, 'the password cell is masked');
  assert.equal(isSecretCell(password.rows[0], 'Entropy (bits)'), false, 'the entropy figure is not a secret');

  const keys = await runLocal('api_key_generate', { length: '32', count: '2' });
  keys.rows.forEach((row) => {
    assert.equal(isSecretCell(row, 'Key'), true, 'every key cell is masked');
    assert.equal(isSecretCell(row, '#'), false);
  });

  const passphrase = await runLocal('password_generate', { kind: 'passphrase', length: '5' });
  assert.equal(isSecretCell(passphrase.rows[0], 'Passphrase'), true);

  // A labelled Measure/Value row is masked on its Value cell only.
  assert.equal(isSecretCell({ Measure: 'Password', Value: 'x' }, 'Value'), true);
  assert.equal(isSecretCell({ Measure: 'Password', Value: 'x' }, 'Measure'), false);
  // Measurements and document fields are never hidden.
  assert.equal(isSecretCell({ Measure: 'Hex', Value: 'abc' }, 'Value'), false);
  assert.equal(isSecretCell({ Field: 'Surname', Value: 'ERIKSSON' }, 'Value'), false);
  assert.equal(isSecretCell(null, 'Value'), false);
});

/* ============================================================================================== *
 * Collection integrity
 * ============================================================================================== */

test('every handler the collection declares actually runs', async () => {
  const handlers = {
    age_date: { dateOfBirth: '2000-01-01' },
    date_duration: { action: 'difference', startDate: '2026-01-01', endDate: '2026-02-01' },
    percentage: { action: 'change', from: '100', to: '150' },
    unit_data: { amount: '1', fromUnit: 'GiB', toUnit: 'MB' },
    unix_timestamp: { action: 'now' },
    mrz_generate: specimenInput('TD3'),
    qr_generate: { text: 'https://example.com' },
    uuid: { version: 'v4', count: '1' },
    password_generate: { kind: 'password', length: '20', lowercase: 'yes' },
    api_key_generate: { length: '32', count: '1' },
    checksum_hash: { source: 'text', text: 'x', algorithm: 'sha256' },
    base64: { op: 'encode', text: 'x' },
    json_format: { action: 'validate', text: '{}' },
    http_security_headers: { server: 'nginx' },
    password_policy: { minLength: '14' },
    dns_record_generate: { domain: 'example.com', defaultTtl: '3600', aRecords: '@ = 203.0.113.10' },
    robots: { agent: '*', disallow: '/admin/' },
  };
  assert.equal(Object.keys(handlers).length, 17, 'the collection is 5 calculators + 12 generators');
  for (const [handler, input] of Object.entries(handlers)) {
    const result = await runLocal(handler, input);
    assert.equal(result.ok, true, `${handler} failed: ${result.error}`);
    assert.ok(result.rows.length > 0, `${handler} returned no rows`);
    assert.match(notes(result), /browser|uploaded|local/i, `${handler} does not say where it processed the input`);
  }
});

test('an unknown handler is refused rather than returning invented output', async () => {
  const result = await runLocal('not_a_real_tool', {});
  assert.equal(result.ok, false);
  assert.match(result.error, /not implemented/);
});
