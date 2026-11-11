<?php
/** Public storefront for services mapped to the existing SMM provisioning module. */
define('CLIENTAREA', true);
require __DIR__ . '/init.php';
require_once __DIR__ . '/modules/addons/cloudhost247_builder/bootstrap.php';

$ca = new \WHMCS\ClientArea();
$ca->initPage();
$ca->setPageTitle('Social Media Marketing Services');
$ca->addToBreadCrumb('index.php', 'Home');
$ca->addToBreadCrumb('smm-services.php', 'SMM Services');
$services = array();
$error = '';
try {
    // Offer only products with a live mapping, available service and enabled provider.
    // Provider costs, credentials and raw provider data never leave the server.
    $rows = \WHMCS\Database\Capsule::table('tblproducts as p')
        ->join('tblproductgroups as g', 'g.id', '=', 'p.gid')
        ->join('mod_cloudhost247_smm_mappings as m', 'm.product_id', '=', 'p.id')
        ->join('mod_cloudhost247_smm_services as s', 's.id', '=', 'm.service_id')
        ->join('mod_cloudhost247_smm_providers as provider', 'provider.id', '=', 'm.provider_id')
        ->where('p.hidden', 0)->where('g.hidden', 0)->where('p.servertype', 'cloudhost247_smm')
        ->where('m.enabled', 1)->where('s.available', 1)->where('provider.enabled', 1)
        ->whereColumn('s.provider_id', 'm.provider_id')
        ->orderBy('p.order')->orderBy('p.id')->limit(48)
        ->select('p.id', 'p.paytype')->get();
    $catalog = new \CloudHost247\Builder\Catalog\WhmcsDataSource();
    foreach ($rows as $row) {
        $service = $catalog->product((int) $row->id, 'monthly');
        if (!$service) { continue; }
        $service['billing_label'] = $row->paytype === 'onetime' ? 'one time' : 'monthly';
        if ($row->paytype === 'free') { $service['price'] = null; $service['billing_label'] = 'free'; }
        $services[] = $service;
    }
} catch (\Throwable $e) {
    $services = array();
    $error = 'Services are temporarily unavailable. Please try again later or contact sales.';
}
$ca->assign('smmServices', $services);
$ca->assign('smmError', $error);
$ca->assign('sidebarCloudHost247Remove', 'true');
$ca->setTemplate('smm-services');
$ca->output();
