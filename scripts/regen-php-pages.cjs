#!/usr/bin/env node
/**
 * One-shot regeneration of the legacy WHMCS-dependent root PHP pages into
 * professional standalone pages that share the CloudHost247 design system and
 * pull live data from the platform API.
 *
 * Sources preserved:
 *   - hand-authored policy arrays already living in the current root PHP files
 *     (backup, cybercrime, refund, trademark, brokerage terms, FAQs, legal hub)
 *   - prose content inside templates/cloudhost247_legacy/*.tpl
 *
 * Everything else is rebuilt fresh by hand (Group C pages, written separately).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LEGACY = path.join(ROOT, 'templates', 'cloudhost247_legacy');

const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, content) => {
  fs.writeFileSync(p, content);
  console.log('wrote', path.relative(ROOT, p), `(${content.length} bytes)`);
};

/**
 * Embed a JS string as a PHP double-quoted literal. PHP interpolates `$` and
 * backslashes inside double quotes, so both must be escaped; JSON.stringify
 * already handles quotes, newlines and control characters.
 */
const phpString = (value) => JSON.stringify(value).replace(/\$/g, '\\$');

/* ------------------------------------------------------------------ */
/* PHP array extraction (balanced delimiter matching)                  */
/* ------------------------------------------------------------------ */

/** Extract a PHP array literal that starts at the "[" following `needle`. */
function extractPhpArray(source, needle) {
  const idx = source.indexOf(needle);
  if (idx === -1) throw new Error(`needle not found: ${needle}`);
  let i = source.indexOf('[', idx);
  if (i === -1) {
    i = source.indexOf('array(', idx);
    if (i === -1) throw new Error(`no array opener near ${needle}`);
  }
  const opener = source[i] === '[' ? '[' : '(';
  const closer = opener === '[' ? ']' : ')';
  let depth = 0;
  let inString = null;
  for (let j = i; j < source.length; j += 1) {
    const c = source[j];
    const prev = source[j - 1];
    if (inString) {
      if (c === inString && prev !== '\\') inString = null;
      continue;
    }
    if (c === "'" || c === '"') { inString = c; continue; }
    if (c === '/' && source[j + 1] === '/') { j = source.indexOf('\n', j); continue; }
    if (c === '/' && source[j + 1] === '*') { j = source.indexOf('*/', j) + 1; continue; }
    if (c === opener) depth += 1;
    else if (c === closer) {
      depth -= 1;
      if (depth === 0) return source.slice(i, j + 1);
    }
  }
  throw new Error(`unbalanced array for ${needle}`);
}

/* ------------------------------------------------------------------ */
/* Legacy .tpl prose extraction                                        */
/* ------------------------------------------------------------------ */

function stripBetween(html, openRe, closeStr) {
  let out = html;
  for (;;) {
    const m = out.match(openRe);
    if (!m) break;
    const start = m.index;
    const end = out.indexOf(closeStr, start + m[0].length);
    if (end === -1) {
      // Never truncate the document: if the close marker is absent, leave the
      // block in place (a styled leftover div is better than lost content).
      out = out.slice(0, start) + '\n' + out.slice(start + m[0].length);
      out = out.replace(openRe, '<div data-kept="1">');
      break;
    }
    out = out.slice(0, start) + out.slice(end + closeStr.length);
  }
  return out;
}

/** Remove a <div class="..."> block matching classNameRe, using div-depth balancing. */
function stripBalancedDiv(html, classNameRe) {
  const open = html.search(new RegExp('<div class="[^"]*' + classNameRe + '[^"]*">', 'i'));
  if (open === -1) return html;
  let depth = 0;
  let i = open;
  while (i < html.length) {
    const nextOpen = html.indexOf('<div', i);
    const nextClose = html.indexOf('</div>', i);
    if (nextClose === -1) return html.slice(0, open);
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1;
      i = nextOpen + 4;
    } else {
      depth -= 1;
      i = nextClose + 6;
      if (depth === 0) {
        return html.slice(0, open) + html.slice(i);
      }
    }
  }
  return html.slice(0, open);
}

