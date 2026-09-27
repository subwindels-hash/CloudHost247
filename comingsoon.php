<?php
use WHMCS\ClientArea;
use WHMCS\Database\Capsule;
define('CLIENTAREA', true);
require __DIR__ . '/init.php';
$ca = new ClientArea();
$ca->setPageTitle('Comingsoon');
$ca->addToBreadCrumb('index.php', Lang::trans('globalsystemname'));
$ca->addToBreadCrumb('comingsoon.php', 'Comingsoon');
$ca->initPage();
$ca->assign('sidebarHostxRemove', 'true');
$ca->setTemplate('comingsoon');
$ca->output();