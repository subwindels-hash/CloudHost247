<?php
use WHMCS\ClientArea;
use WHMCS\Database\Capsule;
define('CLIENTAREA', true);
require __DIR__ . '/init.php';
$ca = new ClientArea();
$ca->setPageTitle('All Element Hostx');
$ca->addToBreadCrumb('index.php', Lang::trans('globalsystemname'));
$ca->addToBreadCrumb('all-element-hostx.php', 'Hostx Element');
$ca->initPage();
$ca->assign('sidebarHostxRemove', 'true');
$ca->setTemplate('all-element-hostx');
$ca->output();