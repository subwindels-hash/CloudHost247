<?php
/** Public storefront for products configured with the RDP provisioning module. */
define('CLIENTAREA', true);
require __DIR__ . '/init.php';
require_once __DIR__ . '/modules/addons/cloudhost247_builder/bootstrap.php';

$ca = new \WHMCS\ClientArea();
$ca->initPage();
$ca->setPageTitle('Remote Desktop Servers');
$ca->addToBreadCrumb('index.php', 'Home');
$ca->addToBreadCrumb('rdp-hosting.php', 'Remote Desktop Servers');
$plans = array();
$error = '';
try {
    // Only sell visible products in visible groups actually assigned to the RDP module.
    $rows = \WHMCS\Database\Capsule::table('tblproducts as p')
        ->join('tblproductgroups as g', 'g.id', '=', 'p.gid')
        ->where('p.hidden', 0)->where('g.hidden', 0)->where('p.servertype', 'RDP')
        ->orderBy('p.order')->orderBy('p.id')->limit(48)
        ->select('p.id', 'p.paytype')->get();
    $catalog = new \CloudHost247\Builder\Catalog\WhmcsDataSource();
    foreach ($rows as $row) {
        $plan = $catalog->product((int) $row->id, 'monthly');
        if (!$plan) { continue; }
        $plan['billing_label'] = $row->paytype === 'onetime' ? 'one time' : 'monthly';
        if ($row->paytype === 'free') { $plan['price'] = null; $plan['billing_label'] = 'free'; }
        $plans[] = $plan;
    }
} catch (\Throwable $e) {
    $plans = array();
    $error = 'Plans are temporarily unavailable. Please try again later or contact sales.';
}
$ca->assign('rdpPlans', $plans);
$ca->assign('rdpError', $error);
$ca->assign('sidebarCloudHost247Remove', 'true');
$ca->setTemplate('rdp-hosting');
$ca->output();
