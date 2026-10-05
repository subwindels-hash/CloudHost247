/**
 * Spec §28/§59: automated footer + navigation link audit.
 *
 * Builds the static site, then scans EVERY generated page's <header> and
 * <footer> regions and asserts:
 *   - no href is empty or "#"
 *   - every internal link resolves to a generated page or a known SPA route
 *   - no case-mismatched duplicate targets (…/Hosting vs …/hosting)
 *   - no duplicated link pairs inside the footer
 * A future edit that breaks a footer link fails the suite immediately.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'public');

// SPA client-area routes served by the built SPA (platform/src + spa router).
const SPA_PREFIXES = ['/app'];

function collectHtmlFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) collectHtmlFiles(full, out);
    else if (entry.endsWith('.html')) out.push(full);
  }
  return out;
}

function extract(html, openTag, closeTag) {
  const start = html.indexOf(openTag);
  if (start === -1) return '';
  const end = html.indexOf(closeTag, start);
  return html.slice(start, end === -1 ? html.length : end + closeTag.length);
}

function hrefs(fragment) {
  return [...fragment.matchAll(/<a\b[^>]*href="([^"]*)"/gi)].map((m) => m[1]);
}

function resolves(target) {
  if (target === '/') return fs.existsSync(path.join(ROOT, 'index.html'));
  const clean = target.split('#')[0];
  const file = path.join(ROOT, clean.replace(/^\//, ''));
  return fs.existsSync(file) || fs.existsSync(`${file}.html`) || fs.existsSync(path.join(file, 'index.html'));
}

function isSpa(target) {
  return SPA_PREFIXES.some((p) => target === p || target.startsWith(`${p}/`) || target.startsWith(`${p}?`));
}

test('site footer & navigation link audit (spec §28)', async (t) => {
  // Fresh build so the audit always covers the current generator output.
  execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'build-site.cjs')], { stdio: 'pipe' });

  const files = collectHtmlFiles(ROOT);
  assert.ok(files.length >= 40, `expected a full site build, found ${files.length} pages`);

  const problems = [];
  const globalTargets = new Map(); // lowercase target -> original spelling

  await t.test('every header/footer link is valid and resolves', () => {
    for (const file of files) {
      const rel = path.relative(ROOT, file);
      const html = fs.readFileSync(file, 'utf8');
      if (html.includes('http-equiv="refresh"')) continue; // redirect stubs have no chrome
      const regions = { header: extract(html, '<header', '</header>'), footer: extract(html, '<footer', '</footer>') };
      for (const [region, fragment] of Object.entries(regions)) {
        assert.ok(fragment.length > 0, `${rel}: missing <${region}> region`);
        for (const href of hrefs(fragment)) {
          if (href.trim() === '' || href === '#') {
            problems.push(`${rel} ${region}: empty or '#' href`);
            continue;
          }
          if (/^(https?:|mailto:|tel:)/.test(href)) continue;
          const target = href.split('#')[0].split('?')[0] || '/';
          if (!resolves(target) && !isSpa(target)) {
            problems.push(`${rel} ${region}: ${href} does not resolve`);
          }
          const lower = target.toLowerCase();
          if (globalTargets.has(lower) && globalTargets.get(lower) !== target) {
            problems.push(`case mismatch: '${globalTargets.get(lower)}' vs '${target}'`);
          } else {
            globalTargets.set(lower, target);
          }
        }
      }
    }
    assert.deepEqual(problems, [], `broken nav/footer links:\n${problems.join('\n')}`);
  });

  await t.test('footer contains the full spec structure and no duplicate pairs', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const footer = extract(html, '<footer', '</footer>');
    for (const col of ['Products', 'Cloud & Servers', 'Domains', 'Developers', 'Resources', 'Company', 'Legal']) {
      assert.ok(footer.includes(`<h3>${col}</h3>`), `footer missing column: ${col}`);
    }
    for (const required of ['Terms of Service', 'Privacy Policy', 'Cookie Policy', 'Acceptable Use', 'Refund Policy', 'SLA', 'Domain Brokerage', 'Server Management', 'Operating Systems', 'Control Panels', 'Application Deployment']) {
      assert.ok(footer.includes(required), `footer missing link: ${required}`);
    }
    assert.match(footer, /CloudHost247 Isc\./, 'footer must show the legal entity name');
    // Duplicates ACROSS columns are allowed (e.g. Public Cloud and Private Cloud
    // both canonicalize to the cloud page); duplicates WITHIN one column are bugs.
    for (const navBlock of footer.split('<nav aria-label=').slice(1)) {
      const seen = new Set();
      for (const href of hrefs(navBlock.slice(0, navBlock.indexOf('</nav>')))) {
        const key = href.toLowerCase();
        assert.ok(!seen.has(key), `duplicate link inside one footer column: ${href}`);
        seen.add(key);
      }
    }
  });
});
