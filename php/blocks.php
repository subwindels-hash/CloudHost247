<?php
/**
 * CloudHost247 — reusable content blocks.
 *
 * Every block that displays live platform data degrades to an explicit,
 * honest notice when the API is unreachable — never to invented numbers.
 */

declare(strict_types=1);

require_once __DIR__ . '/layout.php';

/** Breadcrumb + title band, identical to the static site's page-head. */
function ch247_page_head(array $crumbs, string $title, string $lede): string
{
    $crumbHtml = '';
    if ($crumbs) {
        $items = '';
        foreach ($crumbs as $crumb) {
            if ($crumb[0] === null) {
                $items .= '<li><span aria-current="page">' . ch247_e($crumb[1]) . '</span></li>';
            } else {
                $items .= '<li><a href="' . ch247_e($crumb[0]) . '">' . ch247_e($crumb[1]) . '</a></li>';
            }
        }
        $crumbHtml = '<nav aria-label="Breadcrumb"><ol class="crumbs">' . $items . '</ol></nav>';
    }
    return "    <div class=\"page-head\">\n"
        . "      <div class=\"container\">\n"
        . '        ' . $crumbHtml . "\n"
        . '        <h1>' . ch247_e($title) . "</h1>\n"
        . '        <p>' . ch247_e($lede) . "</p>\n"
        . "      </div>\n"
        . "    </div>\n";
}

/** Inline notice. $kind: info (default) | empty. */
function ch247_notice(string $text, string $kind = 'info'): string
{
    $class = $kind === 'empty' ? 'notice notice--empty' : 'notice';
    return '<div class="' . $class . '" role="note">' . $text . '</div>';
}

/** Standard "live data unavailable" notice for API-backed blocks. */
function ch247_unavailable(string $what): string
{
    return ch247_notice(
        '<strong>' . ch247_e($what) . ' could not be loaded right now.</strong> '
        . 'Pricing and availability are served live by the ' . ch247_e(CH247_BRAND) . ' platform — '
        . 'please try again in a moment, or <a href="help-center.php">contact support</a> and we will quote you directly.'
    );
}

/**
 * Plan cards for one catalog product (by slug). Pulls the live catalog and
 * renders exactly what the platform publishes — price, cycle, features.
 */
function ch247_plan_cards(string $productSlug, string $emptyMessage = ''): string
{
    // Distinguish "the platform could not be reached" from "this product has
    // no published plans" — the honest messages are different.
    if (ch247_catalog() === null) {
        return ch247_unavailable('Live pricing');
    }
    $product = ch247_product($productSlug);
    if ($product === null) {
        return ch247_notice($emptyMessage !== '' ? $emptyMessage
            : 'This service is not in the published catalog yet. It will appear here with live pricing as soon as it is configured.');
    }
    $plans = $product['plans'] ?? [];
    if (!is_array($plans) || !$plans) {
        $message = $emptyMessage !== ''
            ? $emptyMessage
            : 'Plans for this service have not been published yet. When they are, they will appear here with live pricing — no placeholders.';
        return ch247_notice($message);
    }

    $configureBase = ch247_e(CH247_APP_BASE . '/app/catalog');
    $cards = '';
    foreach ($plans as $plan) {
        $name = ch247_e($plan['name'] ?? 'Plan');
        $description = ch247_e($plan['description'] ?? '');
        $pricing = $plan['pricing'] ?? [];
        $monthly = null;
        $annual = null;
        $currency = 'USD';
        foreach ($pricing as $entry) {
            $cycle = $entry['billingCycle'] ?? '';
            if ($cycle === 'monthly' && $monthly === null) {
                $monthly = $entry;
            }
            if ($cycle === 'annual' && $annual === null) {
                $annual = $entry;
            }
            if (!empty($entry['currency'])) {
                $currency = (string) $entry['currency'];
            }
        }
        $priceHtml = '<p class="muted">Requires configuration</p>';
        if ($monthly) {
            $priceHtml = '<p class="plan-price" style="font-size:1.9rem;font-weight:800;margin:10px 0 2px">' . ch247_e(ch247_money($monthly['price'] ?? null, $monthly['currency'] ?? $currency)) . '<span style="font-size:.95rem;font-weight:600;color:var(--ink-500)"> /month</span></p>';
            if ($annual) {
                $priceHtml .= '<p class="muted small">or ' . ch247_e(ch247_money($annual['price'] ?? null, $annual['currency'] ?? $currency)) . ' billed annually</p>';
            }
        } elseif ($annual) {
            $priceHtml = '<p class="plan-price" style="font-size:1.9rem;font-weight:800;margin:10px 0 2px">' . ch247_e(ch247_money($annual['price'] ?? null, $annual['currency'] ?? $currency)) . '<span style="font-size:.95rem;font-weight:600;color:var(--ink-500)"> /year</span></p>';
        }

        $features = $plan['features'] ?? [];
        $featureHtml = '';
        if (is_array($features) && $features) {
            $rows = '';
            foreach (array_slice($features, 0, 8) as $feature) {
                if (is_array($feature)) {
                    $label = ch247_e($feature['label'] ?? '');
                    $value = $feature['value'] ?? null;
                    $rows .= '<div><dt>' . $label . '</dt><dd>' . ($value === null || $value === '' ? '&#10003;' : ch247_e($value)) . '</dd></div>';
                } else {
                    $rows .= '<div><dt>' . ch247_e($feature) . '</dt><dd>&#10003;</dd></div>';
                }
            }
            $featureHtml = '<dl class="plan-meta">' . $rows . '</dl>';
        }

        $cards .= "<article class=\"card plan-card\">\n"
            . "  <div class=\"plan-body\">\n"
            . "    <h3>{$name}</h3>\n"
            . ($description !== '' ? "    <p class=\"muted\">{$description}</p>\n" : '')
            . $priceHtml
            . $featureHtml
            . "  </div>\n"
            . "  <a class=\"btn btn--primary\" href=\"{$configureBase}?product=" . ch247_e($productSlug) . "\">Choose Plan</a>\n"
            . "</article>\n";
    }

    if ($cards === '') {
        return ch247_notice('Plans exist for this service but none are published at the moment.');
    }
    return '<div class="plan-grid">' . $cards . '</div>';
}

