<?php
use WHMCS\ClientArea;
use WHMCS\Database\Capsule;
define('CLIENTAREA', true);
require __DIR__ . '/init.php';
$ca = new ClientArea();
$ca->setPageTitle('WHMCS HostX Page Title');
$ca->addToBreadCrumb('index.php', Lang::trans('globalsystemname'));
$ca->addToBreadCrumb('vps-publiccloud.php', 'WHMCS HostX Page Title');
$ca->initPage();

$ca->assign('sidebarHostxRemove', 'true');
$ca->setTemplate('hostx');
$ca->output();