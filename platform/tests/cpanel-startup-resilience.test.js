'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('../src/core/config');

test('cPanel / Passenger startup resilience in platform/', async (t) => {
  await t.test('accepts a Passenger Unix socket path in PORT without throwing', () => {
    const { config } = loadConfig({
      envPath: path.join(__dirname, 'nonexistent.env'),
      overrides: {
        NODE_ENV: 'production',
        PORT: '/tmp/passenger.12345.sock',
        APP_URL: 'try.vortexprecisionit.com',
      },
    });
    assert.equal(config.SOCKET_PATH, '/tmp/passenger.12345.sock');
    assert.equal(config.PORT, 3000);
    assert.equal(config.APP_URL, 'https://try.vortexprecisionit.com');
  });

  await t.test('platform/.htaccess contains no Apache-crashing Passenger directives', () => {
    const htaccess = fs.readFileSync(path.join(__dirname, '..', '.htaccess'), 'utf8');
    assert.doesNotMatch(htaccess, /^\s*Passenger(Enabled|AppRoot|AppType|StartupFile|Nodejs)\b/im);
  });
});
