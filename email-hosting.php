<?php
/**
 * CloudHost247 - public email hosting page.
 *
 * A real WHMCS client-area page: every plan, price and availability flag comes
 * from live WHMCS product records belonging to the CloudHost247 Email Hosting
 * provisioning module, in the visitor's active currency, and every "Get started" button
 * links into the normal WHMCS configure/checkout flow.
 *
 * No provider API is called while this page renders.
 *
 * @package    WHMCS
 * @subpackage CloudHost247 Email Hosting
 */

use CloudHost247\Email\Repository\ContentRepository;
use CloudHost247\Email\Service\PublicCatalog;
use WHMCS\ClientArea;

define('CLIENTAREA', true);

require __DIR__ . '/init.php';
require_once __DIR__ . '/modules/servers/cloudhost247_email_hosting/bootstrap.php';

$ca = new ClientArea();
$ca->setPageTitle('CloudHost247 Email Hosting');
$ca->addToBreadCrumb('index.php', Lang::trans('globalsystemname'));
$ca->addToBreadCrumb('email-hosting.php', 'Email Hosting');
$ca->initPage();

$currencyId = 0;

if (!empty($_SESSION['uid'])) {
    try {
        $clientCurrency = (int) WHMCS\Database\Capsule::table('tblclients')
            ->where('id', (int) $_SESSION['uid'])
            ->value('currency');

        $currencyId = $clientCurrency > 0 ? $clientCurrency : 0;
    } catch (\Throwable $e) {
        $currencyId = 0;
    }
}

if ($currencyId === 0 && !empty($_SESSION['currency'])) {
    $currencyId = (int) $_SESSION['currency'];
}

$catalogError = '';
$providers = [];
$comparison = [];
$currency = ['id' => 0, 'code' => ''];
$totalPlans = 0;

try {
    $catalog = new PublicCatalog();
    $currency = $catalog->currency($currencyId);
    $providers = $catalog->byProvider($currency['id']);
    $comparison = $catalog->comparison($currency['id']);

    foreach ($providers as $group) {
        $totalPlans += count($group['plans']);
    }
} catch (\Throwable $e) {
    // Never leak an exception to a public page.
    $reference = \CloudHost247\Email\Support\Logger::correlationId();

    try {
        \CloudHost247\Email\Support\Logger::error('public_page.catalog_failed', ['error' => $e->getMessage()]);
    } catch (\Throwable $logFailure) {
        error_log('[CloudHost247 Email Hosting] public page catalog failure: ' . $e->getMessage());
    }

    $catalogError = 'Plan information is temporarily unavailable. Reference: ' . $reference;
}

$content = ContentRepository::all();

$ca->assign('emailHero', $content['hero']);
$ca->assign('emailProviderContent', $content['providers']);
$ca->assign('emailDnsContent', $content['dns']);
$ca->assign('emailFaqs', $content['faqs']);
$ca->assign('emailProviders', $providers);
$ca->assign('emailComparison', $comparison);
$ca->assign('emailCurrency', $currency['code']);
$ca->assign('emailPlanCount', $totalPlans);
$ca->assign('emailCatalogError', $catalogError);
$ca->assign('sidebarCloudHost247Remove', 'true');

$ca->setTemplate('cloudhost247-email-hosting');
$ca->output();
