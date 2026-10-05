#!/usr/bin/env node
/**
 * Post-processing cleanup for the extracted legacy prose embedded in the
 * regenerated PHP policy pages. Removes the artifacts left where Smarty
 * variables were stripped: empty tags, hollow contact blocks and duplicated
 * footer notes. Runs repeatedly; leaves clean files untouched.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const targets = [
  'terms-of-service.php',
  'privacy-policy.php',
  'cookie-policy.php',
  'domain-agreement.php',
  'data-privacy-notice-and-consent-form.php',
  'domainregistrationaddendum.php',
  'domain-renewal-policy.php',
  'fair-usage-policy.php',
  'legal-notice.php',
  'refund-and-cancellation-policy.php',
];

/** Remove balanced tag blocks matching tagName that contain only whitespace. */
function removeEmptyBlocks(html, tagName) {
  const re = new RegExp(`<${tagName}(\\s[^>]*)?>[\\s\\S]*?<\\/${tagName}>`, 'g');
  let prev;
  let out = html;
  do {
    prev = out;
    out = out.replace(re, (m, attrs, offset) => {
      const inner = m.slice(m.indexOf('>') + 1, m.lastIndexOf('<'));
      return inner.trim() === '' ? '' : m;
    });
  } while (out !== prev);
  return out;
}

for (const file of targets) {
  const p = path.join(ROOT, file);
  let src = fs.readFileSync(p, 'utf8');
  const before = src;

  // Un-escape so we can process the embedded HTML, then re-embed.
  const m = src.match(/^\$prose = "/m);
  if (!m) {
    console.log(`skip ${file} (no embedded prose)`);
    continue;
  }

  let prose = src.slice(src.indexOf('"') + 1);
  // Terminator: an UNESCAPED quote followed by ; — avoids matching \" inside the string.
  const endIdx = prose.search(/(?<!\\)";\s*\n/);
  if (endIdx === -1) {
    console.log(`skip ${file} (cannot locate end of prose)`);
    continue;
  }
  const tail = prose.slice(endIdx); // includes the closing ";
  prose = prose.slice(0, endIdx);

  // Decode the PHP double-quoted string escapes we generated.
  prose = prose
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .replace(/\\\$/g, '$');

  // 1) Company name placeholders.
  prose = prose.replace(/<strong>\s*<\/strong>/g, '<strong>CloudHost247 Isc.</strong>');
  prose = prose.replace(/(owned by|hold harmless|To the maximum extent permitted by law,)\s{2,}/g, '$1 CloudHost247 Isc. ');
  prose = prose.replace(/(owned by|hold harmless)\s+or our licensors/g, '$1 CloudHost247 Isc. or our licensors');

  // 2) Hollow contact block left by stripped contact variables.
  prose = removeEmptyBlocks(prose, 'a');
  prose = prose.replace(/<div class="contact-block">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g, '');
  // Generic sweep for the leftover contact-item scaffolding.
  prose = prose.replace(/<div class="contact-item">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*<\/div>/g, '');

  // 3) Footer meta with empty dates / duplicated governing-law lines.
  prose = prose.replace(/<div class="terms-footer-meta">[\s\S]*?<\/div>/g, '');
  prose = prose.replace(/<p class="jurisdiction">[\s\S]*?<\/p>/g, '');

  // 4) Generic empty-element sweep (multiple passes for nesting).
  for (const tag of ['span', 'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'strong', 'a', 'i']) {
    prose = removeEmptyBlocks(prose, tag);
  }
  prose = prose.replace(/<i class="[^"]*"[^>]*>\s*<\/i>/g, '');

  // 5) Collapse whitespace runs.
  prose = prose.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');

  // Re-encode as a PHP double-quoted string literal.
  const encoded = JSON.stringify(prose).replace(/\$/g, '\\$');
  src = src.slice(0, src.indexOf('"')) + encoded + tail.slice(1);

  if (src !== before) {
    fs.writeFileSync(p, src);
    console.log(`cleaned ${file}`);
  } else {
    console.log(`already clean ${file}`);
  }
}
