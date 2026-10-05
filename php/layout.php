<?php
/**
 * CloudHost247 — page layout (document head, header, footer).
 *
 * The markup intentionally matches the static platform site one-for-one so the
 * same design system (site.css) and behaviour layer (site.js) drive both.
 * One website, one look, two rendering paths.
 */

declare(strict_types=1);

require_once __DIR__ . '/api.php';

/** Public origin: configured canonical URL, or derived from the request. */
function ch247_origin(): string
{
    if (CH247_PUBLIC_URL !== '') {
        return CH247_PUBLIC_URL;
    }
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https')
        || ((int) ($_SERVER['SERVER_PORT'] ?? 0) === 443);
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    return ($https ? 'https://' : 'http://') . $host;
}

/** Absolute canonical URL for a site page (e.g. "web-hosting.php"). */
function ch247_canonical(string $page): string
{
    return ch247_origin() . '/' . ltrim($page, '/');
}

/**
 * Render the <head> block.
 *
 * $meta keys: title, description, canonical (page path), type (default
 * "website"), noindex (bool), crumbs ([[href|null, label], ...]), jsonld
 * (extra schema.org object merged into the page graph).
 */
function ch247_head(array $meta): string
{
    $title = ch247_e($meta['title'] ?? CH247_BRAND);
    $description = ch247_e($meta['description'] ?? '');
    $canonical = ch247_e(ch247_canonical($meta['canonical'] ?? 'index.php'));
    $type = ch247_e($meta['type'] ?? 'website');

    $siteInfo = ch247_site_info();
    $brandName = ch247_e(is_array($siteInfo) && !empty($siteInfo['brandName']) ? $siteInfo['brandName'] : CH247_BRAND);

    $crumbs = $meta['crumbs'] ?? [];
    $breadcrumbItems = [];
    foreach ($crumbs as $i => $crumb) {
        $href = $crumb[0] === null ? ch247_canonical($meta['canonical'] ?? 'index.php') : ch247_canonical((string) $crumb[0]);
        $breadcrumbItems[] = [
            '@type' => 'ListItem',
            'position' => $i + 1,
            'name' => (string) $crumb[1],
            'item' => $href,
        ];
    }

    $jsonld = [[
        '@context' => 'https://schema.org',
        '@type' => 'WebSite',
        'name' => $brandName,
        'url' => ch247_origin() . '/',
    ]];
    if ($breadcrumbItems) {
        $jsonld[] = [
            '@context' => 'https://schema.org',
            '@type' => 'BreadcrumbList',
            'itemListElement' => $breadcrumbItems,
        ];
    }
    if (!empty($meta['jsonld'])) {
        $jsonld[] = $meta['jsonld'];
    }

    $robots = !empty($meta['noindex']) ? "\n  <meta name=\"robots\" content=\"noindex, nofollow\">" : '';
    $json = json_encode($jsonld, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    $assetBase = ch247_e(CH247_ASSET_BASE);

    return "<!doctype html>\n"
        . "<html lang=\"en\">\n"
        . "<head>\n"
        . "  <meta charset=\"utf-8\">\n"
        . "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
        . "  <title>{$title}</title>\n"
        . "  <meta name=\"description\" content=\"{$description}\">"
        . $robots . "\n"
        . "  <link rel=\"canonical\" href=\"{$canonical}\">\n"
        . "  <meta property=\"og:type\" content=\"{$type}\">\n"
        . "  <meta property=\"og:title\" content=\"{$title}\">\n"
        . "  <meta property=\"og:description\" content=\"{$description}\">\n"
        . "  <meta property=\"og:url\" content=\"{$canonical}\">\n"
        . "  <meta property=\"og:site_name\" content=\"{$brandName}\">\n"
        . "  <meta name=\"twitter:card\" content=\"summary\">\n"
        . "  <meta name=\"twitter:title\" content=\"{$title}\">\n"
        . "  <meta name=\"twitter:description\" content=\"{$description}\">\n"
        . "  <link rel=\"icon\" type=\"image/svg+xml\" href=\"{$assetBase}/favicon.svg\">\n"
        . "  <link rel=\"stylesheet\" href=\"{$assetBase}/assets/css/site.css\">\n"
        . "  <style>\n"
        . "    /* Shared typography for long-form documents (policies, articles). */\n"
        . "    .legal-prose{line-height:1.75}\n"
        . "    .legal-prose h2{font-size:1.35rem;margin:2.2rem 0 .8rem;line-height:1.3}\n"
        . "    .legal-prose h2:first-child{margin-top:0}\n"
        . "    .legal-prose h3{font-size:1.1rem;margin:1.6rem 0 .6rem}\n"
        . "    .legal-prose p{margin:.8rem 0;color:var(--ink-2,var(--text,#334155))}\n"
        . "    .legal-prose ul,.legal-prose ol{margin:.8rem 0;padding-left:1.4rem;display:grid;gap:.45rem}\n"
        . "    .legal-prose li{margin:0}\n"
        . "    .legal-prose a{color:var(--brand,#2563eb)}\n"
        . "    .legal-prose table{width:100%;border-collapse:collapse;margin:1rem 0;font-size:.95rem}\n"
        . "    .legal-prose th,.legal-prose td{border:1px solid rgba(148,163,184,.4);padding:.55rem .75rem;text-align:left}\n"
        . "    .legal-prose th{background:rgba(148,163,184,.12)}\n"
        . "  </style>\n"
        . "  <script type=\"application/ld+json\">{$json}</script>\n"
        . "</head>\n";
}

/** Site header. $active highlights one group: hosting|domains|business|servers|resources|company. */
function ch247_header(string $active = ''): string
{
    $nav = [
        ['id' => 'hosting', 'label' => 'Hosting', 'items' => [
            ['web-hosting.php', 'Web Hosting', 'Fast shared hosting'],
            ['wordpress-hosting.php', 'WordPress Hosting', 'Optimized & managed'],
            ['cpanel-hosting.php', 'cPanel Hosting', 'Classic control panel'],
            ['vps-hosting.php', 'VPS Hosting', 'Dedicated resources'],
            ['dedicated-server.php', 'Dedicated Servers', 'Physical machines'],
            ['windows-hosting.php', 'Windows Hosting', 'ASP.NET ready'],
        ]],
        ['id' => 'domains', 'label' => 'Domains', 'items' => [
            ['domain.php', 'Register a Domain', 'Search & register'],
            ['domain.php#transfer', 'Transfer a Domain', 'Move your domains'],
            ['domain.php#pricing', 'Domain Pricing', 'All extensions'],
            ['domain-brokerage-terms.php', 'Domain Brokerage', 'Acquisition service terms'],
        ]],
        ['id' => 'business', 'label' => 'Business', 'items' => [
            ['email-hosting.php', 'Business Email', 'Professional mailbox'],
            ['ssl-certificate.php', 'SSL Certificates', 'Encrypt your site'],
            ['website-design.php', 'Website Design', 'Build with us'],
            ['web-hosting.php', 'Business Hosting', 'Hosting for companies'],
        ]],
        ['id' => 'servers', 'label' => 'Servers', 'items' => [
            ['vps-hosting.php', 'VPS', 'Virtual servers'],
            ['vps-privatecloud.php', 'Private Cloud', 'Isolated environments'],
            ['vps-publiccloud.php', 'Public Cloud', 'Elastic capacity'],
            ['dedicated-server.php', 'Dedicated Servers', 'Single-tenant hardware'],
            ['enterprise-servers.php', 'Enterprise Servers', 'Large-scale deployments'],
            ['game-servers.php', 'Game Servers', 'Low-latency play'],
        ]],
        ['id' => 'resources', 'label' => 'Resources', 'items' => [
            ['help-center.php', 'Help Center', 'Support hub'],
            ['faqs.php', 'FAQs', 'Common questions'],
            ['blog.php', 'Blog', 'News & insights'],
            ['offers.php', 'Current Offers', 'Live catalog pricing'],
            ['help-center.php', 'Contact Support', 'Open a ticket'],
        ]],
        ['id' => 'company', 'label' => 'Company', 'items' => [
            ['aboutus.php', 'About ' . CH247_BRAND, 'Who we are'],
            ['legal.php', 'Legal & Policies', 'The fine print'],
            ['offers.php', 'Offers', 'What is available now'],
            ['help-center.php', 'Contact', 'Talk to us'],
        ]],
    ];

    $appBase = ch247_e(CH247_APP_BASE);
    $itemsHtml = '';
    foreach ($nav as $group) {
        $isActive = $group['id'] === $active;
        $firstHref = ch247_e($group['items'][0][0]);
        $links = '';
        foreach ($group['items'] as $item) {
            $links .= '<li><a href="' . ch247_e($item[0]) . '">' . ch247_e($item[1])
                . ($item[2] !== '' ? '<span class="dd-note">' . ch247_e($item[2]) . '</span>' : '')
                . '</a></li>';
        }
        $itemsHtml .= '<li>'
            . '<a class="nav-link" href="' . $firstHref . '"' . ($isActive ? ' aria-current="page"' : '') . '>' . ch247_e($group['label']) . '</a>'
            . '<span class="nav-caret" aria-hidden="true"></span>'
            . '<ul class="dropdown">' . $links . '</ul>'
            . '</li>';
    }

    return "  <header class=\"site-header\" data-header>\n"
        . "    <div class=\"container nav-bar\">\n"
        . "      <a class=\"brand\" href=\"index.php\" aria-label=\"" . ch247_e(CH247_BRAND) . " home\">\n"
        . "        <span class=\"brand-mark\" aria-hidden=\"true\">C</span>\n"
        . "        <span>" . ch247_e(CH247_BRAND) . "</span>\n"
        . "      </a>\n"
        . "      <button class=\"nav-toggle\" data-nav-toggle aria-expanded=\"false\" aria-controls=\"primary-nav\" aria-label=\"Open menu\">\n"
        . "        <span></span><span></span><span></span>\n"
        . "      </button>\n"
        . "      <ul class=\"nav-primary\" id=\"primary-nav\" data-nav>\n"
        . $itemsHtml
        . "      </ul>\n"
        . "      <div class=\"nav-actions\" data-auth-slot>\n"
        . "        <a class=\"btn btn--ghost\" href=\"{$appBase}/login\" data-auth-login>Log in</a>\n"
        . "        <a class=\"btn btn--secondary\" href=\"{$appBase}/app\" data-auth-client>Client Area</a>\n"
        . "        <a class=\"btn btn--primary\" href=\"{$appBase}/app/catalog\">Get Started</a>\n"
        . "      </div>\n"
        . "    </div>\n"
        . "  </header>\n";
}

/** Multi-column footer with configured contact details (never invented ones). */
function ch247_footer(): string
{
    $siteInfo = ch247_site_info() ?? [];
    $year = (int) date('Y');

    $contactLines = [];
    foreach ([
        'supportEmail' => 'Support',
        'salesEmail' => 'Sales',
        'billingEmail' => 'Billing',
        'phone' => 'Phone',
    ] as $key => $label) {
        if (!empty($siteInfo[$key])) {
            $value = (string) $siteInfo[$key];
            if (str_contains($key, 'Email')) {
                $contactLines[] = '<li><span>' . $label . ':</span> <a href="mailto:' . ch247_e($value) . '">' . ch247_e($value) . '</a></li>';
            } else {
                $contactLines[] = '<li><span>' . $label . ':</span> ' . ch247_e($value) . '</li>';
            }
        }
    }
    $addressParts = [];
    foreach (['addressLine1', 'addressLine2', 'addressCity', 'addressRegion', 'addressPostalCode', 'addressCountry'] as $key) {
        if (!empty($siteInfo[$key])) {
            $addressParts[] = (string) $siteInfo[$key];
        }
    }

    $socials = [];
    foreach (['socialTwitter' => 'Twitter / X', 'socialLinkedin' => 'LinkedIn', 'socialGithub' => 'GitHub', 'socialFacebook' => 'Facebook'] as $key => $label) {
        if (!empty($siteInfo[$key])) {
            $socials[] = '<a href="' . ch247_e($siteInfo[$key]) . '" rel="noopener" target="_blank">' . $label . '</a>';
        }
    }

    $cols = [
        ['Hosting', [
            ['web-hosting.php', 'Web Hosting'], ['wordpress-hosting.php', 'WordPress'],
            ['vps-hosting.php', 'VPS Hosting'], ['dedicated-server.php', 'Dedicated Servers'],
            ['cpanel-hosting.php', 'cPanel Hosting'], ['windows-hosting.php', 'Windows Hosting'],
        ]],
        ['Domains', [
            ['domain.php', 'Register'], ['domain.php#transfer', 'Transfer'],
            ['domain.php#pricing', 'Pricing'], ['domain-brokerage-terms.php', 'Brokerage Terms'],
        ]],
        ['Business', [
            ['email-hosting.php', 'Business Email'], ['ssl-certificate.php', 'SSL & Security'],
            ['website-design.php', 'Website Design'], ['game-servers.php', 'Game Servers'],
        ]],
        ['Resources', [
            ['help-center.php', 'Help Center'], ['faqs.php', 'FAQs'],
            ['blog.php', 'Blog'], ['offers.php', 'Offers'],
        ]],
        ['Company', [
            ['aboutus.php', 'About'], ['legal.php', 'Legal & Policies'],
            ['backup-policy.php', 'Backup Policy'], ['acceptable-use-policy.php', 'Acceptable Use'],
        ]],
    ];

    $colsHtml = '';
    foreach ($cols as [$title, $links]) {
        $lis = '';
        foreach ($links as [$href, $label]) {
            $lis .= '<li><a href="' . ch247_e($href) . '">' . ch247_e($label) . '</a></li>';
        }
        $colsHtml .= "<nav aria-label=\"{$title}\"><h3>{$title}</h3><ul>{$lis}</ul></nav>";
    }

    $contactHtml = '';
    if ($contactLines || $addressParts) {
        $contactHtml = '<div class="footer-contact"><h3>Contact</h3>'
            . ($addressParts ? '<p>' . ch247_e(implode(', ', $addressParts)) . '</p>' : '')
            . ($contactLines ? '<ul>' . implode('', $contactLines) . '</ul>' : '')
            . ($socials ? '<p>' . implode(' &nbsp;·&nbsp; ', $socials) . '</p>' : '')
            . '</div>';
    }

    return "  <footer class=\"site-footer\">\n"
        . "    <div class=\"container\">\n"
        . "      <div class=\"footer-grid\">\n"
        . "        <div class=\"footer-brand\">\n"
        . "          <a class=\"brand\" href=\"index.php\" style=\"color:#fff\"><span class=\"brand-mark\" aria-hidden=\"true\">C</span><span>" . ch247_e(CH247_BRAND) . "</span></a>\n"
        . "          <p>Professional global hosting and infrastructure for websites, businesses, developers and growing digital companies.</p>\n"
        . "          {$contactHtml}\n"
        . "        </div>\n"
        . $colsHtml . "\n"
        . "      </div>\n"
        . "      <div class=\"footer-bottom\">\n"
        . "        <span>&copy; {$year} " . ch247_e(CH247_BRAND) . ". All rights reserved.</span>\n"
        . "        <nav aria-label=\"Legal\">\n"
        . "          <a href=\"terms-of-service.php\">Terms</a>\n"
        . "          <a href=\"privacy-policy.php\">Privacy</a>\n"
        . "          <a href=\"cookie-policy.php\">Cookies</a>\n"
        . "          <a href=\"acceptable-use-policy.php\">Acceptable Use</a>\n"
        . "          <a href=\"refund-policy.php\">Refund Policy</a>\n"
        . "        </nav>\n"
        . "      </div>\n"
        . "    </div>\n"
        . "  </footer>\n"
        . "  <script type=\"module\" src=\"" . ch247_e(CH247_ASSET_BASE) . "/assets/js/site.js\"></script>\n"
        . "</body>\n"
        . "</html>\n";
}

/**
 * Assemble a complete page: head + header + <main>content</main> + footer.
 * Send with ch247_page([...meta...], $contentHtml).
 */
function ch247_page(array $meta, string $content): string
{
    $active = $meta['active'] ?? '';
    return ch247_head($meta)
        . '<body>' . "\n"
        . "  <a class=\"skip-link\" href=\"#main\">Skip to main content</a>\n"
        . ch247_header($active)
        . "  <main id=\"main\">\n" . $content . "\n  </main>\n"
        . ch247_footer();
}
