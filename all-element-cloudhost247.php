<?php
use WHMCS\ClientArea;
use WHMCS\Database\Capsule;
define('CLIENTAREA', true);
require __DIR__ . '/init.php';
$ca = new ClientArea();
$ca->setPageTitle('All Element CloudHost247');
$ca->addToBreadCrumb('index.php', Lang::trans('globalsystemname'));
$ca->addToBreadCrumb('all-element-cloudhost247.php', 'CloudHost247 Element');
$ca->initPage();
$ca->assign('sidebarCloudHost247Remove', 'true');
$ca->setTemplate('all-element-cloudhost247');
$ca->output();