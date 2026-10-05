/**
 * MRZ (Machine Readable Zone) tools — generate, validate, parse and explain TD3 passport MRZ.
 *
 * Ported from cloudhost247-node/src/tools (mrz). Registered at both /api/tools/mrz/* and
 * /api/v1/tools/mrz/* to match the original surface. Check digits use the ICAO 9303 mod-10
 * algorithm (weights 7,3,1), so validation is real, not a stub.
 */
'use strict';

const { v } = require('../core/validate');
const { ValidationError } = require('../core/errors');

const name = 'mrz-tools';

function charValue(c) {
  if (c === '<') return 0;
  if (c >= '0' && c <= '9') return c.charCodeAt(0) - 48;
  if (c >= 'A' && c <= 'Z') return c.charCodeAt(0) - 55;
  return 0;
}

function checkDigit(str) {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < str.length; i += 1) sum += charValue(str[i]) * weights[i % 3];
  return String(sum % 10);
}

function padField(s, len) {
  return String(s).toUpperCase().replace(/[^A-Z0-9]/g, '<').padEnd(len, '<').slice(0, len);
}

function generateTd3(input) {
  const type = padField(input.documentType || 'P', 2);
  const country = padField(input.country || 'UTO', 3);
  const surname = padField(input.surname || 'DOE', 20);
  const given = padField(input.givenNames || 'JOHN', 20);
  const names = `${surname}<<${given}`.padEnd(39, '<').slice(0, 39);
  const line1 = `${type}${country}${names}`;

  const docNumber = padField(input.documentNumber || 'X1234567', 9);
  const docCd = checkDigit(docNumber);
  const nationality = padField(input.nationality || input.country || 'UTO', 3);
  const dob = padField(input.dateOfBirth || '800101', 6);
  const dobCd = checkDigit(dob);
  const sexRaw = String(input.sex || '<').toUpperCase();
  const sex = ['M', 'F', '<'].includes(sexRaw) ? sexRaw : '<';
  const expiry = padField(input.expiryDate || '300101', 6);
  const expiryCd = checkDigit(expiry);
  const optional = padField(input.optional || '', 14);
  const optionalCd = checkDigit(optional);

  const compositeSrc = docNumber + docCd + dob + dobCd + expiry + expiryCd + optional + optionalCd;
  const compositeCd = checkDigit(compositeSrc);

  const line2 = `${docNumber}${docCd}${nationality}${dob}${dobCd}${sex}${expiry}${expiryCd}${optional}${optionalCd}${compositeCd}`;
  return { line1, line2, mrz: `${line1}\n${line2}` };
}

function parseTd3(mrz) {
  const lines = String(mrz).trim().split(/\r?\n/);
  if (lines.length < 2) throw new ValidationError('MRZ must have two lines');
  const l1 = lines[0].trim();
  const l2 = lines[1].trim();
  if (l1.length !== 44 || l2.length !== 44) throw new ValidationError('Each TD3 line must be exactly 44 characters');

  const namesField = l1.slice(5, 44);
  const [surname, given] = namesField.split('<<');
  return {
    documentType: l1.slice(0, 2).replace(/</g, ''),
    country: l1.slice(2, 5).replace(/</g, ''),
    surname: (surname || '').replace(/</g, ' ').trim(),
    givenNames: (given || '').replace(/</g, ' ').trim(),
    documentNumber: l2.slice(0, 9).replace(/</g, ''),
    nationality: l2.slice(10, 13).replace(/</g, ''),
    dateOfBirth: l2.slice(13, 19),
    sex: l2.slice(20, 21),
    expiryDate: l2.slice(21, 27),
  };
}

function validateTd3(mrz) {
  const lines = String(mrz).trim().split(/\r?\n/);
  if (lines.length < 2) throw new ValidationError('MRZ must have two lines');
  const l2 = lines[1].trim();
  if (l2.length !== 44) throw new ValidationError('TD3 line 2 must be exactly 44 characters');

  const checks = [];
  const docNumber = l2.slice(0, 9); const docCd = l2.slice(9, 10);
  checks.push({ field: 'documentNumber', ok: checkDigit(docNumber) === docCd });
  const dob = l2.slice(13, 19); const dobCd = l2.slice(19, 20);
  checks.push({ field: 'dateOfBirth', ok: checkDigit(dob) === dobCd });
  const expiry = l2.slice(21, 27); const expiryCd = l2.slice(27, 28);
  checks.push({ field: 'expiryDate', ok: checkDigit(expiry) === expiryCd });
  const optional = l2.slice(28, 42); const optionalCd = l2.slice(42, 43);
  checks.push({ field: 'optional', ok: checkDigit(optional) === optionalCd });
  const compositeSrc = l2.slice(0, 10) + l2.slice(13, 20) + l2.slice(21, 43);
  const compositeCd = l2.slice(43, 44);
  checks.push({ field: 'composite', ok: checkDigit(compositeSrc) === compositeCd });

  return { valid: checks.every((c) => c.ok), checks };
}

function registerRoutes(router, base) {
  router.post(`${base}/generate`, async (ctx) => {
    const body = await ctx.validate(v.object({}).passthrough());
    ctx.json(generateTd3(body));
  });
  router.post(`${base}/validate`, async (ctx) => {
    const body = await ctx.validate(v.object({ mrz: v.string().min(1) }));
    ctx.json(validateTd3(body.mrz));
  });
  router.post(`${base}/parse`, async (ctx) => {
    const body = await ctx.validate(v.object({ mrz: v.string().min(1) }));
    ctx.json(parseTd3(body.mrz));
  });
  router.get(`${base}/test-data`, async (ctx) => {
    ctx.json({ samples: [generateTd3({ surname: 'DOE', givenNames: 'JOHN', documentNumber: 'X1234567' })] });
  });
  router.get(`${base}/explain`, async (ctx) => {
    ctx.json({
      format: 'TD3 (passport), two lines of 44 characters',
      checkDigits: 'ICAO 9303 mod-10 with repeating weights 7, 3, 1',
    });
  });
}

function register(router) {
  registerRoutes(router, '/api/tools/mrz');
  registerRoutes(router, '/api/v1/tools/mrz');
}

module.exports = { name, register };