function extractTplProse(tplName, { dropHeroH1 = true } = {}) {
  let html = read(path.join(LEGACY, tplName));

  // Drop comments, style blocks, script blocks.
  html = html.replace(/\{\*[\s\S]*?\*\}/g, '');
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  html = stripBetween(html, /<style[\s>]/i, '</style>');
  html = stripBetween(html, /<script[\s>]/i, '</script>');

  // Drop the banner/hero block — the new shell provides its own page head.
  html = stripBetween(html, /<section class="[^"]*(term-domain_banner|hero-banner|policy-hero|terms-hero)[^"]*">/i, '</section>');
  html = stripBalancedDiv(html, '(term-domain_banner|policy-hero|cpanel_banner|about-us-banner)');

  // Font Awesome glyphs are not loaded on the new site — remove them.
  html = html.replace(/<i class="[^"]*fa[^"]*"[^>]*>\s*<\/i>/g, '');

  // Remaining Smarty variables would print literally; drop the tags.
  html = html.replace(/\{\$[^}]*\}/g, '');
  html = html.replace(/\{\/?[a-z]+[^}]*\}/gi, '');

  // Legacy layout noise that adds nothing semantic.
  html = html.replace(/<div class="[^"]*\b(row|col-sm-\d+|col-md-\d+|section-icon|section-header)\b[^"]*">/g, '<div>');
  html = html.replace(/<span class="[^"]*effective-date[^"]*">/g, '<span class="hint">');

  if (dropHeroH1) {
    html = html.replace(/<h1[\s\S]*?<\/h1>\s*/i, '');
  }

  // Collapse blank-line runs.
  html = html.split('\n').filter((l) => l.trim() !== '').join('\n');
  return html.trim();
}

/* ------------------------------------------------------------------ */
/* PHP page wrappers                                                   */
/* ------------------------------------------------------------------ */

const HEADER = `<?php
/**
 * CloudHost247 — professional standalone page.
 *
 * Shares the platform design system and shows only content that actually
 * exists: either authored policy text preserved from the previous site, or
 * live data pulled from the CloudHost247 platform API.
 */

declare(strict_types=1);

require_once __DIR__ . '/php/bootstrap.php';

`;

function policyPage({ php, varName, title, metaTitle, description, page, active, crumb }) {
  return `${HEADER}${php}

echo ch247_page([
    'title' => ${JSON.stringify(metaTitle)},
    'description' => ${JSON.stringify(description)},
    'canonical' => '${page}',
    'active' => '${active}',
    'crumbs' => [['index.php', 'Home'], [null, ${JSON.stringify(crumb)}]],
], '<section class="section"><div class="container"><div class="card" style="padding:28px">' . ch247_policy_doc(${varName}) . '</div></div></section>');
`;
}

/* ------------------------------------------------------------------ */
/* Group B — pages with preserved PHP arrays                           */
/* ------------------------------------------------------------------ */

