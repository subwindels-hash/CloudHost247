/**
 * Integration tests for the MRZ tool surface (mrz-tools.ts): the public config endpoint, the
 * POST test-data and explain endpoints, and the super-admin settings pair.
 *
 * The module's central promise is privacy: it is stateless, never stores submitted MRZ data, and
 * the privacy switches are locked on. These tests check that promise rather than just the shapes.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, jsonFetch, register } = require('./helpers');

const BOTH_PREFIXES = ['/api/v1', '/api'];

async function adminToken(base, app, email = 'mrz-admin@example.com') {
  await register(base, email, 'SuperSecret123!');
  const user = await app.store.table('users').findOne({ email });
  await app.store.table('users').updateById(user.id, { role: 'super_admin' });
  const login = await jsonFetch(base, {
    path: '/api/v1/auth/login', method: 'POST', body: { email, password: 'SuperSecret123!' },
  });
  return login.data.accessToken;
}

test('integration: mrz config endpoint', async (t) => {
  const { base, close } = await startServer();
  try {
    await t.test('the config is public on both prefixes and marked no-store', async () => {
      for (const prefix of BOTH_PREFIXES) {
        const res = await jsonFetch(base, { path: `${prefix}/tools/mrz/config` });
        assert.strictEqual(res.status, 200, `${prefix} is public`);
        assert.strictEqual(res.data.calculatorEnabled, true);
        assert.strictEqual(res.data.parserEnabled, true);
        assert.strictEqual(res.data.testDataEnabled, true);
        assert.strictEqual(res.data.availability, 'public');
        assert.deepStrictEqual(res.data.supportedFormats, ['TD3']);
        assert.strictEqual(res.data.privacyFirst, true);
        assert.strictEqual(res.data.persistSubmittedData, false, 'never persisted');
        assert.match(res.headers.get('cache-control'), /no-store/);
        assert.strictEqual(res.headers.get('x-robots-tag'), 'noindex, nofollow');
      }
    });
  } finally {
    await close();
  }
});

test('integration: mrz synthetic test data', async (t) => {
  const { base, app, close } = await startServer();
  try {
    await t.test('POST returns a labelled synthetic specimen on both prefixes', async () => {
      for (const prefix of BOTH_PREFIXES) {
        const res = await jsonFetch(base, {
          path: `${prefix}/tools/mrz/test-data`, method: 'POST', body: {},
        });
        assert.strictEqual(res.status, 200, `${prefix}`);
        assert.strictEqual(res.data.success, true);
        assert.strictEqual(res.data.synthetic, true);
        assert.match(res.data.label, /SYNTHETIC TEST DATA/);
        assert.ok(res.data.authenticityNotice, 'the authenticity notice is always attached');
        assert.ok(res.data.mrz, 'a full MRZ is produced');

        const lines = res.data.mrz.split('\n');
        assert.strictEqual(lines.length, 2);
        assert.strictEqual(lines[0].length, 44);
        assert.strictEqual(lines[1].length, 44);

        // Reserved ICAO test codes only — never a plausible real state.
        assert.ok(['UTO', 'XXA'].includes(res.data.fields.issuingState));
        assert.match(res.data.fields.documentNumber, /^(TEST|SPEC|MOCK)\d{5}$/);
      }
    });

    await t.test('the generated specimen passes its own validator', async () => {
      const specimen = await jsonFetch(base, { path: '/api/v1/tools/mrz/test-data', method: 'POST', body: {} });
      const validated = await jsonFetch(base, {
        path: '/api/v1/tools/mrz/validate', method: 'POST', body: { mrz: specimen.data.mrz },
      });
      assert.strictEqual(validated.status, 200);
      assert.strictEqual(validated.data.valid, true, 'check digits are genuine, not stubbed');
    });

    await t.test('seedIndex selects a specimen deterministically', async () => {
      const a = await jsonFetch(base, { path: '/api/v1/tools/mrz/test-data', method: 'POST', body: { seedIndex: 2 } });
      const b = await jsonFetch(base, { path: '/api/v1/tools/mrz/test-data', method: 'POST', body: { seedIndex: 2 } });
      assert.strictEqual(a.data.fields.surname, 'DEVELOPER TEST');
      assert.strictEqual(a.data.fields.sex, 'M');
      assert.strictEqual(b.data.mrz, a.data.mrz, 'same seed, same specimen');

      const wrapped = await jsonFetch(base, { path: '/api/v1/tools/mrz/test-data', method: 'POST', body: { seedIndex: 6 } });
      assert.strictEqual(wrapped.data.fields.surname, 'DEVELOPER TEST', '6 % 4 wraps to the same specimen');
    });

    await t.test('the body is validated and the GET alias still works', async () => {
      const bad = await jsonFetch(base, {
        path: '/api/v1/tools/mrz/test-data', method: 'POST', body: { seedIndex: 5000 },
      });
      assert.strictEqual(bad.status, 400);

      const alias = await jsonFetch(base, { path: '/api/v1/tools/mrz/test-data' });
      assert.strictEqual(alias.status, 200, 'the platform GET alias is preserved');
      assert.ok(Array.isArray(alias.data.samples));
    });

    await t.test('a tool can be disabled by an administrator', async () => {
      const admin = await adminToken(base, app);
      const off = await jsonFetch(base, {
        path: '/api/v1/admin/tools/mrz/settings', method: 'PUT', body: { testDataEnabled: false },
      }, admin);
      assert.strictEqual(off.status, 200);
      assert.strictEqual(off.data.settings.testDataEnabled, false);

      const blocked = await jsonFetch(base, {
        path: '/api/v1/tools/mrz/test-data', method: 'POST', body: {},
      });
      assert.strictEqual(blocked.status, 403);
      assert.match(blocked.data.message, /disabled by an administrator/);

      // The calculator and parser are untouched, and the public config reflects the change.
      const config = await jsonFetch(base, { path: '/api/v1/tools/mrz/config' });
      assert.strictEqual(config.data.testDataEnabled, false);
      assert.strictEqual(config.data.calculatorEnabled, true);

      await jsonFetch(base, {
        path: '/api/v1/admin/tools/mrz/settings', method: 'PUT', body: { testDataEnabled: true },
      }, admin);
    });
  } finally {
    await close();
  }
});

test('integration: mrz AI explanation', async (t) => {
  const { base, close } = await startServer();
  try {
    await t.test('POST explain returns sections and the authenticity disclaimer', async () => {
      for (const prefix of BOTH_PREFIXES) {
        const res = await jsonFetch(base, { path: `${prefix}/tools/mrz/explain`, method: 'POST', body: {} });
        assert.strictEqual(res.status, 200, `${prefix}`);
        assert.strictEqual(res.data.success, true);

        const explanation = res.data.explanation;
        assert.strictEqual(explanation.topic, 'overview');
        assert.strictEqual(explanation.authenticityVerified, false);
        assert.ok(explanation.authenticityDisclaimer, 'the disclaimer is always present');
        assert.ok(Array.isArray(explanation.sections) && explanation.sections.length > 0);
        assert.ok(explanation.sections.some((s) => /Authenticity vs\. Mathematical Validity/.test(s.heading)));
        assert.ok(explanation.sections.every((s) => s.heading && s.body));
      }
    });

    await t.test('a valid MRZ produces a field-by-field breakdown', async () => {
      const specimen = await jsonFetch(base, { path: '/api/v1/tools/mrz/test-data', method: 'POST', body: { seedIndex: 1 } });
      const res = await jsonFetch(base, {
        path: '/api/v1/tools/mrz/explain', method: 'POST',
        body: { topic: 'fields', mrz: specimen.data.mrz },
      });
      assert.strictEqual(res.data.explanation.topic, 'fields');
      const headings = res.data.explanation.sections.map((s) => s.heading);
      assert.ok(headings.includes('Field-by-Field Breakdown of Current MRZ'));
      assert.ok(headings.includes('Check Digit Verification (7-3-1 Modulo 10 Analysis)'));
    });

    await t.test('a tampered MRZ explains which check digit failed', async () => {
      const specimen = await jsonFetch(base, { path: '/api/v1/tools/mrz/test-data', method: 'POST', body: { seedIndex: 0 } });
      const lines = specimen.data.mrz.split('\n');
      // Flip the first character of the document number without fixing its check digit.
      lines[1] = (lines[1][0] === 'T' ? 'S' : 'T') + lines[1].slice(1);

      const res = await jsonFetch(base, {
        path: '/api/v1/tools/mrz/explain', method: 'POST', body: { mrz: lines.join('\n') },
      });
      const headings = res.data.explanation.sections.map((s) => s.heading);
      assert.ok(headings.includes('Why Check Digit Validation Failed (7-3-1 Modulo 10 Analysis)'));
    });

    await t.test('input errors are explained back', async () => {
      const res = await jsonFetch(base, {
        path: '/api/v1/tools/mrz/explain', method: 'POST',
        body: { inputErrors: [{ field: 'surname', code: 'UNSUPPORTED_CHARACTER', message: 'is not representable.' }] },
      });
      const heading = res.data.explanation.sections.find((s) => s.heading === 'Why the Input Was Rejected');
      assert.ok(heading);
      assert.match(heading.body, /surname/);
      assert.match(heading.body, /UNSUPPORTED_CHARACTER/);
    });

    await t.test('the GET alias still works', async () => {
      const res = await jsonFetch(base, { path: '/api/v1/tools/mrz/explain' });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.format, 'TD3 (passport), two lines of 44 characters');
    });
  } finally {
    await close();
  }
});

test('integration: mrz admin settings', async (t) => {
  const { base, app, close } = await startServer();
  try {
    const admin = await adminToken(base, app);
    const customer = (await register(base, 'mrz-cust@example.com')).data.accessToken;

    await t.test('the settings pair is admin-only on both prefixes', async () => {
      for (const prefix of BOTH_PREFIXES) {
        assert.strictEqual((await jsonFetch(base, { path: `${prefix}/admin/tools/mrz/settings` })).status, 401);
        assert.strictEqual((await jsonFetch(base, { path: `${prefix}/admin/tools/mrz/settings` }, customer)).status, 403);

        const res = await jsonFetch(base, { path: `${prefix}/admin/tools/mrz/settings` }, admin);
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.data.settings.rateLimitPerMinute, 60, 'defaults apply');
        assert.strictEqual(res.data.settings.loggingLevel, 'none');
        assert.strictEqual(res.data.settings.privacyProtectionLocked, true);
      }
    });

    await t.test('PUT persists changes and audits them', async () => {
      const res = await jsonFetch(base, {
        path: '/api/v1/admin/tools/mrz/settings', method: 'PUT',
        body: { rateLimitPerMinute: 120, availability: 'authenticated', loggingLevel: 'errors_only' },
      }, admin);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.settings.rateLimitPerMinute, 120);
      assert.strictEqual(res.data.settings.availability, 'authenticated');
      assert.strictEqual(res.data.settings.loggingLevel, 'errors_only');

      const reread = await jsonFetch(base, { path: '/api/v1/admin/tools/mrz/settings' }, admin);
      assert.strictEqual(reread.data.settings.rateLimitPerMinute, 120, 'the change is durable');

      const auditRow = await app.store.table('audit_logs').findOne({ action: 'tools.mrz.settings_updated', entity_id: 'tools.mrz' });
      assert.ok(auditRow, 'the change is audited');
      assert.strictEqual(auditRow.entity_type, 'platform_setting');
      assert.strictEqual(auditRow.after['tools.mrz.rate_limit_per_minute'], 120);
    });

    await t.test('authenticated mode closes the tool to anonymous callers', async () => {
      const anon = await jsonFetch(base, { path: '/api/v1/tools/mrz/explain', method: 'POST', body: {} });
      assert.strictEqual(anon.status, 401);

      const signed = await jsonFetch(base, { path: '/api/v1/tools/mrz/explain', method: 'POST', body: {} }, customer);
      assert.strictEqual(signed.status, 200, 'a signed-in customer is allowed');
    });

    await t.test('error-only logging records failures, not successes', async () => {
      const before = (await app.store.table('audit_logs').find({ entity_type: 'tool_mrz' })).rows.length;

      await jsonFetch(base, { path: '/api/v1/tools/mrz/explain', method: 'POST', body: {} }, customer);
      const afterSuccess = (await app.store.table('audit_logs').find({ entity_type: 'tool_mrz' })).rows.length;
      assert.strictEqual(afterSuccess, before, 'a success is not logged in errors_only mode');
    });

    await t.test('privacy protections cannot be disabled', async () => {
      for (const body of [
        { disablePrivacy: true },
        { persistSubmittedData: true },
        { logSensitiveMrzData: true },
        { privacyProtectionLocked: false },
      ]) {
        const res = await jsonFetch(base, {
          path: '/api/v1/admin/tools/mrz/settings', method: 'PUT', body,
        }, admin);
        assert.strictEqual(res.status, 400, `${JSON.stringify(body)} must be refused`);
        assert.match(res.data.message, /Privacy protections for the MRZ tool are mandatory/);
      }

      const settings = await jsonFetch(base, { path: '/api/v1/admin/tools/mrz/settings' }, admin);
      assert.strictEqual(settings.data.settings.privacyProtectionLocked, true);
      assert.strictEqual(settings.data.settings.persistSubmittedData, false);
      assert.strictEqual(settings.data.settings.logSensitiveMrzData, false);
    });

    await t.test('the settings body is validated', async () => {
      assert.strictEqual(
        (await jsonFetch(base, { path: '/api/v1/admin/tools/mrz/settings', method: 'PUT', body: { rateLimitPerMinute: 0 } }, admin)).status,
        400,
      );
      assert.strictEqual(
        (await jsonFetch(base, { path: '/api/v1/admin/tools/mrz/settings', method: 'PUT', body: { rateLimitPerMinute: 601 } }, admin)).status,
        400,
      );
      assert.strictEqual(
        (await jsonFetch(base, { path: '/api/v1/admin/tools/mrz/settings', method: 'PUT', body: { availability: 'nobody' } }, admin)).status,
        400,
      );
    });

    await t.test('script and control characters are rejected in any tool input', async () => {
      // Reopen the tool to anonymous callers: an earlier test left availability as
      // 'authenticated', which would answer 401 before the content guard ever runs.
      await jsonFetch(base, {
        path: '/api/v1/admin/tools/mrz/settings', method: 'PUT', body: { availability: 'public' },
      }, admin);

      const script = await jsonFetch(base, {
        path: '/api/v1/tools/mrz/explain', method: 'POST',
        body: { question: '<script>alert(1)</script>' },
      });
      assert.strictEqual(script.status, 400);
      assert.match(script.data.message, /disallowed HTML, script, or control characters/);

      const handler = await jsonFetch(base, {
        path: '/api/v1/admin/tools/mrz/settings', method: 'PUT',
        body: { availability: '<img src=x onerror=alert(1)>' },
      }, admin);
      assert.strictEqual(handler.status, 400, 'the guard also covers the admin surface');
    });

    await t.test('an oversized body is refused with 413', async () => {
      const res = await jsonFetch(base, {
        path: '/api/v1/tools/mrz/explain', method: 'POST',
        body: { question: 'x'.repeat(5000) },
      });
      assert.strictEqual(res.status, 413);
      assert.match(res.data.message, /4 KB limit/);
    });
  } finally {
    await close();
  }
});
