<?php
use WHMCS\ClientArea;
use WHMCS\Database\Capsule;
define('CLIENTAREA', true);
require __DIR__ . '/init.php';
$ca = new ClientArea();
$ca->setPageTitle('Page Not Found');
$ca->addToBreadCrumb('index.php', Lang::trans('globalsystemname'));
$ca->addToBreadCrumb('notfound.php', 'Page Not Found');
$ca->initPage();
$ca->assign('sidebarHostxRemove', 'true');
$ca->setTemplate('notfound');
$ca->output();