function groupB() {
  // backup-policy.php
  const backup = extractPhpArray(read(path.join(ROOT, 'backup-policy.php')), '$backupSections = ');
  write(path.join(ROOT, 'backup-policy.php'), policyPage({
    php: `$backupSections = ${backup};`,
    varName: '$backupSections',
    title: 'Backup Policy',
    metaTitle: 'Backup Policy — Data Protection Practices | CloudHost247',
    description: 'How CloudHost247 approaches backups: provider responsibilities, customer responsibilities, schedules, retention and restore scope.',
    page: 'backup-policy.php', active: 'company', crumb: 'Backup Policy',
  }));

  // cybercrime-policy.php
  const cyber = extractPhpArray(read(path.join(ROOT, 'cybercrime-policy.php')), '$cybercrimeSections = ');
  write(path.join(ROOT, 'cybercrime-policy.php'), policyPage({
    php: `$cybercrimeSections = ${cyber};`,
    varName: '$cybercrimeSections',
    title: 'Cybercrime Detection Policy',
    metaTitle: 'Cybercrime Detection Policy | CloudHost247',
    description: 'How CloudHost247 prevents, detects and reports illegal or fraudulent activity on domains and hosting under its care.',
    page: 'cybercrime-policy.php', active: 'company', crumb: 'Cybercrime Detection Policy',
  }));

  // refund-policy.php
  const refund = extractPhpArray(read(path.join(ROOT, 'refund-policy.php')), '$refundSections = ');
  write(path.join(ROOT, 'refund-policy.php'), policyPage({
    php: `$refundSections = ${refund};`,
    varName: '$refundSections',
    title: 'Refund Policy',
    metaTitle: 'Refund Policy — Terms & Timeframes | CloudHost247',
    description: 'When refunds are available, how to request one, and the timeframes that apply to hosting, domain and service purchases.',
    page: 'refund-policy.php', active: 'company', crumb: 'Refund Policy',
  }));

  // trademark-policy.php
  const trademarkSrc = read(path.join(ROOT, 'trademark-policy.php'));
  const trademark = extractPhpArray(trademarkSrc, '$trademarkSections = ');
  write(path.join(ROOT, 'trademark-policy.php'), policyPage({
    php: `$trademarkSections = ${trademark};`,
    varName: '$trademarkSections',
    title: 'Trademark & Copyright Infringement Policy',
    metaTitle: 'Trademark & Copyright Policy | CloudHost247',
    description: 'How CloudHost247 reviews and responds to trademark and copyright infringement claims, and how rights holders can report concerns.',
    page: 'trademark-policy.php', active: 'company', crumb: 'Trademark & Copyright Policy',
  }));

  // domain-brokerage-terms.php (array() syntax)
  const brokerage = extractPhpArray(read(path.join(ROOT, 'domain-brokerage-terms.php')), '$terms = ');
  write(path.join(ROOT, 'domain-brokerage-terms.php'), policyPage({
    php: `$brokerageTerms = ${brokerage};`,
    varName: '$brokerageTerms',
    title: 'Domain Brokerage Terms',
    metaTitle: 'Domain Brokerage Service Terms | CloudHost247',
    description: 'The terms under which CloudHost247 negotiates the acquisition of already-registered domains on your behalf.',
    page: 'domain-brokerage-terms.php', active: 'domains', crumb: 'Domain Brokerage Terms',
  }));

  // faqs.php — preserve the authored FAQ items.
  const faqsSrc = read(path.join(ROOT, 'faqs.php'));
  const faqItems = extractPhpArray(faqsSrc, "'faqItems', ");
  write(path.join(ROOT, 'faqs.php'), `${HEADER}$faqItems = ${faqItems};

$itemsHtml = '';
foreach ($faqItems as $item) {
    $itemsHtml .= '<details class="card"><summary style="font-weight:700;cursor:pointer">'
        . ch247_e($item['question'] ?? '')
        . '</summary><div style="margin-top:10px">'
        . ($item['answer'] ?? '')
        . '</div></details>';
}

echo ch247_page([
    'title' => 'Frequently Asked Questions | CloudHost247',
    'description' => 'Answers to common questions about CloudHost247 hosting, domains, billing, support and account management.',
    'canonical' => 'faqs.php',
    'active' => 'resources',
    'crumbs' => [['index.php', 'Home'], [null, 'FAQs']],
    'jsonld' => [
        '@context' => 'https://schema.org',
        '@type' => 'FAQPage',
        'mainEntity' => array_map(static function ($item) {
            return [
                '@type' => 'Question',
                'name' => $item['question'] ?? '',
                'acceptedAnswer' => ['@type' => 'Answer', 'text' => strip_tags((string) ($item['answer'] ?? ''))],
            ];
        }, $faqItems),
    ],
], ch247_page_head([['index.php', 'Home'], [null, 'FAQs']], 'Frequently Asked Questions', 'Straight answers about our services, billing and support. If your question is not covered, open a ticket and a human will answer.')
    . '<section class="section"><div class="container" style="display:grid;gap:14px;max-width:880px">' . $itemsHtml . '</div></section>'
    . ch247_cta_band('Still have a question?', 'Our support team answers tickets personally — no bots, no canned replies.', 'Contact Support', 'help-center.php'));
`);

  // legal.php — the legal hub with preserved section descriptions.
  const legalSrc = read(path.join(ROOT, 'legal.php'));
  const legalSections = extractPhpArray(legalSrc, "'legalSections', ");
  write(path.join(ROOT, 'legal.php'), `${HEADER}$legalSections = ${legalSections};

$cards = '';
foreach ($legalSections as $section) {
    $link = (string) ($section['link'] ?? '');
    if ($link === '' || $link === '#') {
        continue;
    }
    $cards .= '<div class="card"><h3>' . ch247_e($section['title'] ?? '') . '</h3>'
        . '<p>' . ch247_e($section['desc'] ?? '') . '</p>'
        . '<a class="btn btn--secondary" href="' . ch247_e($link) . '">Read the document</a></div>';
}

echo ch247_page([
    'title' => 'Legal & Policy Center | CloudHost247',
    'description' => 'All CloudHost247 legal documents in one place: terms, privacy, cookies, acceptable use, refunds, domain policies and more.',
    'canonical' => 'legal.php',
    'active' => 'company',
    'crumbs' => [['index.php', 'Home'], [null, 'Legal & Policy Center']],
], ch247_page_head([['index.php', 'Home'], [null, 'Legal & Policy Center']], 'Legal & Policy Center', 'Every policy that governs our services, written to be read — plain language, current versions, all in one place.')
    . '<section class="section"><div class="container"><div class="grid grid--3">' . $cards . '</div>'
    . '<p class="hint" style="margin-top:22px">Documents that are not yet published here are maintained as versioned pages on the platform at /legal. Nothing on this page is legal advice; it describes our actual policies.</p>'
    . '</div></section>');
`);
}

