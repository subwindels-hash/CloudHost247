/**
 * Generator: parses migration 0043 and writes src/store/seed-data/control-panels.js.
 * Kept for reproducibility; not part of the runtime.
 */
'use strict';
const fs = require('fs');

const { panels, plans } = JSON.parse(fs.readFileSync('/tmp/cp-seed.json', 'utf8'));
const indent = (o) => JSON.stringify(o, null, 2).split('\n').map((l, i) => (i === 0 ? l : '  ' + l)).join('\n');

const header = [
  '/**',
  ' * Seed data for the control-panel marketplace.',
  ' *',
  ' * Generated verbatim from',
  ' * cloudhost247-node/database/migrations/0043_create_control_panels_and_plans.sql so the JSON',
  ' * store starts from exactly the same catalogue the PostgreSQL migrations install.',
  ' *',
  ' * supported_os is a JSON array rather than a SQL TEXT[] because the pg backend serialises',
  ' * structured columns as JSON (see toDriverValue in src/store/pg-store.js).',
  ' */',
  "'use strict';",
  '',
].join('\n');

const body = [
  header,
  `const controlPanels = ${indent(panels)};`,
  '',
  `const controlPanelPlans = ${indent(plans)};`,
  '',
  'module.exports = { controlPanels, controlPanelPlans };',
  '',
].join('\n');

fs.writeFileSync('src/store/seed-data/control-panels.js', body);
console.log('written', body.length, 'bytes');
