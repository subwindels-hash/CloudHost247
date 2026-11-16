<?php
/**
 * CloudHost247 — public SSL certificate storefront.
 *
 * A real WHMCS client-area page: certificate plans, prices, billing labels and
 * availability come from live WHMCS product records in the visitor's catalogue
 * currency, and every "Buy certificate" button links into the normal WHMCS
 * cart/checkout flow. Nothing is priced, promised or invented here.
 *
 * A certificate product is a visible, non-retired WHMCS product that either
 * belongs to a visible product group named for SSL/TLS certificates or is
 * provisioned by an SSL module (`servertype = 'ssl'`). Products outside those
 * groups are never listed: this page sells certificates, not hosting.
 *
 * No provider API is called while this page renders.
 *
 * @package    WHMCS
 * @subpackage CloudHost247 SSL Certificates
 */

use CloudHost247\Builder\Catalog\CartLinks;
use CloudHost247\Builder\Catalog\WhmcsDataSource;
use WHMCS\ClientArea;
use WHMCS\Database\Capsule;

define('CLIENTAREA', true);

require __DIR__ . '/init.php';
require_once __DIR__ . '/modules/addons/cloudhost247_builder/bootstrap.php';

$ca = new ClientArea();
$ca->setPageTitle('SSL Certificates');
$ca->addToBreadCrumb('index.php', 'Home');
$ca->addToBreadCrumb('ssl-certificate.php', 'SSL Certificates');
$ca->initPage();

/** tblpricing cycle columns, in the order a certificate is normally sold. */
$cycles = array('annually', 'biennially', 'triennially', 'monthly', 'quarterly', 'semiannually');
$cycleLabels = array(
    'monthly' => 'month',
    'quarterly' => 'quarter',
    'semiannually' => '6 months',
    'annually' => 'year',
    'biennially' => '2 years',
    'triennially' => '3 years',
);

$plans = array();
$error = '';

try {
    // Certificate products only: visible products in a visible group that is
    // named for certificates, plus products assigned to an SSL provisioning
    // module. `retired` products are excluded like the rest of the storefront.
    $rows = Capsule::table('tblproducts as p')
        ->join('tblproductgroups as g', 'g.id', '=', 'p.gid')
        ->where('p.hidden', 0)
        ->where('p.retired', 0)
        ->where('g.hidden', 0)
        ->where(function ($query) {
            $query->where('g.name', 'like', '%ssl%')
                ->orWhere('g.name', 'like', '%certificate%')
                ->orWhere('p.servertype', 'ssl');
        })
        ->orderBy('g.order')
        ->orderBy('p.order')
        ->orderBy('p.id')
        ->limit(36)
        ->select('p.id', 'p.gid', 'p.paytype')
        ->get();

    $catalog = new WhmcsDataSource();

    foreach ($rows as $row) {
        $productId = (int) $row->id;
        $plan = $catalog->product($productId, 'annually');
        if (!$plan) {
            continue;
        }

        if ($row->paytype === 'free') {
            $plan['price'] = null;
            $plan['billing_label'] = 'free';
            $plan['order_url'] = CartLinks::product($productId);
        } elseif ($row->paytype === 'onetime') {
            // WHMCS stores a one-time product's amount in the monthly column.
            $oneTime = $catalog->price($productId, 'monthly');
            $plan['price'] = $oneTime ? $oneTime : null;
            $plan['billing_label'] = 'one time';
            $plan['order_url'] = CartLinks::product($productId);
        } else {
            // Certificates are usually annual; fall back through the other
            // cycles so a plan that only offers one term is still orderable.
            if (!$plan['price']) {
                foreach ($cycles as $cycle) {
                    $price = $catalog->price($productId, $cycle);
                    if ($price !== null) {
                        $plan['price'] = $price;
                        break;
                    }
                }
            }

            if ($plan['price']) {
                $cycle = (string) $plan['price']['cycle'];
                $plan['billing_label'] = isset($cycleLabels[$cycle]) ? $cycleLabels[$cycle] : $cycle;
                // Preselect the term whose price is shown, so the cart charges
                // what the customer just read.
                $plan['order_url'] = CartLinks::product($productId, $cycle);
            } else {
                $plan['billing_label'] = '';
                $plan['order_url'] = CartLinks::product($productId);
            }
        }

        $plans[] = $plan;
    }
} catch (\Throwable $e) {
    // Never leak an exception to a public page. The error log keeps the cause
    // and the visitor gets a usable message.
    try {
        error_log('[CloudHost247 SSL Certificates] public page catalogue failure: ' . $e->getMessage());
    } catch (\Throwable $logFailure) {
        // Logging must never take the page down.
    }

    $plans = array();
    $error = 'SSL certificate plans are temporarily unavailable. Please try again later or contact sales.';
}

$ca->assign('sslPlans', $plans);
$ca->assign('sslError', $error);
$ca->assign('sslPlanCount', count($plans));
$ca->assign('sidebarCloudHost247Remove', 'true');

$ca->setTemplate('ssl-certificate');
$ca->output();
