<?php
/**
 * CloudHost247 — Current Offers. Every price is live from the catalog;
 * no invented promotions, countdowns or "discounts" off fictional list prices.
 */

declare(strict_types=1);

require_once __DIR__ . '/php/bootstrap.php';

$appBase = ch247_e(CH247_APP_BASE);
$catalog = ch247_catalog();

if ($catalog === null) {
    $offersHtml = ch247_unavailable('Live offers');
} else {
    $offersHtml = '';
    foreach ($catalog['products'] ?? [] as $product) {
        $plans = $product['plans'] ?? [];
        if (!$plans) {
            continue;
        }
        $cards = '';
        foreach ($plans as $plan) {
            $pricing = $plan['pricing'] ?? [];
            if (!$pricing) {
                continue;
            }
            $cycles = '';
            foreach ($pricing as $entry) {
                $cycles .= '<div><dt>' . ch247_e(ucfirst((string) ($entry['billingCycle'] ?? 'price'))) . '</dt><dd>'
                    . ch247_e(ch247_money($entry['price'] ?? null, $entry['currency'] ?? 'USD')) . '</dd></div>';
            }
            $features = '';
            foreach (array_slice($plan['features'] ?? [], 0, 6) as $feature) {
                $label = is_array($feature) ? ($feature['label'] ?? '') : $feature;
                $value = is_array($feature) ? ($feature['value'] ?? null) : null;
                $features .= '<li>' . ch247_e($label) . ($value !== null && $value !== '' ? ' — ' . ch247_e($value) : '') . '</li>';
            }
            $cards .= '<article class="card plan-card"><div class="plan-body">'
                . '<h3>' . ch247_e($plan['name'] ?? 'Plan') . '</h3>'
                . '<dl class="plan-meta">' . $cycles . '</dl>'
                . ($features !== '' ? '<ul style="display:grid;gap:6px;margin:10px 0;padding-left:18px">' . $features . '</ul>' : '')
                . '</div><a class="btn btn--primary" href="' . $appBase . '/app/catalog?product=' . ch247_e($product['slug'] ?? '') . '">Choose Plan</a></article>';
        }
        if ($cards === '') {
            continue;
        }
        $offersHtml .= '<div class="section-head" style="margin-top:34px"><span class="eyebrow">' . ch247_e($product['category'] ?? 'Service') . '</span><h2>' . ch247_e($product['name'] ?? 'Service') . '</h2></div>'
            . '<div class="plan-grid">' . $cards . '</div>';
    }
    if ($offersHtml === '') {
        $offersHtml = ch247_notice('No offers are published right now. Plans appear here the moment they are configured in the catalog — nothing is padded with placeholders.');
    }
}

$content = ch247_page_head(
    [['index.php', 'Home'], [null, 'Current Offers']],
    'Current Offers',
    'Everything available for order right now — with the real prices, cycles and limits from our catalog.'
) . '
    <section class="section">
      <div class="container">
        ' . $offersHtml . '
        <p class="hint" style="margin-top:26px">Prices are served live from the CloudHost247 catalog and exclude taxes where applicable. Renewal pricing is shown per plan where it differs from the first term.</p>
      </div>
    </section>
' . ch247_cta_band('Questions before you order?', 'Our team will help you pick the right plan — and tell you when a cheaper one fits.', 'Contact Support', 'help-center.php');

echo ch247_page([
    'title' => 'Current Offers — Live Plans & Pricing | CloudHost247',
    'description' => 'Every CloudHost247 plan currently available for order, with live pricing, billing cycles and limits pulled straight from the catalog.',
    'canonical' => 'offers.php',
    'active' => 'resources',
    'crumbs' => [['index.php', 'Home'], [null, 'Current Offers']],
], $content);
