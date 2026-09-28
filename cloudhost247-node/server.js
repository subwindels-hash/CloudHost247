/**
 * cPanel Passenger / Application Manager startup file.
 *
 * This file is intentionally plain CommonJS JavaScript (not TypeScript) because Passenger
 * launches it directly with the Node.js binary selected in cPanel's "Setup Node.js App" screen —
 * it does not run a build step for you. It loads the compiled application from dist/, which is
 * produced by `npm run build` (see package.json and docs/CPANEL_DEPLOYMENT.md).
 *
 * Do not put application logic in this file. Do not hardcode a port — the real listener is
 * configured in src/server.ts via process.env.PORT.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const compiledEntry = path.join(__dirname, 'dist', 'src', 'server.js');

if (!fs.existsSync(compiledEntry)) {
  // eslint-disable-next-line no-console
  console.error(
    [
      '[server.js] Compiled application not found at dist/src/server.js.',
      'Run "npm run build" (from the application root cPanel configured) before starting/restarting',
      'the Node.js application. See docs/CPANEL_DEPLOYMENT.md.',
    ].join(' ')
  );
  process.exit(1);
}

require(compiledEntry);
