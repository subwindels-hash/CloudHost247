<?php
use WHMCS\ClientArea;
use WHMCS\Database\Capsule;
define('CLIENTAREA', true);
require __DIR__ . '/init.php';
$ca = new ClientArea();
$ca->setPageTitle('Enterprise Servers');
$ca->addToBreadCrumb('index.php', Lang::trans('globalsystemname'));
$ca->addToBreadCrumb('enterpriseservers.php', 'Enterprise Servers');
$ca->initPage();
$ca->assign('sidebarHostxRemove', 'true');
$ca->setTemplate('hostx');
$ca->output();