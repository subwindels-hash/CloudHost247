<?php
/** WHMCS error document. Host-level failures should use the static /errors/*.html files. */
define('CLIENTAREA', true);
require __DIR__ . '/init.php';
$status = isset($_GET['code']) ? (int) $_GET['code'] : 503;
if (!in_array($status, array(403, 404, 500, 503), true)) { $status = 503; }
http_response_code($status);
if ($status === 503) { header('Retry-After: 300'); }
$ca = new \WHMCS\ClientArea();
$ca->initPage();
$ca->setPageTitle($status === 404 ? "We couldn't find that page." : 'Service unavailable');
$ca->assign('chErrorCode', $status);
$ca->setTemplate('cloudhost247-error');
$ca->output();
