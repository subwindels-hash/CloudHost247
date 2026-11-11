<?php
/** Microsoft 365 plans configured in the existing email-hosting module. */
define('CLIENTAREA', true);
require __DIR__ . '/init.php';
require_once __DIR__ . '/modules/servers/cloudhost247_email_hosting/bootstrap.php';

$ca = new \WHMCS\ClientArea();
$ca->initPage();
$ca->setPageTitle('Microsoft 365');
$ca->addToBreadCrumb('index.php', 'Home');
$ca->addToBreadCrumb('office-365.php', 'Microsoft 365');
$plans = array();
$error = '';
try {
    $currencyId = 0;
    if (!empty($_SESSION['uid'])) {
        $currencyId = (int) \WHMCS\Database\Capsule::table('tblclients')->where('id', (int) $_SESSION['uid'])->value('currency');
    }
    if ($currencyId <= 0 && !empty($_SESSION['currency'])) { $currencyId = (int) $_SESSION['currency']; }
    $catalog = new \CloudHost247\Email\Service\PublicCatalog();
    $groups = $catalog->byProvider($currencyId);
    foreach (isset($groups['microsoft365']['plans']) ? $groups['microsoft365']['plans'] : array() as $plan) {
        if (!empty($plan['available'])) { $plans[] = $plan; }
    }
} catch (\Throwable $e) {
    $plans = array();
    $error = 'Plan information is temporarily unavailable. Please try again later or contact sales.';
}
$ca->assign('officePlans', $plans);
$ca->assign('officeError', $error);
$ca->assign('sidebarCloudHost247Remove', 'true');
$ca->setTemplate('office-365');
$ca->output();
