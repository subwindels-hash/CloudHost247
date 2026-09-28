<?php
use WHMCS\ClientArea;
use WHMCS\Database\Capsule;
define('CLIENTAREA', true);
require __DIR__ . '/init.php';
$ca = new ClientArea();
$ca->setPageTitle('Offers');
$ca->addToBreadCrumb('index.php', Lang::trans('globalsystemname'));
$ca->addToBreadCrumb('offers.php', 'Offers');
$ca->initPage();

$ca->assign('sidebarCloudHost247Remove', 'true');
$ca->setTemplate('cloudhost247_legacy');
$ca->output();