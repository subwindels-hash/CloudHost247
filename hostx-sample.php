<?php
use WHMCS\ClientArea;
use WHMCS\Database\Capsule;
define('CLIENTAREA', true);
require __DIR__ . '/init.php';
$ca = new ClientArea();
$ca->setPageTitle('{title}');
$ca->addToBreadCrumb('index.php', Lang::trans('globalsystemname'));
$ca->addToBreadCrumb('{page_name}', '{title}');
$ca->initPage();

$ca->assign('sidebarHostxRemove', 'true');
$ca->setTemplate('hostx');
$ca->output();