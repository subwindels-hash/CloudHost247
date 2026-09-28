<?php
use WHMCS\ClientArea;
use WHMCS\Database\Capsule;
define('CLIENTAREA', true);
require __DIR__ . '/init.php';
$ca = new ClientArea();
$ca->setPageTitle('Game Servers');
$ca->addToBreadCrumb('index.php', Lang::trans('globalsystemname'));
$ca->addToBreadCrumb('gameservers.php', 'Game Servers');
$ca->initPage();
$ca->assign('sidebarCloudHost247Remove', 'true');
$ca->setTemplate('cloudhost247_legacy');
$ca->output();