/* ------------------------------------------------------------------ */
/* Group A — pages rebuilt from legacy template prose                  */
/* ------------------------------------------------------------------ */

const TPL_PAGES = [
  {
    tpl: 'termsofservice.tpl', php: 'terms-of-service.php',
    title: 'Terms of Service',
    metaTitle: 'Terms of Service | CloudHost247',
    description: 'The terms and conditions governing CloudHost247 services: accounts, billing, acceptable use, suspensions, liability and more.',
    active: 'company', lede: 'The agreement that governs your use of our services — written to be understood.',
  },
  {
    tpl: 'privacypolicy.tpl', php: 'privacy-policy.php',
    title: 'Privacy Policy',
    metaTitle: 'Privacy Policy | CloudHost247',
    description: 'How CloudHost247 collects, uses, stores and protects your personal data, and the rights you have over it.',
    active: 'company', lede: 'What data we collect, why we collect it, and the rights you keep over it.',
  },
  {
    tpl: 'cookiepolicy.tpl', php: 'cookie-policy.php',
    title: 'Cookie Policy',
    metaTitle: 'Cookie Policy | CloudHost247',
    description: 'How CloudHost247 uses cookies and similar technologies across its websites, and how you can control them.',
    active: 'company', lede: 'Which cookies we use, what they do, and how to control them.',
  },
  {
    tpl: 'domainagreement.tpl', php: 'domain-agreement.php',
    title: 'Domain Registration Agreement',
    metaTitle: 'Domain Registration Agreement | CloudHost247',
    description: 'The agreement covering domain name registrations through CloudHost247: rights, obligations, transfers and disputes.',
    active: 'domains', lede: 'The terms that apply to every domain registered through CloudHost247.',
  },
  {
    tpl: 'dataprivacynoticeandconsentform.tpl', php: 'data-privacy-notice-and-consent-form.php',
    title: 'Data Privacy Notice & Consent Form',
    metaTitle: 'Data Privacy Notice & Consent | CloudHost247',
    description: 'The data privacy notice and consent form covering personal data processed by CloudHost247.',
    active: 'company', lede: 'Our data privacy notice and the consent framework for personal data we process.',
  },
  {
    tpl: 'domainregistrationaddendum.tpl', php: 'domainregistrationaddendum.php',
    title: 'Domain Registration Addendum',
    metaTitle: 'Domain Registration Addendum | CloudHost247',
    description: 'Addendum to the domain registration agreement covering registry-specific terms and ICANN obligations.',
    active: 'domains', lede: 'Registry-specific terms that supplement the domain registration agreement.',
  },
  {
    tpl: 'domainrenewalpolicy.tpl', php: 'domain-renewal-policy.php',
    title: 'Domain Auto-Renewal & Deletion Policy',
    metaTitle: 'Domain Renewal & Deletion Policy | CloudHost247',
    description: 'How domain auto-renewal works at CloudHost247, the grace and redemption periods after expiry, and deletion timing.',
    active: 'domains', lede: 'What happens when a domain renews, expires, or is deleted — including every grace period.',
  },
  {
    tpl: 'fairusagepolicy.tpl', php: 'fair-usage-policy.php',
    title: 'Fair Usage Policy',
    metaTitle: 'Fair Usage Policy | CloudHost247',
    description: 'The fair usage policy that keeps shared resources fast and reliable for every CloudHost247 customer.',
    active: 'company', lede: 'The rules that keep shared infrastructure fast and fair for everyone.',
  },
  {
    tpl: 'legalnotice.tpl', php: 'legal-notice.php',
    title: 'Legal Notice',
    metaTitle: 'Legal Notice | CloudHost247',
    description: 'Legal notice for the CloudHost247 website: operator information, intellectual property, liability and governing law.',
    active: 'company', lede: 'Operator information and general legal notices for this website.',
  },
  {
    tpl: 'refund-and-vancellation-policy.tpl', php: 'refund-and-cancellation-policy.php',
    title: 'Refund & Cancellation Policy',
    metaTitle: 'Refund & Cancellation Policy | CloudHost247',
    description: 'How to cancel a CloudHost247 service and when refunds apply — including cancellation windows and exclusions.',
    active: 'company', lede: 'How cancellations and refunds work, step by step.',
  },
];

