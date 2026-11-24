#!/usr/bin/env node
/** Keep the missing-logo queue in sync with the real catalogue and inline registry. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSafeOriginalSvg } from './lib/original-svg.mjs';

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
const originals = JSON.parse(read('cloudhost247-node/frontend/src/data/platform-original-logos.json'));
for (const [slug, asset] of Object.entries(originals)) {
  if (!slugSet.has(slug) || sourced.includes(slug) || inline.includes(slug)) throw new Error('Invalid original logo slug: ' + slug);
  if (!/^\/platform-originals\/[a-z0-9-]+\.(png|webp|ico|jpg|svg)$/.test(asset.url)) throw new Error('Invalid local logo path');
  const bytes = readFileSync(path.join(project, 'frontend/public', asset.url));
  if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error('Original logo hash mismatch: ' + slug);
  if (asset.url.endsWith('.svg')) assertSafeOriginalSvg(bytes.toString(), asset.allowEmbeddedPng === true);
}
const present = new Set([...sourced, ...inline, ...Object.keys(originals)]);
const bundleManifest = JSON.parse(read('cloudhost247-node/frontend/src/data/platform-bundle-logos.json'));
for (const [id, component] of Object.entries(bundleManifest.components)) {
  if (!/^[a-z0-9-]+$/.test(id) || !/^\/platform-components\/[a-z0-9-]+\.(svg|png)$/.test(component.url)) throw new Error('Invalid component path: ' + id);
  const bytes = readFileSync(path.join(project, 'frontend/public', component.url));
  if (createHash('sha256').update(bytes).digest('hex') !== component.sha256) throw new Error('Component hash mismatch: ' + id);
  if (component.url.endsWith('.svg') && /<(?:script|image|foreignObject)\b|\bon\w+\s*=|(?:href|src)\s*=/i.test(bytes.toString())) throw new Error('Unsafe component SVG: ' + id);
}
for (const [slug, ids] of Object.entries(bundleManifest.bundles)) {
  if (!slugSet.has(slug) || present.has(slug) || ids.length < 2 || ids.length > 4 || new Set(ids).size !== ids.length || ids.some(id => !Object.hasOwn(bundleManifest.components, id))) throw new Error('Invalid component bundle: ' + slug);
  present.add(slug);
}
const missing = catalogue.filter(({ slug }) => !present.has(slug)).sort((a, b) => a.slug.localeCompare(b.slug, 'en'));
const content = `# Platform logos pending review

**${missing.length.toLocaleString('en-US')} of ${catalogue.length.toLocaleString('en-US')} catalogue entries** still need sourced project artwork or an approved component-mark presentation. This is a work queue, **not** a claim that these projects have no logos. In the UI, user-approved first-two-letter badges identify these entries; they are not official logos and do not count as sourced artwork. Original local artwork and user-approved, separately labelled component marks for bundles are supported as pinned local files; unresolved entries are not filled with invented marks.

An exact filename match can depict a different product (e.g. Yarnpkg instead of Yarn.social, the Phoenix Elixir framework instead of Arize Phoenix, or Cap.so instead of the Cap CAPTCHA). Check the product identity, original artwork and reuse terms before admitting a source. For raster-only originals, preserve the original local file and verify its hash and identity; do not trace away details or embed PNGs inside SVGs.

**Rights and identity caveats:** Visual coverage is not legal clearance. Firefly, Atomic Server, Canarytokens, Plone and Svix now have identified artwork in the preview, but their restrictive or unresolved terms remain documented in the manifest and source notices; no commercial permission has been obtained. See [the ten-asset ledger](platform-logo-verified-ten.md) before production publication. The [WireGuard logo policy](https://www.wireguard.com/trademark-policy/) disallows commercial use absent authorisation; WireGuard Easy remains pending. Budge's React boilerplate icon and Auto Ontology's NVIDIA parent-company mark are not project-specific substitutes. Fourteen compound installers use approved separately labelled component marks. Do not infer trademark permission from software licences. See [the sourcing audit](platform-logo-coverage.md).

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
