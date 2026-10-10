#!/usr/bin/env node
/** Manifest-derived presentation only. A manifest or mark is never provisioning availability. */
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '../../cloudhost247-node/node_modules/yaml/dist/index.js';
const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const escape = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const apps = readdirSync(join(root, 'cloudhost247-node/manifests')).sort().map(slug => {
  const m = parse(readFileSync(join(root, 'cloudhost247-node/manifests', slug, 'manifest.yaml'), 'utf8'));
  if (m.id !== slug) throw new Error(`Manifest id mismatch: ${slug}`);
  const initials = m.name.split(/[\s-]+/).slice(0,2).map(s=>s[0]).join('').toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" width="80" height="80"><title>${escape(m.name)} — neutral CloudHost247 software mark</title><rect x="1" y="1" width="78" height="78" rx="18" fill="#101e2c"/><path d="M12 58h56M12 64h36" stroke="#7ff0b4" stroke-width="2" opacity=".5"/><text x="40" y="45" text-anchor="middle" font-family="Arial,sans-serif" font-size="25" font-weight="700" fill="#b4f2cd">${escape(initials)}</text></svg>\n`;
  for (const base of ['assets/images/cloudhost247/applications/marks','cloudhost247-node/frontend/public/media/cloudhost247/applications/marks']) {
    mkdirSync(join(root,base),{recursive:true}); writeFileSync(join(root,base,`${slug}.svg`),svg);
  }
  return { slug, name:m.name, category:m.category, description:m.description, versions:(m.versions||[]).map(v=>v.version), deployment:m.deployment.engine, requirements:m.requirements, relatedHosting:m.supportedHostingTypes, documentation:m.documentation||'', status:'Manifest available; deployment requires an eligible configured service', mark:`applications/marks/${slug}.svg` };
});
writeFileSync(join(root,'modules/addons/cloudhost247_theme/resources/applications.json'),JSON.stringify({source:'cloudhost247-node/manifests/*/manifest.yaml',availability:'Documentation only; query the live platform for deployment eligibility',apps},null,2)+'\n');
writeFileSync(join(root,'assets/images/cloudhost247/applications/marks/README.md'),'# Neutral application marks\n\nGenerated from all shipped application manifests by `node scripts/site/catalogue-visuals.mjs`. Original CloudHost247 monograms, not official vendor logos. Names identify software only; no affiliation, endorsement or provisioning availability is implied. Unknown future applications retain a local monogram fallback.\n');
console.log(`${apps.length} manifest records and neutral marks generated for both surfaces.`);