function groupA() {
  for (const spec of TPL_PAGES) {
    const prose = extractTplProse(spec.tpl);
    if (prose.length < 800) {
      console.warn(`WARN: ${spec.tpl} extracted only ${prose.length} chars — review`);
    }
    const body = `ch247_page_head([['index.php', 'Home'], ['legal.php', 'Legal'], [null, ${JSON.stringify(spec.title)}]], ${JSON.stringify(spec.title)}, ${JSON.stringify(spec.lede)})
    . '<section class="section"><div class="container"><div class="card" style="padding:28px">' . ch247_prose($prose) . '</div></div></section>'`;

    write(path.join(ROOT, spec.php), `${HEADER}$prose = ${phpString(prose)};

echo ch247_page([
    'title' => ${JSON.stringify(spec.metaTitle)},
    'description' => ${JSON.stringify(spec.description)},
    'canonical' => '${spec.php}',
    'active' => '${spec.active}',
    'crumbs' => [['index.php', 'Home'], ['legal.php', 'Legal'], [null, ${JSON.stringify(spec.title)}]],
], ${body});
`);
  }

  // data-deletion.php — small page, authored fresh (old one only assigned template vars).
  write(path.join(ROOT, 'data-deletion.php'), `${HEADER}$prose = '<h2>Data deletion requests</h2>'
    . '<p>When you ask us to delete your personal data, we act on it. This page explains what deletion covers, what we are legally required to keep, and how to make a request.</p>'
    . '<h2>How to request deletion</h2>'
    . '<p>Open a support ticket from your client area, or email our privacy contact (listed on the <a href="help-center.php">Help Center</a>) from the address registered on your account. To protect you, we verify account ownership before acting on any deletion request.</p>'
    . '<h2>What we delete</h2>'
    . '<ul>'
    . '<li>Your profile details, contact information and account preferences.</li>'
    . '<li>Website files, databases and email data belonging to closed services, once the service itself is terminated.</li>'
    . '<li>Marketing preferences — you will receive no further communications.</li>'
    . '</ul>'
    . '<h2>What we must retain</h2>'
    . '<ul>'
    . '<li>Invoicing and payment records for the period required by applicable tax and accounting law.</li>'
    . '<li>Domain registration records for periods mandated by the registry or ICANN policy.</li>'
    . '<li>Abuse, fraud and security logs where a legal obligation or an active investigation applies.</li>'
    . '</ul>'
    . '<p>Retention is never open-ended: records kept for legal reasons are deleted as soon as the obligation expires. For the full framework, see our <a href="privacy-policy.php">Privacy Policy</a> and <a href="data-privacy-notice-and-consent-form.php">Data Privacy Notice</a>.</p>';

echo ch247_page([
    'title' => 'Data Deletion | CloudHost247',
    'description' => 'How to request deletion of your personal data from CloudHost247, what we delete, and what we are legally required to retain.',
    'canonical' => 'data-deletion.php',
    'active' => 'company',
    'crumbs' => [['index.php', 'Home'], ['legal.php', 'Legal'], [null, 'Data Deletion']],
], ch247_page_head([['index.php', 'Home'], ['legal.php', 'Legal'], [null, 'Data Deletion']], 'Data Deletion', 'Your data is yours. Here is exactly how deletion works.')
    . '<section class="section"><div class="container"><div class="card" style="padding:28px">' . ch247_prose($prose) . '</div></div></section>');
`);
}

