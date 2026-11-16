/** Build-time projection of the authoritative registry; never runtime availability data. */
import fs from 'node:fs';
import path from 'node:path';
import {
  TOOL_CATALOG,
  DISCOVERY_CATEGORIES,
  TOOLS_FOOTER,
} from '../src/tools/catalog';
const output = path.resolve(
  __dirname,
  '../../modules/addons/cloudhost247_theme/resources/tools.json'
);
const data = {
  generatedFrom: 'cloudhost247-node/src/tools/catalog.ts',
  categories: DISCOVERY_CATEGORIES,
  footer: TOOLS_FOOTER,
  tools: TOOL_CATALOG.map(
    ({
      slug,
      name,
      category,
      summary,
      description,
      icon,
      path,
      apiPath,
      authRequired,
      visibility,
      legacyPaths,
      discoveryCategories,
      seoTitle,
      relatedTools,
      resultMode,
    }) => ({
      slug,
      name,
      category,
      summary,
      description,
      icon,
      path,
      apiPath,
      authRequired,
      visibility,
      legacyPaths,
      discoveryCategories,
      seoTitle,
      relatedTools,
      resultMode,
    })
  ),
};
const serialized = JSON.stringify(data, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (!fs.existsSync(output)) {
    // ENOENT here is a deployment bug, not a stale projection. The path is
    // ../../modules/... — a REPO-root location — so this only resolves when the
    // cwd's parent contains the WHMCS theme. Building from /opt/cloudhost247
    // (which holds only cloudhost247-node/) resolves to /opt/modules and lands
    // here, before build:server has produced any dist/. Say that out loud
    // instead of reporting a stale projection that no command can fix.
    throw new Error(
      `Tools projection target does not exist: ${output}\n` +
        'This path is resolved relative to the repository root, so the build must run in the ' +
        'git checkout (where modules/ and assets/ live), not in a directory that contains only ' +
        'cloudhost247-node/. infrastructure/vps/scripts/deploy.sh builds in the checkout for ' +
        'this reason.'
    );
  }
  if (fs.readFileSync(output, 'utf8') !== serialized)
    throw new Error('Tools projection is stale. Run npm run tools:catalog.');
} else {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, serialized);
}
console.log(
  `${data.tools.length} tool entries; projection ${process.argv.includes('--check') ? 'verified' : 'written'}.`
);