/** Extension pricing table from the live domain-services API. */
function ch247_extension_table(): string
{
    $extensions = ch247_extensions();
    if ($extensions === null) {
        return ch247_unavailable('Domain pricing');
    }
    if (!$extensions) {
        return ch247_notice('Domain extensions have not been configured yet. Check back soon — pricing is published as soon as it is configured.');
    }

    // The API stores prices in cents; only columns that actually exist are shown.
    $hasTransfer = false;
    foreach ($extensions as $ext) {
        if (isset($ext['transferPriceCents'])) {
            $hasTransfer = true;
        }
    }
    $cents = static function ($value): string {
        return is_numeric($value) ? ch247_money(((float) $value) / 100, 'USD') : '—';
    };

    $head = '<th scope="col">Extension</th><th scope="col">Register (1 yr)</th>'
        . ($hasTransfer ? '<th scope="col">Transfer</th>' : '')
        . '<th scope="col">Renewal</th>';
    $rows = '';
    foreach ($extensions as $ext) {
        $rows .= '<tr>'
            . '<td><strong>.' . ch247_e($ext['tld'] ?? '') . '</strong></td>'
            . '<td>' . $cents($ext['registerPriceCents'] ?? null) . '</td>'
            . ($hasTransfer ? '<td>' . $cents($ext['transferPriceCents'] ?? null) . '</td>' : '')
            . '<td>' . $cents($ext['renewPriceCents'] ?? null) . '</td>'
            . '</tr>';
    }
    return "<div class=\"table-wrap\"><table class=\"table\">\n"
        . "<thead><tr>{$head}</tr></thead>\n"
        . "<tbody>{$rows}</tbody>\n"
        . "</table></div>\n"
        . '<p class="hint">Prices are the live values published by our platform and exclude taxes where applicable. Availability estimates for specific names are provided during checkout.</p>';
}

/** Article cards (knowledgebase or blog), from the content API. */
function ch247_article_cards(?array $articles, string $kind): string
{
    if ($articles === null) {
        return ch247_unavailable('Articles');
    }
    if (!$articles) {
        return ch247_notice('Articles appear here as they are written and published by the ' . ch247_e(CH247_BRAND) . ' team — no filler, ever.');
    }
    $cards = '';
    foreach ($articles as $article) {
        $slug = (string) ($article['slug'] ?? '');
        // Both kinds render through blog.php so links work in PHP-only deployments.
        $href = 'blog.php?article=' . rawurlencode($slug);
        $title = ch247_e($article['title'] ?? '');
        $summary = ch247_e($article['summary'] ?? '');
        $category = ch247_e($article['category'] ?? '');
        $date = !empty($article['publishedAt']) ? ch247_e(substr((string) $article['publishedAt'], 0, 10)) : '';
        $cards .= "<article class=\"card kb-card\">\n"
            . ($category !== '' ? "  <span class=\"badge\">{$category}</span>\n" : '')
            . "  <h3 style=\"margin-top:12px\"><a href=\"" . ch247_e($href) . "\" style=\"color:inherit\">{$title}</a></h3>\n"
            . "  <p>{$summary}</p>\n"
            . '  <span class="count">' . ($date !== '' ? 'Published ' . $date . ' · ' : '') . ch247_e($article['author'] ?? CH247_BRAND . ' Team') . "</span>\n"
            . "</article>\n";
    }
    return '<div class="kb-grid">' . $cards . '</div>';
}

