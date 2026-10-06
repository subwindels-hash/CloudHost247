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
  if (!fs.existsSync(output) || fs.readFileSync(output, 'utf8') !== serialized)
    throw new Error('Tools projection is stale. Run npm run tools:catalog.');
} else fs.writeFileSync(output, serialized);
console.log(
  `${data.tools.length} tool entries; projection ${process.argv.includes('--check') ? 'verified' : 'written'}.`
);
