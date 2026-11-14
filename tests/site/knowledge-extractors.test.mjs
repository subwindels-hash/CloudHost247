import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { catalogueString, staticStorefrontText } from '../../scripts/site/knowledge-extractors.mjs';

test('catalogue literals preserve escaped quotes, Unicode and multiline field declarations', () => {
  assert.equal(catalogueString("summary: 'A domain\\'s SPF policy.'", 'summary'), "A domain's SPF policy.");
  assert.equal(catalogueString('description:\n  "Use a \\"safe\\" record."'.replaceAll('\\\\', '\\'), 'description'), 'Use a "safe" record.');
  assert.equal(catalogueString("name: 'DNSKEY — lookup'", 'name'), 'DNSKEY — lookup');
  assert.equal(catalogueString('summary: unsafeFunction()', 'summary'), null);
});

test('storefront extraction excludes mutually exclusive prices, runtime values, scripts and directives', () => {
  const text = staticStorefrontText(`<section><h2>Published guidance</h2><p>Read the plan terms.</p><p>{$secret}</p><script><p>leak</p></script></section>
<section>{enabled && <p>Conditional JSX offer</p>}</section>
<section><p>Order at checkout</p>{if $plans}<p>Costs $5</p>{else}<p>No plans available</p>{/if}</section>`);
  assert.match(text, /Published guidance/);
  assert.match(text, /Read the plan terms/);
  assert.doesNotMatch(text, /secret|leak|Costs|No plans|checkout|Conditional JSX/);
});

test('all eight registered custom storefronts contribute real prose, not conditional stock claims', () => {
  const projection = JSON.parse(readFileSync(new URL('../../cloudhost247-node/src/ai-website/content/website-knowledge.generated.json', import.meta.url)));
  for (const slug of ['rdp-hosting', 'smm-services', 'smtp-hosting', 'proxy-services', 'google-workspace', 'office-365', 'number-services', 'digital-products']) {
    const source = projection.documents.find(d => d.sourceKey === `php:${slug}.php`);
    assert.ok(source?.body.length > 300, `${slug} must not be summary-only`);
    assert.doesNotMatch(source.body, /\{\$|\{if\b|\{foreach\b|No proxy plans are published|There are no RDP plans/);
  }
  // The proxy storefront used to carry a hardcoded "coming soon" block; it is catalogue-driven now,
  // so the projection must show the published-plans statement and must not resurrect the old claim.
  const proxy = projection.documents.find(d => d.sourceKey === 'nav:/proxy-services');
  assert.match(proxy.body, /Plans appear here when published in this platform's catalog/);
  assert.doesNotMatch(proxy.body, /Ordering is not yet available|coming soon/i);
  assert.equal(proxy.surface, 'spa');
  const spf = projection.documents.find(d => d.sourceKey === 'tool:/tools/dns/spf');
  assert.match(spf.body, /domain's SPF policy/);
  assert.match(spf.body, /RFC 7208/);
});
