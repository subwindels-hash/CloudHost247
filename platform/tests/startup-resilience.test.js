'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('../src/core/config');

test('VPS startup resilience in platform/', async (t) => {
  await t.test('accepts a Unix domain socket path in PORT without throwing', () => {
    const { config } = loadConfig({
      envPath: path.join(__dirname, 'nonexistent.env'),
      overrides: {
        NODE_ENV: 'production',
        PORT: '/run/cloudhost247/platform.sock',
        APP_URL: 'try.vortexprecisionit.com',
      },
    });
    assert.equal(config.SOCKET_PATH, '/run/cloudhost247/platform.sock');
    assert.equal(config.PORT, 3000);
    assert.equal(config.APP_URL, 'https://try.vortexprecisionit.com');
  });

  await t.test('does not ship any retired Apache/cPanel .htaccess file', () => {
    assert.equal(fs.existsSync(path.join(__dirname, '..', '.htaccess')), false);
  });
});