/**
 * Render a policy/document structure: ['hero'=>['title','subtitle'],
 * 'introduction'=>['content'], 'sections'=>[['id','title','content','items'?]]]
 * — the shape shared by all hand-authored CloudHost247 policies.
 */
function ch247_policy_doc(array $doc): string
{
    $html = '';
    $hero = $doc['hero'] ?? [];
    $subtitle = $hero['subtitle'] ?? '';
    if ($subtitle !== '') {
        $html .= '<p class="hint">' . ch247_e($subtitle) . "</p>\n";
    }
    $intro = $doc['introduction']['content'] ?? '';
    if ($intro !== '') {
        $html .= '<p><strong>' . ch247_e($intro) . "</strong></p>\n";
    }

    $toc = '';
    $body = '';
    foreach ($doc['sections'] ?? [] as $section) {
        $id = ch247_e($section['id'] ?? '');
        $title = ch247_e($section['title'] ?? '');
        if ($id !== '') {
            $toc .= '<li><a href="#' . $id . '">' . $title . "</a></li>\n";
        }
        $body .= '<section class="legal-section"' . ($id !== '' ? ' id="' . $id . '"' : '') . ">\n";
        $body .= '<h2>' . $title . "</h2>\n";
        if (!empty($section['content'])) {
            $body .= '<p>' . ch247_e($section['content']) . "</p>\n";
        }
        if (!empty($section['items']) && is_array($section['items'])) {
            $lis = '';
            foreach ($section['items'] as $item) {
                // Policy item strings may contain deliberate <strong> markup.
                $lis .= '<li>' . $item . "</li>\n";
            }
            $body .= '<ul>' . $lis . "</ul>\n";
        }
        $body .= "</section>\n";
    }

    if ($toc !== '') {
        $html .= "<details class=\"card\" style=\"margin:20px 0\"><summary>Contents</summary><ol class=\"legal-prose\" style=\"margin:.6rem 0 0\">{$toc}</ol></details>\n";
    }
    $html .= '<div class="legal-prose">' . $body . '</div>';
    return $html;
}

/** Render extracted legacy template prose (already sanitized by the generator). */
function ch247_prose(string $html): string
{
    return '<div class="legal-prose">' . $html . '</div>';
}

/**
 * Minimal markdown-lite renderer for article bodies, mirroring the platform's
 * server-side article renderer: escape first, then apply ## headings and
 * "- item" lists. Nothing else is interpreted — raw HTML never executes.
 */
function ch247_md_lite(string $body): string
{
    $lines = preg_split('/\r?\n/', $body) ?: [];
    $html = '';
    $inList = false;
    foreach ($lines as $raw) {
        $line = rtrim($raw);
        $isItem = strncmp(ltrim($line), '- ', 2) === 0;
        if ($isItem) {
            if (!$inList) {
                $html .= '<ul>';
                $inList = true;
            }
            $html .= '<li>' . ch247_e(substr(ltrim($line), 2)) . '</li>';
            continue;
        }
        if ($inList) {
            $html .= '</ul>';
            $inList = false;
        }
        if (strncmp($line, '## ', 3) === 0) {
            $html .= '<h2>' . ch247_e(substr($line, 3)) . '</h2>';
        } elseif (trim($line) !== '') {
            $html .= '<p>' . ch247_e($line) . '</p>';
        }
    }
    if ($inList) {
        $html .= '</ul>';
    }
    return $html;
}

/**
 * Feature grid: [['title', 'text'], ...]. Text is escaped unless the third
 * element is true, in which case it must already be safe HTML (the caller's
 * responsibility — used only for links to our own policy pages).
 */
function ch247_feature_grid(array $features): string
{
    $cards = '';
    foreach ($features as $feature) {
        $text = !empty($feature[2]) ? $feature[1] : ch247_e($feature[1]);
        $cards .= '<div class="card"><h3>' . ch247_e($feature[0]) . '</h3><p>' . $text . "</p></div>\n";
    }
    return '<div class="grid grid--3">' . $cards . '</div>';
}

/** Closing call-to-action band. */
function ch247_cta_band(string $title, string $text, string $label, string $href): string
{
    return "    <section class=\"section\">\n"
        . "      <div class=\"container\">\n"
        . "        <div class=\"cta-band\">\n"
        . "          <div>\n"
        . '            <h2>' . ch247_e($title) . "</h2>\n"
        . '            <p>' . ch247_e($text) . "</p>\n"
        . "          </div>\n"
        . '          <a class="btn btn--primary" href="' . ch247_e($href) . '">' . ch247_e($label) . "</a>\n"
        . "        </div>\n"
        . "      </div>\n"
        . "    </section>\n";
}
