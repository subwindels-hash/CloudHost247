<?php
/** Public storefront for downloadable products linked to the Digital Products addon. */
define('CLIENTAREA', true);
require __DIR__ . '/init.php';
require_once __DIR__ . '/modules/addons/cloudhost247_builder/bootstrap.php';

$ca = new \WHMCS\ClientArea();
$ca->initPage();
$ca->setPageTitle('Digital Products');
$ca->addToBreadCrumb('index.php', 'Home');
$ca->addToBreadCrumb('digital-products.php', 'Digital Products');
$products = array();
$error = '';
try {
    // Offer only active addon products with a current active file and an orderable WHMCS product.
    // Do not expose file paths, storage keys, licenses or download tokens.
    $rows = \WHMCS\Database\Capsule::table('mod_digitalproducts_products as d')
        ->join('tblproducts as p', function ($join) {
            $join->on('p.id', '=', \WHMCS\Database\Capsule::raw('COALESCE(NULLIF(d.whmcs_product_id, 0), d.product_id)'));
        })
        ->join('tblproductgroups as g', 'g.id', '=', 'p.gid')
        ->join('mod_digitalproducts_files as f', function ($join) {
            $join->on('f.id', '=', 'd.current_file_id')->on('f.product_id', '=', 'd.id');
        })
        ->where('d.status', 'active')->where('f.status', 'active')
        ->where('p.hidden', 0)->where('p.retired', 0)->where('g.hidden', 0)
        ->orderBy('p.order')->orderBy('p.id')->limit(48)
        ->select('p.id', 'p.paytype')->get();
    $catalog = new \CloudHost247\Builder\Catalog\WhmcsDataSource();
    foreach ($rows as $row) {
        $product = $catalog->product((int) $row->id, 'monthly');
        if (!$product) { continue; }
        $product['billing_label'] = $row->paytype === 'onetime' ? 'one time' : 'monthly';
        if ($row->paytype === 'free') { $product['price'] = null; $product['billing_label'] = 'free'; }
        $products[] = $product;
    }
} catch (\Throwable $e) {
    $products = array();
    $error = 'Digital products are temporarily unavailable. Please try again later or contact sales.';
}
$ca->assign('digitalProducts', $products);
$ca->assign('digitalError', $error);
$ca->assign('sidebarCloudHost247Remove', 'true');
$ca->setTemplate('digital-products');
$ca->output();
