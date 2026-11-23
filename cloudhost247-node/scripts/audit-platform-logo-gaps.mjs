#!/usr/bin/env node
/** Keep the missing-logo queue in sync with the real catalogue and inline registry. */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(project, '..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');

// The same JSON is used by the paginated API and the browser's offline fallback.
// Avoid loading browser code (or running the API) to audit its source-of-truth slugs.
const catalogue = JSON.parse(read('cloudhost247-node/shared/platform-catalog.json'));
const manifest = JSON.parse(read('cloudhost247-node/frontend/src/data/platform-logo-sources.json'));
const logoSource = read('cloudhost247-node/frontend/src/components/PlatformLogo.tsx');
const inlineSection = logoSource.split('const MARKS: Record<string, Mark> = {')[1]?.split('\n};\n\nconst KNOWN')[0];
if (!inlineSection) throw new Error('Cannot find PlatformLogo inline mark registry');
const inline = [...inlineSection.matchAll(/^  ([a-z0-9-]+): \{$/gm)].map((match) => match[1]);
const sourced = Object.keys(manifest.icons);
const slugSet = new Set(catalogue.map(({ slug }) => slug));
if (slugSet.size !== catalogue.length || new Set(inline).size !== inline.length ||
    sourced.some((slug) => !slugSet.has(slug) || inline.includes(slug)) || inline.length !== 14) {
  throw new Error('Duplicate, unknown, or overlapping logo/catalogue slugs');
}
const present = new Set([...sourced, ...inline]);
const missing = catalogue.filter(({ slug }) => !present.has(slug)).sort((a, b) => a.slug.localeCompare(b.slug, 'en'));
const content = `# Platform SVG logos pending review

**${missing.length.toLocaleString('en-US')} of ${catalogue.length.toLocaleString('en-US')} catalogue entries** still need a sourced, recognisable, code-rendered project logo. This is a work queue, **not** a claim that these projects have no logos. In the UI, “SVG pending” means *our verified SVG rendition* has not been finished. We show neither an invented monogram nor an image element in its place.

An exact filename match can depict a different product (e.g. Yarnpkg instead of Yarn.social, the Phoenix Elixir framework instead of Arize Phoenix, or Cap.so instead of the Cap CAPTCHA). Check the product identity, original artwork and reuse terms before admitting a source. For raster-only originals, compare the generated path trace at tile and detail size; never embed a PNG inside an SVG.

**Known blockers:** ZNC's available PNG trace damages its distinctive letters and metallic shading. Firefly's first-party moth graphic is published for personal use only. [Atomic Server's brand licence](https://github.com/ontola/atomic-server/blob/2a9024008cc25462d40ae4566f99f2d1430e1ebb/brand/LICENSE) reserves commercial use of its marks as selling features, despite the MIT software licence. Canarytokens has a distinctive first-party vector, but its [GPL with special clarifications](platform-logo-licenses/Canarytokens-LICENSE.txt) explicitly discusses integrating covered content into proprietary software; this artwork remains pending rights clarification rather than being copied from Hostinger's gallery. [Plone's mark policy](https://plone.org/foundation/copyright-licensing-logo/policy) calls for an agreement for commercial use; the [WireGuard logo policy](https://www.wireguard.com/trademark-policy/) disallows commercial use absent authorisation, including its use by the WireGuard Easy interface. Budge's repository includes a React boilerplate atom, Auto Ontology's favicon is NVIDIA's parent-company mark, and Apache JSPWiki's site favicon is the generic ASF feather; none is a project-specific substitute. Several compound installers have no single vendor-supplied composite brand. Do not infer trademark permission from an open-source code license. See [the sourcing audit](platform-logo-coverage.md).

| Catalogue slug | Display name |
| --- | --- |
${missing.map(({ slug, name }) => `| \`${slug}\` | ${name.replace(/\|/g, '\\|')} |`).join('\n')}
`;
const output = path.join(root, 'docs/platform-logo-gaps.md');
if (process.argv.includes('--check')) {
  if (readFileSync(output, 'utf8') !== content) throw new Error(`Stale ${output}; run npm run logos:gaps`);
  console.log(`Verified ${missing.length} pending logos (${present.size}/${catalogue.length} sourced).`);
} else {
  writeFileSync(output, content);
  console.log(`Wrote ${missing.length} pending logos (${present.size}/${catalogue.length} sourced).`);
}