/* ------------------------------------------------------------------ */
/* Group D — redirects and safely gated endpoints                      */
/* ------------------------------------------------------------------ */

function redirectPage(target, note) {
  return `<?php
/**
 * Legacy URL kept alive as a permanent redirect so bookmarks and search
 * results land somewhere professional instead of a dead page.
 * ${note}
 */

declare(strict_types=1);

header('Location: ${target}', true, 301);
header('Cache-Control: public, max-age=86400');
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Redirecting… | CloudHost247</title>
  <meta http-equiv="refresh" content="0; url=${target}">
  <meta name="robots" content="noindex">
</head>
<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:60vh;margin:0">
  <p>You are being redirected to <a href="${target}">${target}</a>.</p>
</body>
</html>
`;
}

function groupD() {
  // Original logic minus the opening tag, strict_types and init.php require
  // (the gated entry points load init.php themselves before including it).
  const stripInit = (src) => src
    .replace(/^<\?php\s*/, '')
    .replace(/declare\(strict_types:1\);\s*/, '')
    .replace(/require __DIR__ \. '\/init\.php';\s*/g, '');

  const redirects = [
    ['dedeicated-server.php', 'dedicated-server.php', 'Typo URL preserved as a redirect.'],
    ['cloudhost247-hosting.php', 'offers.php', 'Old product-catalog sample page.'],
    ['cloudhost247-sample.php', 'index.php', 'Developer sample page.'],
    ['cloudhost247-vps-sample.php', 'vps-hosting.php', 'Developer sample page.'],
    ['all-element-cloudhost247.php', 'index.php', 'Style-sheet sample page.'],
    ['future-element.php', 'index.php', 'Style-sheet sample page.'],
    ['tables.php', 'offers.php', 'Design sample page.'],
  ];
  for (const [from, to, note] of redirects) {
    write(path.join(ROOT, from), redirectPage(to, note));
  }

  // cloudhost247-page.php — legacy generic CMS front controller.
  write(path.join(ROOT, 'cloudhost247-page.php'), `<?php
/**
 * Legacy theme-CMS front controller. The theme content store it rendered was
 * part of the retired WHMCS layer, so this route now answers a clean 404 and
 * points visitors at the live site instead of a blank page.
 */

declare(strict_types=1);

require_once __DIR__ . '/php/bootstrap.php';

http_response_code(404);
echo ch247_page([
    'title' => 'Page Not Found | CloudHost247',
    'description' => 'The page you requested is no longer available.',
    'canonical' => 'notfound.php',
    'noindex' => true,
    'active' => '',
    'crumbs' => [['index.php', 'Home'], [null, 'Not Found']],
], ch247_page_head([['index.php', 'Home'], [null, 'Not Found']], 'Page not found', 'This page was part of an older version of our site and is no longer published.')
    . '<section class="section"><div class="container">'
    . ch247_notice('Looking for something specific? Try the <a href="index.php">homepage</a>, browse <a href="offers.php">current offers</a>, or visit the <a href="help-center.php">Help Center</a>.')
    . '</div></section>');
`);

  // cloudhost247-sitemap.php — standalone XML sitemap (no WHMCS dependency).
  write(path.join(ROOT, 'cloudhost247-sitemap.php'), `<?php
/**
 * XML sitemap for the PHP front of the CloudHost247 website.
 *
 * Lists every standalone PHP page plus, when the platform API is reachable,
 * the published knowledgebase and blog articles. Drafts are never listed —
 * the API only returns published content.
 */

declare(strict_types=1);

require_once __DIR__ . '/php/config.php';
require_once __DIR__ . '/php/api.php';
require_once __DIR__ . '/php/layout.php';

header('Content-Type: application/xml; charset=UTF-8');
header('Cache-Control: public, max-age=900');

$origin = ch247_origin();

$pages = [
    '', 'web-hosting.php', 'wordpress-hosting.php', 'cpanel-hosting.php', 'windows-hosting.php',
    'plesk-hosting.php', 'vps-hosting.php', 'vps-privatecloud.php', 'vps-publiccloud.php',
    'dedicated-server.php', 'enterprise-servers.php', 'game-servers.php', 'email-hosting.php',
    'ssl-certificate.php', 'website-design.php', 'developer-friendly.php', 'domain.php',
    'offers.php', 'blog.php', 'help-center.php', 'faqs.php', 'aboutus.php', 'legal.php',
    'terms-of-service.php', 'privacy-policy.php', 'cookie-policy.php', 'acceptable-use-policy.php',
    'refund-policy.php', 'refund-and-cancellation-policy.php', 'fair-usage-policy.php',
    'trademark-policy.php', 'legal-notice.php', 'backup-policy.php', 'cybercrime-policy.php',
    'domain-agreement.php', 'domain-renewal-policy.php', 'domain-brokerage-terms.php',
    'domainregistrationaddendum.php', 'data-deletion.php', 'data-privacy-notice-and-consent-form.php',
    'data-protection-standards.php',
];

$xml = '<?xml version="1.0" encoding="UTF-8"?>' . "\\n"
    . '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' . "\\n";

foreach ($pages as $page) {
    $xml .= '  <url><loc>' . htmlspecialchars($origin . '/' . $page, ENT_XML1, 'UTF-8') . "</loc></url>\\n";
}

foreach (['kb' => 'kb', 'blog' => 'blog'] as $kind => $prefix) {
    $articles = ch247_articles($kind);
    if ($articles === null) {
        continue; // Platform unreachable — omit rather than guess.
    }
    foreach ($articles as $article) {
        $slug = (string) ($article['slug'] ?? '');
        if ($slug === '') {
            continue;
        }
        $xml .= '  <url><loc>' . htmlspecialchars($origin . '/' . $prefix . '/' . rawurlencode($slug), ENT_XML1, 'UTF-8') . "</loc></url>\\n";
    }
}

$xml .= "</urlset>\\n";
echo $xml;
`);

  // cloudhost247-marketing-track.php — working email-marketing endpoint.
  // Preserve the original logic verbatim; just gate the WHMCS core so the
  // file answers a clean 404 on hosts without the layer instead of fataling.
  const marketingOriginal = stripInit(
    read(path.join(ROOT, 'cloudhost247-marketing-track.php'))
      // The outer gate now loads init.php; drop the original's own guard.
      .replace(/if \(!defined\('WHMCS'\)\) \{[\s\S]*?\}/, '')
  );
  write(path.join(ROOT, 'legacy-marketing-router.php'), `<?php
/**
 * Preserved original marketing tracking endpoint logic
 * (was the body of cloudhost247-marketing-track.php). Reached only through
 * cloudhost247-marketing-track.php, which loads init.php first.
 */

${marketingOriginal}
`);
  write(path.join(ROOT, 'cloudhost247-marketing-track.php'), `<?php
/**
 * CloudHost247 Marketing — public tracking endpoint.
 *
 * Serves the email-marketing tracking pixel, click redirect and unsubscribe
 * confirmation. This is functional infrastructure and is preserved exactly:
 * it runs when the WHMCS core and the marketing addon are installed, and
 * answers a plain 404 otherwise. No address, campaign name or subscriber
 * identifier is ever accepted or returned.
 */

declare(strict_types=1);

$init = __DIR__ . '/init.php';
$bootstrap = __DIR__ . '/modules/addons/cloudhost247_marketing/bootstrap.php';

if (!is_file($init) || !is_file($bootstrap)) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=UTF-8');
    exit('Not found');
}

require_once $init;
require __DIR__ . '/legacy-marketing-router.php';
`);

  // builder-page.php and builder-sitemap.php — gate without a fatal WHMCS
  // dependency, but preserve the original logic for hosts where the WHMCS
  // layer IS present so nothing working is lost.
  const builderPageOriginal = stripInit(read(path.join(ROOT, 'builder-page.php')));
  const builderSitemapOriginal = stripInit(read(path.join(ROOT, 'builder-sitemap.php')));

  write(path.join(ROOT, 'legacy-builder-router.php'), `<?php
/**
 * Preserved original Website Builder front controller (was builder-page.php).
 * Reached only through builder-page.php, which loads init.php first.
 */

${builderPageOriginal}
`);
  write(path.join(ROOT, 'legacy-builder-sitemap-router.php'), `<?php
/**
 * Preserved original Website Builder sitemap generator (was builder-sitemap.php).
 * Reached only through builder-sitemap.php, which loads init.php first.
 */

${builderSitemapOriginal}
`);

  const gate = (routerFile, what) => `<?php
/**
 * Website Builder ${what}.
 *
 * The builder runs on the retired WHMCS layer. This entry point checks that
 * the layer is actually present and answers a clean 404 when it is not, so
 * the URL never fatals on a plain web server. When the layer IS present the
 * original, unchanged builder logic runs from ${routerFile}.
 */

declare(strict_types=1);

$init = __DIR__ . '/init.php';
$moduleDirectory = __DIR__ . '/modules/addons/cloudhost247_builder';

if (!is_file($init) || !is_file($moduleDirectory . '/bootstrap.php')) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=UTF-8');
    exit('Not found');
}

require_once $init;
require __DIR__ . '/${routerFile}';
`;

  write(path.join(ROOT, 'builder-page.php'), gate('legacy-builder-router.php', 'front controller'));
  write(path.join(ROOT, 'builder-sitemap.php'), gate('legacy-builder-sitemap-router.php', 'sitemap'));
}

groupB();
groupA();
groupD();
console.log('done');
